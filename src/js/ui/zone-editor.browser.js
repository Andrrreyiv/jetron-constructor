// Редактор зон нанесения (админ-режим). Открывается по ?zones=edit.
// Делает пунктирные рамки зон перетаскиваемыми/масштабируемыми, копит правки координат
// и сохраняет их в zones.json через mu-плагин jetron-zones.php (wp-admin/admin-ajax.php,
// только для залогиненного администратора). Покупатель этот режим не видит.
//
// Браузерный слой (Fabric + DOM), вне node:test. Чистая математика границ — в core/ZoneOverrides.js.
import { clampBox, brandBoxFromObject } from '../core/ZoneOverrides.js?v=20260723b';
import { fitTextToRect, isNumberZone, NUMBER_MAX_STRETCH } from '../core/ZoneManager.js?v=20260723b';

// Служебные origin-константы Fabric: фон рендерится от левого-верхнего угла (0,0).

const AJAX_URL = '/wp-admin/admin-ajax.php';

// Точка входа: включает редактор, только если в URL есть ?zones=edit.
export function initZoneEditor(app) {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get('zones') !== 'edit') return null;
  const editor = new ZoneEditor(app);
  editor.mount();
  return editor;
}

class ZoneEditor {
  constructor(app) {
    this.app = app;
    this.session = {};       // правки зон этой сессии: { formId: { zoneKey: box } }
    this.cropSession = {};   // правки кадрирования фона этой сессии: { formId: {x,y,w,h} }
    this.armedCanvases = new WeakSet(); // холсты, на которые уже повешен слушатель модификаций
    this.nonce = null;       // WP-nonce для сохранения (берём из boot-эндпоинта)
    this.bar = null;
    this.statusEl = null;
    this.cropMode = false;   // включён ли режим кадрирования фона
    this.cropBtn = null;
    this.cropImg = null;     // фон, временно ставший подвижным объектом в режиме кадрирования
    this.cropCanvas = null;
  }

  mount() {
    this.buildBar();
    // После каждой перерисовки стенда заново вооружаем рамки (renderZones их пересоздаёт).
    this.app._afterRender = () => this.armAll();
    this.armAll();
    this.fetchNonce();
  }

  // ── Панель редактора ──────────────────────────────────────────────
  buildBar() {
    const bar = document.createElement('div');
    Object.assign(bar.style, {
      position: 'fixed', left: '10px', bottom: '10px', zIndex: '2147483647',
      display: 'flex', flexDirection: 'column', gap: '6px',
      padding: '10px 12px', borderRadius: '10px',
      background: 'rgba(17,17,17,0.86)', color: '#fff',
      font: '13px/1.35 system-ui, sans-serif', boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
      maxWidth: '260px'
    });

    const title = document.createElement('div');
    title.textContent = 'Редактор зон';
    Object.assign(title.style, { fontWeight: '600', fontSize: '14px' });

    const hint = document.createElement('div');
    hint.textContent = 'Тяните и растягивайте рамки на макете, затем сохраните.';
    Object.assign(hint.style, { opacity: '0.8', fontSize: '12px' });

    const status = document.createElement('div');
    Object.assign(status.style, { fontSize: '12px', minHeight: '16px', opacity: '0.95' });
    this.statusEl = status;

    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', gap: '8px', marginTop: '2px' });

    const saveBtn = this.mkButton('Сохранить', '#1f5fd6');
    saveBtn.onclick = () => this.save();
    const resetBtn = this.mkButton('Отменить правки', 'rgba(255,255,255,0.18)');
    resetBtn.onclick = () => this.resetForm();

    row.append(saveBtn, resetBtn);

    // Вторая строка: кадрирование фона (Phase 2) — режет серые поля мокапа под конкретную форму.
    const cropRow = document.createElement('div');
    Object.assign(cropRow.style, { display: 'flex', gap: '8px' });
    const cropBtn = this.mkButton('Кадрировать фон', 'rgba(224,122,31,0.9)');
    cropBtn.onclick = () => this.toggleCrop();
    this.cropBtn = cropBtn;
    cropRow.append(cropBtn);

    bar.append(title, hint, status, row, cropRow);
    document.body.appendChild(bar);
    this.bar = bar;
  }

