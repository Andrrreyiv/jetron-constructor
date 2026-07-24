// Точка входа стенда: грузим конфиг → валидируем на границе → запускаем приложение.
import { validateConfig } from './core/ConfigLoader.js';
import { validateOverrides, validateCrops } from './core/ZoneOverrides.js';
// Версионируем импорты изменённых модулей, чтобы обычная перезагрузка (не только Cmd+Shift+R)
// подтягивала свежий файл: ESM кешируется по URL, а ?v на index.html не бустит вложенные импорты.
import { UniformApp } from './ui/app.browser.js?v=20260723b';
import { initZoneEditor } from './ui/zone-editor.browser.js?v=20260724a';

async function boot() {
  const statusEl = document.getElementById('status');
  try {
    const res = await fetch('src/config/mock-config.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Конфиг не загрузился (HTTP ${res.status})`);
    const config = await res.json();

    const check = validateConfig(config);
    if (!check.ok) {
      statusEl.innerHTML = `<b>Конфиг невалиден:</b><br>${check.errors.join('<br>')}`;
      statusEl.hidden = false;
      return;
    }

    // Палитра цвета текста управляется из админки (colors.json пишет mu-плагин jetron-colors.php),
    // минуя антибот/WAF. Читается после валидации, чтобы битый файл не заблокировал запуск.
    try {
      const cr = await fetch('colors.json', { cache: 'no-store' });
      if (cr.ok) {
        const adm = await cr.json();
        if (Array.isArray(adm.textColors) && adm.textColors.length) config.textColors = adm.textColors;
      }
    } catch { /* остаёмся на палитре из mock-config.json */ }

    // Координаты зон нанесения правятся из редактора зон (zones.json пишет mu-плагин
    // jetron-zones.php, как colors.json). Формат: { <formId>: { <zoneKey>: {x,y,w,h} } }.
    // Битый файл не должен ронять стенд — при ошибке остаёмся на зонах из mock-config.json.
    try {
      const zr = await fetch('zones.json', { cache: 'no-store' });
      if (zr.ok) {
        const ov = await zr.json();
        if (validateOverrides(ov).ok) config.zoneOverrides = ov;
      }
    } catch { /* остаёмся на зонах из mock-config.json */ }

    // Кадрирование фона по формам (crops.json пишет тот же mu-плагин jetron-zones.php).
    // Формат тот же { <formId>: {x,y,w,h} }, поэтому валидируем тем же validateOverrides.
    // Битый файл не должен ронять стенд — при ошибке показываем мокапы целиком.
    try {
      const cropr = await fetch('crops.json', { cache: 'no-store' });
      if (cropr.ok) {
        const cr = await cropr.json();
        // crops.json — плоская форма { formId: {x,y,w,h} }, отдельный валидатор (не зоновый).
        if (validateCrops(cr).ok) config.bgCrops = cr;
      }
    } catch { /* остаёмся на нетронутых мокапах из mock-config.json */ }

    const app = new UniformApp({
      config,
      viewsEl: document.getElementById('views'),
      panelEl: document.getElementById('panel')
    });
    await app.start();
    window.__jetronApp = app; // отладочный доступ для стенда/автотестов
    window.__jetronEditor = initZoneEditor(app); // админ-режим правки зон (?zones=edit); для покупателя — null
    statusEl.hidden = true;
  } catch (err) {
    statusEl.textContent = `Ошибка запуска стенда: ${err.message}`;
    statusEl.hidden = false;
  }
}

boot();
