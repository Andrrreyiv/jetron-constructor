// Ядро редактора зон: чистые функции (тестируются в node, без DOM/Fabric).
// Админ двигает/тянет зоны на холсте → сохраняем per-form переопределения box в zones.json.

const MIN = 0.02; // минимальный размер зоны в долях холста (чтобы не схлопнуть в точку)
const r4 = (v) => Math.round(v * 1e4) / 1e4; // чистим floating-point хвост для zones.json

// Зажимает box в пределы холста [0,1] и не даёт зоне вылезти за правый/нижний край.
export function clampBox(box = {}) {
  const x = Math.min(Math.max(box.x, 0), 1 - MIN);
  const y = Math.min(Math.max(box.y, 0), 1 - MIN);
  const w = Math.min(Math.max(box.w, MIN), 1 - x);
  const h = Math.min(Math.max(box.h, MIN), 1 - y);
  return { x: r4(x), y: r4(y), w: r4(w), h: r4(h) };
}

// Накладывает per-form переопределения box поверх базовых зон формы.
// overrides: { <formId>: { <zoneKey>: {x,y,w,h} } }. Возвращает новый массив (без мутаций).
export function applyZoneOverrides(zones, formId, overrides) {
  const forForm = overrides && overrides[formId];
  if (!forForm) return zones;
  return zones.map((z) => {
    const ov = forForm[z.key];
    if (!ov) return z;
    return { ...z, box: clampBox(ov) };
  });
}

// Проверяет структуру zones.json на границе (админ мог записать мусор).
// Ждём: { <formId>: { <zoneKey>: {x,y,w,h — числа} } }. Пустой объект валиден.
export function validateOverrides(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false };
  for (const form of Object.values(obj)) {
    if (!form || typeof form !== 'object' || Array.isArray(form)) return { ok: false };
    for (const box of Object.values(form)) {
      if (!box || typeof box !== 'object') return { ok: false };
      const bad = ['x', 'y', 'w', 'h'].some((k) => typeof box[k] !== 'number');
      if (bad) return { ok: false };
    }
  }
  return { ok: true };
}

// Проверяет структуру crops.json на границе. В отличие от zones (вложенные {form:{key:box}}),
// кадры фона ПЛОСКИЕ: { <formId>: {x,y,w,h — числа} } — один кадр на форму. Пустой объект валиден.
export function validateCrops(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false };
  for (const box of Object.values(obj)) {
    if (!box || typeof box !== 'object' || Array.isArray(box)) return { ok: false };
    const bad = ['x', 'y', 'w', 'h'].some((k) => typeof box[k] !== 'number');
    if (bad) return { ok: false };
  }
  return { ok: true };
}

// Бренд-монограмма Jetron (ТЗ §5). Клиент 2026-07-22: логотип должен быть виден всегда и админ
// двигает его сам — позиция хранится в zones.json под собственным ключом (chest_brand/shorts_brand),
// отдельно от покупательских зон. Сохранённая позиция побеждает; иначе — бокс по умолчанию,
// центрированный на зоне-якоре (грудь/шорты). overrides — та же карта { formId: { key: box } }.
export function resolveBrandBox(overrides, formId, brandKey, anchorBox, size = { w: 0.09, h: 0.033 }) {
  const saved = overrides && overrides[formId] && overrides[formId][brandKey];
  if (saved) return { x: saved.x, y: saved.y, w: saved.w, h: saved.h };
  const cx = anchorBox.x + anchorBox.w / 2;
  const cy = anchorBox.y + anchorBox.h / 2;
  return { x: cx - size.w / 2, y: cy - size.h / 2, w: size.w, h: size.h };
}

// Обратный перевод: из Fabric-объекта бренда (originX/Y = center, масштаб scaleX/Y) в долевой
// bounding-box холста (top-left + размеры) для сохранения. Храним фактический размер картинки на
// экране — её аспект, поэтому resolveBrandBox+placeStaticImage воспроизводят её один-в-один.
export function brandBoxFromObject(obj, W, H) {
  const dispW = obj.width * (obj.scaleX || 1);
  const dispH = obj.height * (obj.scaleY || 1);
  return clampBox({
    x: (obj.left - dispW / 2) / W,
    y: (obj.top - dispH / 2) / H,
    w: dispW / W,
    h: dispH / H
  });
}

// Phase 2: перевод долевого crop фона в пиксельный прямоугольник источника для Fabric (cropX/Y + width/height).
// crop: { x,y,w,h } — доля исходного изображения, которую оставляем. Полный кадр или отсутствие → null
// (значит «кадрировать не нужно», рендерим изображение целиком как раньше).
export function cropToImageRect(crop, imgW, imgH) {
  if (!crop) return null;
  const { x = 0, y = 0, w = 1, h = 1 } = crop;
  if (x <= 0 && y <= 0 && w >= 1 && h >= 1) return null;
  return {
    cropX: Math.round(x * imgW),
    cropY: Math.round(y * imgH),
    cropWidth: Math.round(w * imgW),
    cropHeight: Math.round(h * imgH)
  };
}