  mkButton(text, bg) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    Object.assign(b.style, {
      flex: '1', padding: '8px 10px', border: 'none', borderRadius: '7px',
      cursor: 'pointer', color: '#fff', background: bg, fontSize: '12px', fontWeight: '600'
    });
    return b;
  }

  setStatus(msg, ok = true) {
    if (this.statusEl) {
      this.statusEl.textContent = msg;
      this.statusEl.style.color = ok ? '#8fe388' : '#ff9a9a';
    }
  }

  // ── Вооружение рамок ──────────────────────────────────────────────
  // Делает пунктирные рамки текущего макета перетаскиваемыми/масштабируемыми.
  armAll() {
    for (const view of this.app.views.values()) {
      const canvas = view.canvas;
      if (!this.armedCanvases.has(canvas)) {
        canvas.on('object:modified', (e) => this.onModified(canvas, e.target));
        // Клиент: содержимое зоны (номер/надпись/лого) должно ехать и тянуться ВЖИВУЮ вместе с рамкой,
        // пока админ её двигает/масштабирует. moving+scaling тянут контент на каждом кадре, а не только на отпускании.
        canvas.on('object:moving', (e) => this._syncContent(canvas, e.target));
        canvas.on('object:scaling', (e) => this._syncContent(canvas, e.target));
        this.armedCanvases.add(canvas);
      }
      for (const overlay of view.zoneOverlays.values()) {
        overlay.set({
          selectable: true, evented: true, hasControls: true, hasBorders: true,
          lockRotation: true, cornerColor: '#1f5fd6', cornerStrokeColor: '#ffffff',
          transparentCorners: false, cornerSize: 12,
          fill: 'rgba(31,95,214,0.16)', hoverCursor: 'move'
        });
        if (overlay.setControlsVisibility) overlay.setControlsVisibility({ mtr: false });
      }
      // Бренд-монограммы Jetron (клиент 2026-07-22): делаем сам логотип перетаскиваемым/масштабируемым
      // прямо на холсте. lockUniScaling держит аспект знака. Оранжевые ручки — отличать от зон.
      for (const img of (view.brandObjects ? view.brandObjects.values() : [])) {
        img.set({
          selectable: true, evented: true, hasControls: true, hasBorders: true,
          lockRotation: true, lockUniScaling: true,
          cornerColor: '#e07a1f', cornerStrokeColor: '#ffffff',
          transparentCorners: false, cornerSize: 12, hoverCursor: 'move'
        });
        if (img.setControlsVisibility) img.setControlsVisibility({ mtr: false });
        img.setCoords();
      }
      canvas.requestRenderAll();
    }
  }

  // Пользователь перетащил/растянул рамку → пересчитываем box в долях холста.
  onModified(canvas, target) {
    if (target && target.brandKey) { this._onBrandModified(canvas, target); return; }
    if (!target || !target.zoneKey) return;
    // Запекаем масштаб в размеры, чтобы следующие правки считались от чистых width/height.
    target.set({
      width: target.width * target.scaleX,
      height: target.height * target.scaleY,
      scaleX: 1, scaleY: 1
    });
    const W = canvas.getWidth();
    const H = canvas.getHeight();
    const box = clampBox({
      x: target.left / W,
      y: target.top / H,
      w: target.width / W,
      h: target.height / H
    });
    const fid = this.app.formId;
    if (!this.session[fid]) this.session[fid] = {};
    this.session[fid][target.zoneKey] = box;
    // Финальная синхронизация содержимого с уже запечённой рамкой (scaleX/Y = 1, width/height актуальны).
    this._syncContent(canvas, target);
    this.setStatus(`Изменена зона: ${target.zoneKey}`);
  }

  // Админ передвинул/масштабировал бренд-монограмму → сохраняем её фактический бокс под ключом
  // бренда (chest_brand/shorts_brand) в ту же карту переопределений, что и зоны. resolveBrandBox
  // на стороне покупателя воспроизведёт эту позицию.
  _onBrandModified(canvas, img) {
    const box = brandBoxFromObject(img, canvas.getWidth(), canvas.getHeight());
    const fid = this.app.formId;
    if (!this.session[fid]) this.session[fid] = {};
    this.session[fid][img.brandKey] = box;
    this.setStatus(`Изменён логотип: ${img.brandKey}`);
  }

  // Ищет CanvasView по его Fabric-холсту (onModified/moving/scaling дают только canvas).
  _viewFor(canvas) {
    for (const view of this.app.views.values()) {
      if (view.canvas === canvas) return view;
    }
    return null;
  }

  // Двигает/масштабирует объект покупателя (номер, надпись, лого) вслед за рамкой зоны.
  // Текст перешрифтовывается под новый бокс (fitTextToRect, замер по глифам), картинка вписывается по меньшей стороне.
  _syncContent(canvas, overlay) {
    if (!overlay || !overlay.zoneKey) return;
    const view = this._viewFor(canvas);
    if (!view) return;
    const obj = view.userObjects.get(overlay.zoneKey);
    if (!obj) return;
    // Эффективный бокс в пикселях холста: во время scaling у рамки scaleX/Y ≠ 1.
    const left = overlay.left;
    const top = overlay.top;
    const width = overlay.width * (overlay.scaleX || 1);
    const height = overlay.height * (overlay.scaleY || 1);
    obj.set({ left: left + width / 2, top: top + height / 2 });
    if (obj.clipPath) obj.clipPath.set({ left, top, width, height });
    if (obj.text !== undefined) {
      fitTextToRect(obj, { width, height }, { maxStretch: isNumberZone(overlay.zoneKey) ? NUMBER_MAX_STRETCH : 1 });
    } else {
      const scale = Math.min(width / obj.width, height / obj.height);
      obj.set({ scaleX: scale, scaleY: scale });
    }
    obj.setCoords();
    canvas.requestRenderAll();
  }

  // Отменяет несохранённые правки текущей формы (зоны + кадр фона) и перерисовывает от сохранённого состояния.
  resetForm() {
    const fid = this.app.formId;
    delete this.session[fid];
    delete this.cropSession[fid];
    this.cropMode = false;
    if (this.cropBtn) this.cropBtn.textContent = 'Кадрировать фон';
    this.app.renderAll();
    this.setStatus('Несохранённые правки формы отменены.');
  }

  // ── Кадрирование фона (Phase 2) ───────────────────────────────────
  // Модель «фото за неподвижным окном»: в режиме кадрирования фон становится подвижным/масштабируемым,
  // а рамкой кадра служит сам холст. Так вид покупателя точно совпадает с тем, что видит админ
  // (пропорции кадра = пропорции холста, buyer-render это воспроизводит через scaleToWidth).
  toggleCrop() {
    if (this.cropMode) this.applyCrop();
    else this.enterCropMode();
  }

  enterCropMode() {
    const view = [...this.app.views.values()][0];
    if (!view) return;
    const canvas = view.canvas;
    const bg = canvas.backgroundImage;
    if (!bg) { this.setStatus('У этой формы нет фонового мокапа — кадрировать нечего.', false); return; }
    // Гасим рамки зон, чтобы не перехватывали клики и не мешали.
    for (const o of view.zoneOverlays.values()) o.set({ visible: false, evented: false, selectable: false });
    // Делаем фон подвижным объектом холста.
    bg.set({
      originX: 'left', originY: 'top',
      selectable: true, evented: true, hasControls: true, hasBorders: true,
      lockRotation: true, lockUniScaling: true,
      cornerColor: '#e07a1f', cornerStrokeColor: '#ffffff', transparentCorners: false,
      cornerSize: 12, hoverCursor: 'move'
    });
    if (bg.setControlsVisibility) bg.setControlsVisibility({ mtr: false });
    canvas.backgroundImage = null;
    canvas.add(bg);
    if (canvas.sendObjectToBack) canvas.sendObjectToBack(bg);
    canvas.setActiveObject(bg);
    canvas.requestRenderAll();
    this.cropMode = true;
    this.cropCanvas = canvas;
    this.cropImg = bg;
    if (this.cropBtn) this.cropBtn.textContent = 'Применить кадр';
    this.setStatus('Двигайте и масштабируйте мокап так, чтобы серые поля ушли за край. Затем «Применить кадр».');
  }

  applyCrop() {
    const box = this.computeCropBox();
    const fid = this.app.formId;
    if (box) this.cropSession[fid] = box;
    this.cropMode = false;
    if (this.cropBtn) this.cropBtn.textContent = 'Кадрировать фон';
    // Живой предпросмотр: кладём кадр в конфиг и перерисовываем от него (renderAll заново грузит фон с cropX/Y).
    if (box) this.app.config.bgCrops = { ...(this.app.config.bgCrops || {}), [fid]: box };
    this.app.renderAll();
    this.setStatus(box ? 'Кадр применён. Проверьте и нажмите «Сохранить».' : 'Кадр без изменений.');
  }

  // Переводит текущее положение/масштаб подвижного фона в долю источника, попадающую в окно-холст.
  computeCropBox() {
    const canvas = this.cropCanvas, bg = this.cropImg;
    if (!canvas || !bg) return null;
    const W = canvas.getWidth(), H = canvas.getHeight();
    const s = bg.scaleX || 1;
    const left = bg.left || 0, top = bg.top || 0;
    const imgW = bg.width, imgH = bg.height; // натуральные пиксели (в режиме кадра фон без crop)
    return clampBox({
      x: (0 - left) / s / imgW,
      y: (0 - top) / s / imgH,
      w: (W / s) / imgW,
      h: (H / s) / imgH
    });
  }

  // ── Сохранение ────────────────────────────────────────────────────
  // Берём nonce у mu-плагина: он отдаётся только администратору (проверка current_user_can на бэке).
  async fetchNonce() {
    try {
      const res = await fetch(`${AJAX_URL}?action=jetron_zones_boot`, { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (data && data.success && data.data && data.data.nonce) {
        this.nonce = data.data.nonce;
        this.setStatus('Готово к сохранению.');
      } else {
        this.setStatus('Войдите в админку WordPress, чтобы сохранять.', false);
      }
    } catch {
      this.setStatus('Не удалось связаться с сервером (нужен вход в админку).', false);
    }
  }

  // Итоговый zones.json = ранее сохранённые переопределения + правки этой сессии.
  mergedOverrides() {
    const base = this.app.config.zoneOverrides || {};
    const merged = {};
    for (const [f, zones] of Object.entries(base)) merged[f] = { ...zones };
    for (const [f, zones] of Object.entries(this.session)) merged[f] = { ...(merged[f] || {}), ...zones };
    return merged;
  }

  // Итоговый crops.json = ранее сохранённые кадры + правки кадрирования этой сессии.
  mergedCrops() {
    const base = this.app.config.bgCrops || {};
    const merged = {};
    for (const [f, c] of Object.entries(base)) merged[f] = c;
    for (const [f, c] of Object.entries(this.cropSession)) merged[f] = c;
    return merged;
  }

  // Один POST на admin-ajax: action + одно JSON-поле. Возвращает {ok, message}.
  async postPayload(action, field, payload) {
    const body = new FormData();
    body.append('action', action);
    body.append('_wpnonce', this.nonce);
    body.append(field, JSON.stringify(payload));
    const res = await fetch(AJAX_URL, { method: 'POST', credentials: 'include', body });
    const data = await res.json().catch(() => ({}));
    const ok = !!(data && data.success);
    const message = (data && data.data && data.data.message) ? data.data.message : (ok ? '' : 'сервер отклонил запрос');
    return { ok, message };
  }

  async save() {
    if (this.cropMode) this.applyCrop(); // не терять неприменённый кадр при сохранении
    if (!this.nonce) { await this.fetchNonce(); }
    if (!this.nonce) { this.setStatus('Нет доступа: войдите в админку WordPress.', false); return; }
    const mergedZones = this.mergedOverrides();
    const mergedCrops = this.mergedCrops();
    const hasCrops = Object.keys(this.cropSession).length > 0;
    this.setStatus('Сохраняю…');
    try {
      const z = await this.postPayload('jetron_save_zones', 'zones', mergedZones);
      if (!z.ok) { this.setStatus(`Зоны не сохранились: ${z.message}`, false); return; }
      this.app.config.zoneOverrides = mergedZones;
      this.session = {};

      if (hasCrops) {
        const c = await this.postPayload('jetron_save_crops', 'crops', mergedCrops);
        if (!c.ok) { this.setStatus(`Зоны сохранены, но кадр фона нет: ${c.message}`, false); return; }
        this.app.config.bgCrops = mergedCrops;
        this.cropSession = {};
      }
      this.setStatus('Сохранено. Обновите страницу у покупателей.');
    } catch (err) {
      this.setStatus(`Ошибка сохранения: ${err.message}`, false);
    }
  }
}
