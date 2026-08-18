document.getElementById('generateImageBtn').addEventListener('click', async () => {
  const imagePrompt = document.getElementById('imagePromptInput').value.trim();
  const licenseCode = document.getElementById('licenseCode').value.trim();

  if (!imagePrompt) { alert('Describe la imagen que necesitas.'); return; }

  const btn = document.getElementById('generateImageBtn');
  const status = document.getElementById('imageStatus');
  const wrap = document.getElementById('imageResultWrap');

  btn.disabled = true;
  status.className = 'status show';
  status.textContent = 'Iniciando la imagen...';
  wrap.style.display = 'none';

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseCode, type: 'image', imagePrompt })
    });

    const data = await response.json();

    if (!response.ok) {
      status.className = 'status show error';
      status.textContent = data.error || 'No se pudo generar la imagen.';
      btn.disabled = false;
      return;
    }

    // Ya arrancó en Replicate — ahora preguntamos cada 2 segundos si ya terminó
    pollGenerationStatus(data.predictionId, {
      btn, status, wrap,
      resultElId: 'imageResult',
      maxAttempts: 30, // 30 x 2s = 1 minuto máximo de espera
      intervalMs: 2000,
      label: 'imagen',
    });
  } catch (err) {
    status.className = 'status show error';
    status.textContent = 'Error de conexión.';
    btn.disabled = false;
  }
});

document.getElementById('generateVideoBtn').addEventListener('click', async () => {
  const videoPrompt = document.getElementById('videoPromptInput').value.trim();
  const licenseCode = document.getElementById('licenseCode').value.trim();

  if (!videoPrompt) { alert('Describe el video que necesitas.'); return; }

  const btn = document.getElementById('generateVideoBtn');
  const status = document.getElementById('videoStatus');
  const wrap = document.getElementById('videoResultWrap');

  btn.disabled = true;
  status.className = 'status show';
  status.textContent = 'Iniciando el video...';
  wrap.style.display = 'none';

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseCode, type: 'video', videoPrompt })
    });

    const data = await response.json();

    if (!response.ok) {
      status.className = 'status show error';
      status.textContent = data.error || 'No se pudo generar el video.';
      btn.disabled = false;
      return;
    }

    // Ya arrancó en Replicate — ahora preguntamos cada 4 segundos si ya terminó
    pollGenerationStatus(data.predictionId, {
      btn, status, wrap,
      resultElId: 'videoResult',
      maxAttempts: 90, // 90 x 4s = 6 minutos máximo de espera (video tarda más que imagen)
      intervalMs: 4000,
      label: 'video',
    });
  } catch (err) {
    status.className = 'status show error';
    status.textContent = 'Error de conexión.';
    btn.disabled = false;
  }
});

// Función genérica de polling — sirve tanto para imagen como para video,
// ambos usan la misma función video-status.js del backend (solo consulta
// el estado de un predictionId en Replicate, no le importa el tipo).
async function pollGenerationStatus(predictionId, { btn, status, wrap, resultElId, maxAttempts, intervalMs, label }) {
  let attempts = 0;

  const check = async () => {
    attempts++;
    try {
      const response = await fetch('/api/video-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ predictionId })
      });
      const data = await response.json();

      if (data.status === 'succeeded') {
        document.getElementById(resultElId).src = data.url;
        wrap.style.display = 'block';
        status.classList.remove('show');
        btn.disabled = false;
        return;
      }

      if (data.status === 'failed') {
        status.className = 'status show error';
        status.textContent = data.error || `La generación de ${label} falló.`;
        btn.disabled = false;
        return;
      }

      if (attempts >= maxAttempts) {
        status.className = 'status show error';
        status.textContent = `El/la ${label} está tardando más de lo normal. Intenta de nuevo en unos minutos.`;
        btn.disabled = false;
        return;
      }

      status.textContent = `Generando ${label}... (${Math.round(attempts * intervalMs / 1000)}s aprox.)`;
      setTimeout(check, intervalMs);
    } catch (err) {
      status.className = 'status show error';
      status.textContent = `Error de conexión mientras se generaba ${label === 'imagen' ? 'la imagen' : 'el video'}.`;
      btn.disabled = false;
    }
  };

  check();
}
