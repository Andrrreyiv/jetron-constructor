// Обёртка над Fabric.js v6 для стенда конструктора.
// Только браузерный слой (DOM + canvas) — не покрывается node:test, поэтому суффикс .browser.js.
// Вся чистая логика (цена, геометрия зон, валидация) вынесена в core/ и тестируется.
import * as fabric from 'fabric';
import { zoneToRect, fitFontSize } from '../core/ZoneManager.js';

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

  async setBackground(url) {
    const img = await fabric.FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
    img.set({ selectable: false, evented: false });
    img.scaleToWidth(this.canvas.getWidth());
    this.canvas.backgroundImage = img;
    this.canvas.requestRenderAll();
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
    obj.set({ lockScalingX: true, lockScalingY: true, lockRotation: true, hasControls: false });
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
    img.set({ lockScalingX: true, lockScalingY: true, lockRotation: true, hasControls: false });
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
