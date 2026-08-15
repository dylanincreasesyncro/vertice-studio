# Vértice Studio — Versión para Vender/Rentar

## Qué es esto
Es tu herramienta de generación de campañas con IA, funcionando de forma
**100% independiente** (no depende de Claude.ai). La puedes rentar mensualmente
a otros negocios, o venderla completa como licencia de marca blanca.

---

## PASO 1 — Consigue tu clave de IA (Anthropic API Key)

1. Ve a **console.anthropic.com** y crea una cuenta (si no tienes una)
2. Ve a **"API Keys"** → **"Create Key"**
3. Copia esa clave — la vas a necesitar en el Paso 3
4. Agrega crédito a tu cuenta (console.anthropic.com → Billing). Cada campaña
   generada cuesta una fracción de centavo, así que con $5-10 USD tienes para
   cientos de generaciones mientras validas el negocio

---

## PASO 2 — Sube este proyecto a Netlify

**Opción fácil (arrastrar y soltar):**
1. Ve a **app.netlify.com** → "Add new site" → "Deploy manually"
2. Arrastra esta carpeta completa (`vertice-studio-web`)
3. Netlify la publica en segundos con un link tipo `algo-random.netlify.app`

**Opción recomendada (para poder actualizar después):**
1. Sube esta carpeta a un repositorio de GitHub
2. En Netlify: "Add new site" → "Import from Git" → conecta tu repo
3. Cada vez que subas cambios a GitHub, Netlify actualiza el sitio solo

---

## PASO 3 — Configura tu clave de IA en Netlify (nunca la pongas en el código)

1. En tu sitio dentro de Netlify: **Site settings → Environment variables**
2. Agrega una variable:
   - Key: `ANTHROPIC_API_KEY`
   - Value: (pega la clave que sacaste en el Paso 1)
3. Agrega otra variable:
   - Key: `REQUIRE_LICENSE`
   - Value: `false` (para probar sin sistema de licencias todavía)
4. Dale "Redeploy" al sitio para que tome las variables nuevas

**Con esto ya puedes probar la herramienta funcionando de verdad, gratis para ti,
sin sistema de cobro todavía.**

---

## PASO 4 — Activa el sistema de licencias (para cobrar renta mensual)

Esto es lo que te permite controlar qué cliente pagó y cuántas campañas puede
generar al mes — ahora con 3 contadores separados: texto, imágenes y video.

1. Crea una cuenta gratis en **supabase.com**
2. Crea un nuevo proyecto
3. Ve a **SQL Editor** → pega el contenido del archivo `supabase-schema.sql`
   que viene en esta carpeta → dale "Run"
4. Ve a **Project Settings → API** y copia:
   - "Project URL" → esta es tu `SUPABASE_URL`
   - "service_role key" (no la "anon" key) → esta es tu `SUPABASE_SERVICE_KEY`
5. Regresa a Netlify → Environment variables → agrega:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - Cambia `REQUIRE_LICENSE` a `true`
6. Redeploy

---

## PASO 5 — Activa imágenes y video (opcional, tiene costo aparte)

Claude (Anthropic) genera texto, pero no imágenes ni video. Para eso necesitas
una cuenta en **replicate.com** — ahí eliges qué modelo de imagen y de video
usar, y pagas solo por lo que se genera (revisa sus precios antes de activar).

1. Crea cuenta en **replicate.com** → ve a **Account → API Tokens** → copia tu token
2. Explora **replicate.com/explore**, elige un modelo de imagen (búsqueda:
   "text to image") y uno de video (búsqueda: "text to video") que te
   convenzan por calidad/precio
3. En la página de cada modelo, copia su "version id" (un código largo)
4. En Netlify → Environment variables, agrega:
   - `REPLICATE_API_TOKEN`
   - `REPLICATE_IMAGE_MODEL_VERSION` (el version id del modelo de imagen)
   - `REPLICATE_VIDEO_MODEL_VERSION` (el version id del modelo de video)
5. Redeploy

**Advertencia honesta sobre video:** los modelos de video son lentos (30s-2min)
y el plan gratuito de Netlify corta las funciones a los 10 segundos. Si el
video se corta con error de tiempo, vas a necesitar activar **"Background
Functions"** en un plan pago de Netlify, o usar un servicio que genere el
video de forma asíncrona (te avisa cuando esté listo, en vez de hacerte
esperar). Empieza probando con imágenes primero, que son mucho más rápidas
y estables, y agrega video cuando ya tengas el resto funcionando bien.

---

## Da de alta a un cliente que te renta el servicio

En Supabase → **Table Editor** → tabla `licenses` → "Insert row", usando
alguno de estos 3 planes como referencia:

| Plan | Precio sugerido | Texto/mes | Imágenes/mes | Video/mes |
|---|---|---|---|---|
| **Starter** | $19 USD | 30 | 10 | 5 |
| **Pro** | $39 USD | 100 | 40 | 20 |
| **Agencia** | $79 USD | 300 | 120 | 60 |

**Al inicio de cada mes**, entra a Supabase y reinicia los 3 contadores de
cada cliente (o corre el SQL de ejemplo que está en `supabase-schema.sql`).

---

## Cómo cobrar la renta mensual

Esta versión no incluye cobro automático todavía. Lo más simple para empezar:
1. Cobra manualmente cada mes por Stripe, transferencia o el método que uses
2. Cuando te paguen, entra a Supabase y activas/reactivas su licencia
3. Cuando alguien deje de pagar, pones `active = false` en su fila

Si más adelante quieres automatizar el cobro (que se desactive solo si no
pagan), se puede conectar Stripe Billing con Supabase — es el siguiente nivel
cuando ya tengas varios clientes y valga la pena automatizarlo.

---

## Resumen de costos mensuales para ti

- **Netlify:** gratis (plan gratuito cubre esto de sobra)
- **Supabase:** gratis (plan gratuito cubre cientos de licencias)
- **Anthropic API:** pagas solo por lo que se genera — cada campaña cuesta
  una fracción de centavo, así que si rentas a $20-30 USD/mes por cliente,
  tu margen es altísimo
