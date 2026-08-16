// netlify/functions/video-status.js
//
// El navegador llama esta función cada pocos segundos, pasándole el
// predictionId que devolvió /api/generate al arrancar un video.
// Responde con el estado actual: "starting", "processing", "succeeded" o "failed".
// Cuando ya está "succeeded", trae la URL del video listo.

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

  const { predictionId } = body;
  const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

  if (!predictionId) {
    return { statusCode: 400, body: JSON.stringify({ error: "Falta el ID de seguimiento del video." }) };
  }
  if (!REPLICATE_API_TOKEN) {
    return { statusCode: 500, body: JSON.stringify({ error: "Falta configurar REPLICATE_API_TOKEN." }) };
  }

  try {
    const res = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
      headers: { Authorization: `Token ${REPLICATE_API_TOKEN}` },
    });
    const prediction = await res.json();

    if (!res.ok) {
      return { statusCode: 500, body: JSON.stringify({ error: "No se pudo consultar el estado del video." }) };
    }

    if (prediction.status === "succeeded") {
      const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
      return { statusCode: 200, body: JSON.stringify({ status: "succeeded", url }) };
    }

    if (prediction.status === "failed" || prediction.status === "canceled") {
      return { statusCode: 200, body: JSON.stringify({ status: "failed", error: prediction.error || "La generación falló en el proveedor." }) };
    }

    // Sigue en proceso: "starting" o "processing"
    return { statusCode: 200, body: JSON.stringify({ status: prediction.status }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "Error de servidor.", detail: String(err) }) };
  }
};
