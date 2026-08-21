// netlify/functions/prospects.js
//
// Busca negocios/prospectos reales usando OpenStreetMap (100% gratis, sin API key):
//   - Nominatim: convierte una dirección/ciudad en coordenadas (geocoding).
//   - Overpass API: busca negocios reales dentro de un radio (hasta 50 km).
//
// No requiere ninguna variable nueva en Netlify — reutiliza SUPABASE_URL y
// SUPABASE_SERVICE_KEY que ya tienes configurados.
//
// Nota: OpenStreetMap tiene menos cobertura de negocios que Google en pueblos
// chicos. Cuando actives Google Places más adelante, esta función se puede
// reemplazar sin tocar el resto del sitio (la interfaz no cambia).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const MAX_RADIUS_METERS = 50000; // 50 km, un límite razonable para no saturar Overpass
const MAX_CITIES_PER_SEARCH = 5; // límite propio en modo multi-ciudad, por tiempo de espera
const USER_AGENT = "VerticeStudio/1.0 (contacto@verticeia.com)"; // Nominatim exige identificarse

// ---------- Diccionario de categorías exactas de OpenStreetMap ----------
// OpenStreetMap NO guarda sus etiquetas en español — usa su propia taxonomía
// en inglés (ej. "amenity=dentist", "shop=hairdresser"). Buscar "gimnasio"
// como texto libre contra esas etiquetas casi nunca encontraba nada.
// Este diccionario traduce los términos en español más comunes a la
// combinación exacta [clave, valor] de OSM, para resultados mucho más precisos.
// Las claves están normalizadas (sin acentos, minúsculas) — ver normalizeText().
const NICHE_TAG_MAP = {
  "restaurante": [["amenity", "restaurant"]],
  "restaurantes": [["amenity", "restaurant"]],
  "pizzeria": [["amenity", "restaurant"]],
  "cafeteria": [["amenity", "cafe"]],
  "cafe": [["amenity", "cafe"]],
  "bar": [["amenity", "bar"]],
  "gimnasio": [["leisure", "fitness_centre"]],
  "gym": [["leisure", "fitness_centre"]],
  "spa": [["leisure", "spa"], ["shop", "beauty"]],
  "salon de belleza": [["shop", "beauty"]],
  "estetica": [["shop", "beauty"]],
  "peluqueria": [["shop", "hairdresser"]],
  "barberia": [["shop", "hairdresser"]],
  "dentista": [["amenity", "dentist"]],
  "doctor": [["amenity", "doctors"]],
  "medico": [["amenity", "doctors"]],
  "clinica": [["amenity", "clinic"]],
  "farmacia": [["amenity", "pharmacy"]],
  "veterinaria": [["amenity", "veterinary"]],
  "veterinario": [["amenity", "veterinary"]],
  "hotel": [["tourism", "hotel"]],
  "panaderia": [["shop", "bakery"]],
  "pasteleria": [["shop", "pastry"]],
  "carniceria": [["shop", "butcher"]],
  "taller mecanico": [["shop", "car_repair"]],
  "taller": [["shop", "car_repair"]],
  "mecanico": [["shop", "car_repair"]],
  "lavanderia": [["shop", "laundry"]],
  "tintoreria": [["shop", "dry_cleaning"]],
  "ropa": [["shop", "clothes"]],
  "boutique": [["shop", "clothes"]],
  "zapateria": [["shop", "shoes"]],
  "ferreteria": [["shop", "hardware"]],
  "supermercado": [["shop", "supermarket"]],
  "abarrotes": [["shop", "convenience"]],
  "tienda de conveniencia": [["shop", "convenience"]],
  "joyeria": [["shop", "jewelry"]],
  "optica": [["shop", "optician"]],
  "floreria": [["shop", "florist"]],
  "papeleria": [["shop", "stationery"]],
  "escuela": [["amenity", "school"]],
  "guarderia": [["amenity", "childcare"]],
  "banco": [["amenity", "bank"]],
  "abogado": [["office", "lawyer"]],
  "notaria": [["office", "lawyer"]],
  "contador": [["office", "accountant"]],
  "inmobiliaria": [["office", "estate_agent"]],
  "agencia de viajes": [["office", "travel_agent"]],
  "gasolinera": [["amenity", "fuel"]],
  "autolavado": [["shop", "car_wash"]],
  "car wash": [["shop", "car_wash"]],
  "tatuajes": [["shop", "tattoo"]],
  "tattoo": [["shop", "tattoo"]],
};

