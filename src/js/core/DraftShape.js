// Форма черновика: что кладём в хранилище и что берём обратно (п. 7 клиента 07.09).
// Модуль чистый — конфиг и состояние приходят параметрами, браузер не нужен.

// Черновик приходит из хранилища, то есть из прошлой версии сайта, чужого расширения
// или просто вчерашнего каталога. Всё, чего нет в СЕГОДНЯШНЕМ конфиге, выбрасывается:
// лучше вернуть покупателю часть работы, чем нарисовать форму, которой нет в продаже.
export function sanitizeDraft(draft, config) {
  if (!draft || typeof draft !== 'object') return null;
  const safe = {};
  const form =(config.forms || []).find((f) => f.id === draft.formId);
  if (form) {
    safe.formId = form.id;
    safe.colorId = form.colorId; // пара «форма+цвет» берётся из конфига, а не из черновика
  }
  if (draft.ageCategory === 'adult' || draft.ageCategory === 'child') safe.ageCategory = draft.ageCategory;
  if (Number.isInteger(draft.quantity) && draft.quantity > 0) safe.quantity = draft.quantity;
  if (typeof draft.gaiters === 'boolean') safe.gaiters = draft.gaiters;
  if (draft.jetron && typeof draft.jetron === 'object') {
    safe.jetron = { chest: draft.jetron.chest === true, back: draft.jetron.back === true };
  }
  const known = new Set((config.placementOptions || []).map((o) => o.id));
  const onlyKnown = (bag) => Object.fromEntries(Object.entries(bag).filter(([id]) => known.has(id)));
  if (draft.optCache && typeof draft.optCache === 'object') safe.optCache = onlyKnown(draft.optCache);
  if (draft.optShown && typeof draft.optShown === 'object') safe.optShown = onlyKnown(draft.optShown);
  return safe;
}

// Размер намеренно НЕ сохраняем: список размеров зависит от каталога и возраста,
// и вчерашний размер сегодня может отсутствовать в сетке — покупатель увидел бы
// пустой выбор при заполненной цене. Пусть выбирает заново, это одно нажатие.
export function snapshotOf(app) {
  return {
    formId: app.formId,
    colorId: app.colorId,
    ageCategory: app.ageCategory,
    gaiters: app.gaiters,
    quantity: app.quantity,
    jetron: { chest: app.jetron.chest, back: app.jetron.back },
    optCache: app.optCache,
    optShown: app.optShown
  };
}
