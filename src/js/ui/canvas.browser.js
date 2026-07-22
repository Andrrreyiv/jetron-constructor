// Обёртка над Fabric.js v6 для стенда конструктора.
// Только браузерный слой (DOM + canvas) — не покрывается node:test, поэтому суффикс .browser.js.
// Вся чистая логика (цена, геометрия зон, валидация) вынесена в core/ и тестируется.
import * as fabric from 'fabric';
import { zoneToRect, fitFontSize } from '../core/ZoneManager.js';
import { cropToImageRect } from '../core/ZoneOverrides.js';

export class CanvasView {
  constructor(canvasEl, canvasCfg) {
    const displayWidth = canvasCfg.displayWidth || canvasCfg.width;
    const displayHeight = displayWidth * (canvasCfg.height / canvasCfg.width);
    this.canvas = new fabric.Canvas(canvasEl, {
      width: displayWidth,
      height: displayHeight,
      preserveObjectStacking: true,
      selection: true,
      // Клиент 2026-07-16: на телефоне страница не скроллилась — Fabric перехватывал тач на холсте.
      // allowTouchScrolling пропускает вертикальный свайп странице (скролл работает поверх картинки).
      allowTouchScrolling: true
    });
    this.zoneOverlays = new Map(); // key -> fabric.Rect (пунктирная рамка зоны)
    this.userObjects = new Map();  // key -> объект, помещённый покупателем
    this.staticObjects = [];       // служебные надписи бренда (Jetron.ru) — не редактируются покупателем
    this.onChange = () => {};
    this.canvas.on('object:modified', () => this.onChange());
  }

  get el() {
    return this.canvas;
  }

  _rect(box) {
    return zoneToRect(box, { width: this.canvas.getWidth(), height: this.canvas.getHeight() });
  }

  // crop — per-form кадрирование фона (доля исходника, которую оставляем), режет серые поля мокапа.
  // null/полный кадр → показываем изображение целиком, как раньше.
  async setBackground(url, crop = null) {
    const img = await fabric.FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
    img.set({ selectable: false, evented: false });
    const rect = cropToImageRect(crop, img.width, img.height);
    if (rect) {
      // Fabric показывает подобласть источника через cropX/cropY + width/height (в пикселях источника).
      img.set({ cropX: rect.cropX, cropY: rect.cropY, width: rect.cropWidth, height: rect.cropHeight });
    }
    // scaleToWidth в этом билде Fabric v6 берёт натуральную ширину элемента, игнорируя обрезанную
    // width, поэтому кадрированный фон масштабировался неверно (влезала вся картинка). Считаем
    // масштаб явно от текущей (уже кадрированной) width — видимая область точно вписывается в холст.
    const scale = this.canvas.getWidth() / img.width;
    img.set({ scaleX: scale, scaleY: scale });
    // Клиент 2026-07-22: у мокапов разная пропорция (Champion 3:4, Venom ~11:10 и др.), а высота холста
    // была жёстко 3:4. У широких макетов картинка после вписывания по ширине оказывалась ниже холста —
    // снизу оставалась пустая серая полоса под гетрами. Подгоняем высоту холста ровно под вписанную
    // картинку: серого поля не остаётся, и дробные координаты общего zoneTemplate ложатся на всю
    // картинку одинаково для любой пропорции (раньше на широких формах зоны были сжаты кверху).
    const fittedHeight = img.height * scale;
    if (Math.abs(this.canvas.getHeight() - fittedHeight) > 0.5) {
      this.canvas.setDimensions({ height: fittedHeight });
    }
    this.canvas.backgroundImage = img;
    this.canvas.requestRenderAll();
  }