// Términos genéricos: cuando el usuario NO busca un giro específico sino
// "cualquier negocio" de la zona (útil para prospectar clientes de
// servicios web en general, no de un nicho en particular).
const GENERIC_TERMS = new Set([
  "negocio",
  "negocios",
  "negocio local",
  "negocios locales",
  "cliente",
  "clientes",
  "prospecto",
  "prospectos",
  "prospectos para negocio",
  "prospectos de negocio",
  "cualquier negocio",
  "todos los negocios",
  "empresa",
  "empresas",
  "comercio",
  "comercios",
  "pyme",
  "pymes",
]);

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Solicitud inválida." }) };
  }

  const { licenseCode, mode, niche, location, radiusKm, cities } = body;

  if (!licenseCode) {
    return { statusCode: 402, body: JSON.stringify({ error: "Falta el código de licencia." }) };
  }
  if (!niche || !niche.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: "Describe qué tipo de negocio buscas (ej. dentistas, talleres mecánicos)." }) };
  }

  try {
    // 1) Verifica la licencia y su cuota de prospección
    const license = await getLicense(licenseCode);
    if (!license) {
      return { statusCode: 402, body: JSON.stringify({ error: "Código de licencia no válido." }) };
    }
    if (license.active === false) {
      return { statusCode: 402, body: JSON.stringify({ error: "Esta licencia está desactivada." }) };
    }
    const used = license.prospects_used_this_month || 0;
    const max = license.max_prospects_per_month ?? 20;
    if (used >= max) {
      return { statusCode: 402, body: JSON.stringify({ error: `Alcanzaste el límite de ${max} búsquedas de prospección este mes.` }) };
    }

    // 2) Ejecuta la búsqueda según el modo
    let results = [];

    if (mode === "multi") {
      if (!Array.isArray(cities) || cities.length === 0) {
        return { statusCode: 400, body: JSON.stringify({ error: "Escribe al menos una ciudad o pueblo." }) };
      }
      const cityList = cities.slice(0, MAX_CITIES_PER_SEARCH);
      for (const city of cityList) {
        const coords = await geocodeOSM(city);
        if (coords) {
          const found = await searchOverpass(coords, 15000, niche); // 15 km por ciudad en modo multi
          results.push(...found);
        }
        await sleep(300); // respeta el uso justo de Nominatim
      }
    } else {
      // modo "radius" (por defecto)
      if (!location || !location.trim()) {
        return { statusCode: 400, body: JSON.stringify({ error: "Indica la dirección o ciudad de tu negocio." }) };
      }
      const radiusMeters = Math.min(Math.max((radiusKm || 25) * 1000, 1000), MAX_RADIUS_METERS);

      const coords = await geocodeOSM(location);
      if (!coords) {
        return { statusCode: 400, body: JSON.stringify({ error: "No pudimos ubicar esa dirección. Intenta con ciudad y estado." }) };
      }

      const found = await searchOverpass(coords, radiusMeters, niche);
      results.push(...found);
    }

    // 3) Deduplica por nombre + dirección
    const seen = new Set();
    const deduped = results.filter(r => {
      const key = `${r.name}|${r.address}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // 4) Descuenta 1 uso de la cuota
    await incrementProspectUsage(licenseCode, used + 1);

    return {
      statusCode: 200,
      body: JSON.stringify({
        results: deduped.slice(0, 60),
        count: deduped.length,
        source: "OpenStreetMap",
        remaining: max - (used + 1),
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Error de servidor.", detail: String(err) }),
    };
  }
};

// ---------- Helpers ----------

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Quita acentos y pasa a minúsculas, para que "óptica" y "optica" hagan
// match con la misma entrada del diccionario NICHE_TAG_MAP.
function normalizeText(str) {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

async function getLicense(code) {
  const url = `${SUPABASE_URL}/rest/v1/licenses?code=eq.${encodeURIComponent(code)}&select=*`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  const rows = await res.json();
  return rows && rows[0] ? rows[0] : null;
}

async function incrementProspectUsage(code, newValue) {
  const url = `${SUPABASE_URL}/rest/v1/licenses?code=eq.${encodeURIComponent(code)}`;
  await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ prospects_used_this_month: newValue }),
  });
}

async function geocodeOSM(address) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  const data = await res.json();
  if (!data || !data[0]) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

// Arma la parte "filters" de la consulta Overpass. Si el término de búsqueda
// coincide con una entrada de NICHE_TAG_MAP, busca por la etiqueta EXACTA
// de OpenStreetMap (mucho más preciso). Si no, usa la búsqueda difusa por
// nombre/etiquetas de texto libre (comportamiento anterior, como respaldo).
function buildOverpassFilters(radiusMeters, lat, lng, niche) {
  const normalized = normalizeText(niche);

  // Búsqueda genérica: "cualquier negocio" de la zona, sin nicho específico.
  if (GENERIC_TERMS.has(normalized)) {
    return `
      node(around:${radiusMeters},${lat},${lng})["shop"];
      way(around:${radiusMeters},${lat},${lng})["shop"];
      node(around:${radiusMeters},${lat},${lng})["office"];
      way(around:${radiusMeters},${lat},${lng})["office"];
      node(around:${radiusMeters},${lat},${lng})["craft"];
      node(around:${radiusMeters},${lat},${lng})["amenity"~"restaurant|cafe|bar|dentist|doctors|pharmacy|bank|clinic|veterinary|fuel"];
      node(around:${radiusMeters},${lat},${lng})["leisure"~"fitness_centre|spa"];
      node(around:${radiusMeters},${lat},${lng})["tourism"="hotel"];`;
  }

  const tagMatches = NICHE_TAG_MAP[normalized];

  if (tagMatches) {
    return tagMatches
      .map(([key, value]) => `
      node(around:${radiusMeters},${lat},${lng})["${key}"="${value}"];
      way(around:${radiusMeters},${lat},${lng})["${key}"="${value}"];`)
      .join("");
  }

  // Respaldo: búsqueda difusa por texto libre (como antes)
  const term = escapeRegex(niche.trim());
  return `
      node(around:${radiusMeters},${lat},${lng})["name"~"${term}",i];
      way(around:${radiusMeters},${lat},${lng})["name"~"${term}",i];
      node(around:${radiusMeters},${lat},${lng})["shop"~"${term}",i];
      node(around:${radiusMeters},${lat},${lng})["amenity"~"${term}",i];
      node(around:${radiusMeters},${lat},${lng})["office"~"${term}",i];
      node(around:${radiusMeters},${lat},${lng})["craft"~"${term}",i];
      node(around:${radiusMeters},${lat},${lng})["healthcare"~"${term}",i];`;
}

async function searchOverpass(coords, radiusMeters, niche) {
  const { lat, lng } = coords;
  const filters = buildOverpassFilters(radiusMeters, lat, lng, niche);

  const query = `
    [out:json][timeout:25];
    (${filters}
    );
    out center 40;
  `;

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "text/plain", "User-Agent": USER_AGENT },
    body: query,
  });

  if (!res.ok) return [];
  const data = await res.json();
  if (!data.elements) return [];

  return data.elements.map(el => {
    const tags = el.tags || {};
    const addrParts = [
      tags["addr:street"],
      tags["addr:housenumber"],
      tags["addr:suburb"],
      tags["addr:city"],
    ].filter(Boolean);

    return {
      name: tags.name || "Sin nombre registrado",
      address: addrParts.length ? addrParts.join(", ") : "Sin dirección registrada en el mapa",
      phone: tags.phone || tags["contact:phone"] || "",
      website: tags.website || tags["contact:website"] || "",
      category: tags.shop || tags.amenity || tags.office || tags.craft || tags.leisure || tags.tourism || "",
      rating: null,
      mapsUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    };
  }).filter(p => p.name !== "Sin nombre registrado");
}
