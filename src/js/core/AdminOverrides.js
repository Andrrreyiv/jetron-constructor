// Настройки из админки поверх базового конфига (admin.json ← страница «Конструктор формы» в WP).
// Правило: битые или неполные данные НЕ должны ронять конструктор — такой раздел просто игнорируем
// и остаёмся на базовом конфиге. Цена ИЗДЕЛИЯ здесь не участвует: она идёт из карточки товара
// (см. CatalogPrices), поэтому prices.form из админки сознательно не читаем.

export function applyAdminOverrides(config, admin) {
  const out = clone(config);
  if (!admin || typeof admin !== 'object') return out;

  applyPrices(out, admin.prices);
  applySizes(out, admin.sizes);
  out.fonts = listOr(out.fonts, admin.fonts, isFont);
  out.colors = listOr(out.colors, admin.colors, isColor);
  out.forms = listOr(out.forms, admin.forms, isForm);
  return out;
}

function applyPrices(out, prices) {
  if (!prices || typeof prices !== 'object') return;
  // Группы нанесений: подставляем только те, где пришло корректное неотрицательное число.
  if (prices.placement && typeof prices.placement === 'object') {
    for (const [key, value] of Object.entries(prices.placement)) {
      if (isMoney(value)) out.prices.placement[key] = Number(value);
    }
  }
  if (isMoney(prices.gaiters)) out.prices.gaiters = Number(prices.gaiters);
  if (isMoney(prices.baseFee)) out.prices.baseFee = Number(prices.baseFee);
  if (prices.discounts && typeof prices.discounts === 'object') {
    for (const [key, value] of Object.entries(prices.discounts)) {
      if (isMoney(value)) out.prices.discounts[key] = Number(value);
    }
  }
}

function applySizes(out, sizes) {
  if (!sizes || typeof sizes !== 'object') return;
  for (const key of ['child', 'adult']) {
    const grid = sizes[key];
    if (isGrid(grid)) out.sizes[key] = clone(grid);
  }
}

// Пустой список из админки означает «не трогай», а не «удали всё»: иначе одна случайная
// очистка поля стёрла бы каталог у покупателей.
function listOr(base, list, isValid) {
  if (!Array.isArray(list)) return base;
  const clean = list.filter(isValid).map(clone);
  return clean.length ? clean : base;
}

const isMoney = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const str = (v) => typeof v === 'string' && v.trim() !== '';

const isGrid = (g) => !!g && typeof g === 'object'
  && Array.isArray(g.columns) && g.columns.length > 0
  && Array.isArray(g.rows) && g.rows.length > 0
  && g.rows.every((r) => Array.isArray(r) && r.length > 0);

const isFont = (f) => !!f && str(f.id) && str(f.name) && str(f.file);
const isColor = (c) => !!c && str(c.id) && str(c.name) && str(c.hex);
const isForm = (f) => !!f && str(f.id) && str(f.line) && str(f.colorId) && str(f.color)
  && !!f.images && str(f.images.front);

function clone(v) {
  return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
}