  // Средняя яркость (0..255) фона-мокапа под боксом-зоной (доли 0..1 холста). Нужна, чтобы выбрать
  // цвет бренд-монограммы под ткань: тёмная ткань → белый знак, светлая → чёрный. null, если фона нет.
  bgLuminanceAt(box) {
    const bg = this.canvas.backgroundImage;
    if (!bg) return null;
    const el = bg.getElement ? bg.getElement() : bg._element;
    if (!el || !el.width) return null;
    const cropX = bg.cropX || 0, cropY = bg.cropY || 0;
    const w = bg.width, h = bg.height; // видимая (кадрированная) область источника
    const sx = Math.round(cropX + box.x * w);
    const sy = Math.round(cropY + box.y * h);
    const sw = Math.max(1, Math.round(box.w * w));
    const sh = Math.max(1, Math.round(box.h * h));
    const S = 8; // даунсэмпл региона в 8x8 — усредняем цвет ткани
    const off = document.createElement('canvas');
    off.width = S; off.height = S;
    const ctx = off.getContext('2d', { willReadFrequently: true });
    try {
      ctx.drawImage(el, sx, sy, sw, sh, 0, 0, S, S);
      const data = ctx.getImageData(0, 0, S, S).data;
      let sum = 0, n = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        n++;
      }
      return n ? sum / n : null;
    } catch {
      return null; // taint/CORS — не критично, вызывающий возьмёт цвет по умолчанию
    }
  }

  // Нейтральный холст без мокапа тела — для вида «плечо» (ТЗ §9.3: лого отдельной картинкой сбоку).
  setNeutral(color = '#eef1f5') {
    this.canvas.backgroundImage = null;
    this.canvas.backgroundColor = color;
    this.canvas.requestRenderAll();
  }

  // Пунктирные рамки зон текущего вида — покупатель видит, куда можно поместить элемент.
  renderZones(zones) {
    this.clearAll();
    for (const z of zones) {
      const r = this._rect(z.box);
      const overlay = new fabric.Rect({
        left: r.left, top: r.top, width: r.width, height: r.height,
        fill: 'rgba(31,95,214,0.06)', stroke: 'rgba(31,95,214,0.9)',
        strokeDashArray: [6, 4], strokeWidth: 1.5,
        selectable: false, evented: true, hoverCursor: 'pointer',
        objectCaching: false
      });
      overlay.zoneKey = z.key;
      this.zoneOverlays.set(z.key, overlay);
      this.canvas.add(overlay);
    }
    this.canvas.requestRenderAll();
  }

  onZoneClick(handler) {
    this.canvas.on('mouse:down', (opt) => {
      const t = opt.target;
      if (t && t.zoneKey) handler(t.zoneKey);
    });
  }

  _clipFor(zone) {
    const r = this._rect(zone.box);
    return new fabric.Rect({
      left: r.left, top: r.top, width: r.width, height: r.height,
      absolutePositioned: true
    });
  }

  placeText(zone, text, fontFamily, color) {
    this.removeFromZone(zone.key);
    const r = this._rect(zone.box);
    const fontSize = fitFontSize({ text, rect: r });
    const obj = new fabric.IText(text, {
      left: r.left + r.width / 2,
      top: r.top + r.height / 2,
      originX: 'center', originY: 'center',
      fontFamily: fontFamily || 'sans-serif',
      fontSize,
      fill: color || '#ffffff',
      textAlign: 'center',
      clipPath: this._clipFor(zone)
    });
    // Клиент: не давать менять размер полей на макете — убираем ручки масштаба/поворота,
    // элемент остаётся выделяемым и удаляемым, но не тянется по размеру.
    // hasBorders:false — убираем бирюзовую рамку выделения Fabric. Клиент 2026-07-17 (Safari):
    // «появилась вторая рамка» — поверх пунктирной рамки зоны Fabric рисовал свою рамку выделения,
    // получалось две рамки. Удаление элемента идёт через × в панели (removeFromZone по ключу),
    // а не через выделение на холсте, поэтому рамка выделения не нужна и только путает.
    obj.set({ lockScalingX: true, lockScalingY: true, lockRotation: true, hasControls: false, hasBorders: false });
    obj.zoneKey = zone.key;
    this.userObjects.set(zone.key, obj);
    this.canvas.add(obj);
    this.canvas.setActiveObject(obj);
    this.canvas.requestRenderAll();
    this.onChange();
    return obj;
  }

  async placeImage(zone, url) {
    this.removeFromZone(zone.key);
    const r = this._rect(zone.box);
    const img = await fabric.FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
    const scale = Math.min(r.width / img.width, r.height / img.height);
    img.set({
      left: r.left + r.width / 2,
      top: r.top + r.height / 2,
      originX: 'center', originY: 'center',
      scaleX: scale, scaleY: scale,
      clipPath: this._clipFor(zone)
    });
    // Клиент: не давать менять размер логотипа/картинки на макете — фиксируем масштаб и поворот.
    // hasBorders:false — та же бирюзовая рамка выделения Fabric, что и у текста (см. placeText). Убираем.
    img.set({ lockScalingX: true, lockScalingY: true, lockRotation: true, hasControls: false, hasBorders: false });
    img.zoneKey = zone.key;
    this.userObjects.set(zone.key, img);
    this.canvas.add(img);
    this.canvas.setActiveObject(img);
    this.canvas.requestRenderAll();
    this.onChange();
    return img;
  }

  // Надпись бренда «Jetron.ru» (ТЗ §5): рисуется в заданном боксе, не выделяется/не двигается.
  placeStaticText(box, text, color) {
    const r = this._rect(box);
    const fontSize = fitFontSize({ text, rect: r });
    const obj = new fabric.IText(text, {
      left: r.left + r.width / 2,
      top: r.top + r.height / 2,
      originX: 'center', originY: 'center',
      fontFamily: 'sans-serif',
      fontSize,
      fill: color || '#111111',
      textAlign: 'center',
      selectable: false, evented: false,
      clipPath: new fabric.Rect({ left: r.left, top: r.top, width: r.width, height: r.height, absolutePositioned: true })
    });
    this.staticObjects.push(obj);
    this.canvas.add(obj);
    this.canvas.requestRenderAll();
    return obj;
  }

  // Логотип бренда «JETRON.RU» картинкой (ТЗ §5): вписывается в бокс, не выделяется/не двигается.
  // imgEl — предзагруженный HTMLImageElement (грузится один раз в App.loadBranding).
  placeStaticImage(box, imgEl) {
    const r = this._rect(box);
    const img = new fabric.FabricImage(imgEl, {
      originX: 'center', originY: 'center',
      selectable: false, evented: false
    });
    const scale = Math.min(r.width / img.width, r.height / img.height);
    img.set({
      left: r.left + r.width / 2,
      top: r.top + r.height / 2,
      scaleX: scale, scaleY: scale,
      clipPath: new fabric.Rect({ left: r.left, top: r.top, width: r.width, height: r.height, absolutePositioned: true })
    });
    this.staticObjects.push(img);
    this.canvas.add(img);
    this.canvas.requestRenderAll();
    return img;
  }

  clearStatic() {
    for (const o of this.staticObjects) this.canvas.remove(o);
    this.staticObjects = [];
    this.canvas.requestRenderAll();
  }

  removeFromZone(key) {
    const existing = this.userObjects.get(key);
    if (existing) {
      this.canvas.remove(existing);
      this.userObjects.delete(key);
      this.canvas.requestRenderAll();
    }
  }

  removeActive() {
    const active = this.canvas.getActiveObject();
    if (active && active.zoneKey) {
      this.removeFromZone(active.zoneKey);
      this.onChange();
    }
  }

  usedZoneKeys() {
    return [...this.userObjects.keys()];
  }

  clearAll() {
    for (const o of this.zoneOverlays.values()) this.canvas.remove(o);
    for (const o of this.userObjects.values()) this.canvas.remove(o);
    for (const o of this.staticObjects) this.canvas.remove(o);
    this.zoneOverlays.clear();
    this.userObjects.clear();
    this.staticObjects = [];
    this.canvas.requestRenderAll();
  }

  // Экспорт вида в PNG без пунктирных рамок зон (они — служебные, не часть товара).
  toDataURL() {
    for (const o of this.zoneOverlays.values()) o.visible = false;
    this.canvas.discardActiveObject();
    this.canvas.renderAll();
    const url = this.canvas.toDataURL({ format: 'png', multiplier: 2 });
    for (const o of this.zoneOverlays.values()) o.visible = true;
    this.canvas.renderAll();
    return url;
  }

  dispose() {
    this.canvas.dispose();
  }
}
