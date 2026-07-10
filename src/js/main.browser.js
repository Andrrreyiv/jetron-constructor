// Точка входа стенда: грузим конфиг → валидируем на границе → запускаем приложение.
import { validateConfig } from './core/ConfigLoader.js';
import { UniformApp } from './ui/app.browser.js';

async function boot() {
  const statusEl = document.getElementById('status');
  try {
    const res = await fetch('src/config/mock-config.json');
    if (!res.ok) throw new Error(`Конфиг не загрузился (HTTP ${res.status})`);
    const config = await res.json();

    const check = validateConfig(config);
    if (!check.ok) {
      statusEl.innerHTML = `<b>Конфиг невалиден:</b><br>${check.errors.join('<br>')}`;
      statusEl.hidden = false;
      return;
    }

    const app = new UniformApp({
      config,
      viewsEl: document.getElementById('views'),
      panelEl: document.getElementById('panel')
    });
    await app.start();
    window.__jetronApp = app; // отладочный доступ для стенда/автотестов
    statusEl.hidden = true;
  } catch (err) {
    statusEl.textContent = `Ошибка запуска стенда: ${err.message}`;
    statusEl.hidden = false;
  }
}

boot();
