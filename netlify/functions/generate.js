// netlify/functions/generate.js
//
// Esta función corre en el servidor de Netlify, nunca en el navegador del cliente.
// Por eso aquí SÍ es seguro usar tus claves reales — nunca se exponen al público.
//
// Soporta 3 tipos de generación: "text" (Claude), "image" y "video" (Replicate).
// Necesitas tu propia cuenta en replicate.com y su API token para que
// image/video funcionen — ver README.md, sección "Imágenes y Video".
//
// IMPORTANTE: image y video son ASÍNCRONOS. Esta función solo los ARRANCA
// en Replicate y regresa un predictionId. El navegador consulta el avance
// con netlify/functions/video-status.js cada pocos segundos. Esto es
// obligatorio porque Netlify mata las funciones normales a los ~10-26
// segundos, y una imagen/video puede tardar más que eso.

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const REQUIRE_LICENSE = process.env.REQUIRE_LICENSE === "true";

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Solicitud inválida." }) };
  }

  const { licenseCode, type = "text", systemPrompt, userPrompt, imagePrompt, videoPrompt } = body;

  if (REQUIRE_LICENSE) {
    const check = await checkAndConsumeLicense(licenseCode, type);
    if (!check.ok) {
      return { statusCode: 402, body: JSON.stringify({ error: check.reason }) };
    }
  }

  try {
    if (type === "image") return await startReplicatePrediction(
      process.env.REPLICATE_IMAGE_MODEL_VERSION,
      { prompt: imagePrompt },
      "Generación de imágenes no configurada todavía. Falta REPLICATE_API_TOKEN o REPLICATE_IMAGE_MODEL_VERSION en Netlify."
    );
    if (type === "video") return await startReplicatePrediction(
      process.env.REPLICATE_VIDEO_MODEL_VERSION,
      { prompt: videoPrompt },
      "Generación de video no configurada todavía. Falta REPLICATE_API_TOKEN o REPLICATE_VIDEO_MODEL_VERSION en Netlify."
    );
    return await generateText(systemPrompt, userPrompt);
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Error de servidor.", detail: String(err) }),
    };
  }
};

// ---------- TEXTO (Claude) ----------
async function generateText(systemPrompt, userPrompt) {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "Falta configurar ANTHROPIC_API_KEY." }) };
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    return { statusCode: response.status, body: JSON.stringify({ error: data.error?.message || "Error al generar texto." }) };
  }
  const text = (data.content || []).map((c) => (c.type === "text" ? c.text : "")).filter(Boolean).join("\n");
  return { statusCode: 200, body: JSON.stringify({ text }) };
}

// ---------- IMAGEN Y VIDEO (Replicate) — ambos ASÍNCRONOS ----------
// Arranca la predicción en Replicate y regresa de inmediato con un
// predictionId. NO espera a que termine — eso evita que Netlify mate
// la función por tardarse demasiado. El navegador hace polling aparte
// contra netlify/functions/video-status.js (sirve tanto para imagen
// como para video, solo consulta el estado del predictionId).
async function startReplicatePrediction(modelVersion, input, missingConfigMessage) {
  const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

  if (!REPLICATE_API_TOKEN || !modelVersion) {
    return {
      statusCode: 501,
      body: JSON.stringify({ error: missingConfigMessage }),
    };
  }

  const start = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Token ${REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ version: modelVersion, input }),
  });
  const prediction = await start.json();
  if (!start.ok) {
    return { statusCode: 500, body: JSON.stringify({ error: prediction.detail || "Error iniciando la generación." }) };
  }

  return { statusCode: 200, body: JSON.stringify({ predictionId: prediction.id, status: prediction.status }) };
}

// ---------- LICENCIAS ----------
async function checkAndConsumeLicense(code, type) {
  if (!code) return { ok: false, reason: "Falta el código de licencia." };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { ok: false, reason: "El sistema de licencias no está configurado todavía." };
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/licenses?code=eq.${encodeURIComponent(code)}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  const rows = await res.json();
  if (!rows || rows.length === 0) return { ok: false, reason: "Código de licencia no válido." };

  const license = rows[0];
  if (!license.active) return { ok: false, reason: "Esta licencia está inactiva. Contacta al proveedor." };

  const fieldMap = {
    text: ["text_used_this_month", "max_text_per_month"],
    image: ["images_used_this_month", "max_images_per_month"],
    video: ["videos_used_this_month", "max_videos_per_month"],
  };
  const [usedField, maxField] = fieldMap[type] || fieldMap.text;

  if (license[usedField] >= license[maxField]) {
    return { ok: false, reason: `Alcanzaste el límite de ${type === "text" ? "campañas de texto" : type === "image" ? "imágenes" : "videos"} de este mes en tu plan.` };
  }

  await fetch(`${SUPABASE_URL}/rest/v1/licenses?code=eq.${encodeURIComponent(code)}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ [usedField]: license[usedField] + 1 }),
  });

  return { ok: true };
}
