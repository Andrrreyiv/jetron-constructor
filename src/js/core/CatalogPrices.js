// Цена изделия из карточки товара WooCommerce (клиент 27.07: «не подтягивается цена из карточки»).
// Каталог отдаёт позиции {model, color, age, price}: атрибуты товара «Модель» и «Цвет» совпадают
// с line/color формы конструктора, а категория («Взрослая форма»/«Детская форма») даёт возраст.
// Цена из каталога — источник правды; прайс в конфиге остаётся запасным (каталог недоступен/нет позиции).

// Написание в каталоге и в конфиге расходится («Жёлтый»/«Желтый», регистр, лишние пробелы),
// поэтому ключ строим по нормализованному виду — иначе цена молча свалится на запасную.
function norm(v) {
  return String(v == null ? '' : v).trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

function keyOf(model, color, age) {
  return `${norm(age)}|${norm(model)}|${norm(color)}`;
}

export function indexCatalogPrices(items) {
  const index = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    if (!it) continue;
    const price = Number(it.price);
    // Ноль/NaN/строка — это не цена: такую позицию пропускаем, чтобы не затереть цену конфига.
    if (!Number.isFinite(price) || price <= 0) continue;
    if (!it.model || !it.color) continue;
    // Кроме цены запоминаем набор размеров карточки: у линеек он разный (клиент 30.07).
    index.set(keyOf(it.model, it.color, it.age), {
      price,
      sizes: Array.isArray(it.sizes) ? it.sizes.filter((s) => typeof s === 'string' && s.trim() !== '') : [],
    });
  }
  return index;
}

function hit(index, line, color, ageCategory) {
  if (!index || typeof index.get !== 'function') return null;
  const found = index.get(keyOf(line, color, ageCategory));
  if (!found) return null;
  // Индекс старого формата (только число) — поддерживаем, чтобы ничего не отвалилось.
  return typeof found === 'number' ? { price: found, sizes: [] } : found;
}

export function resolveFormPrice(index, { line, color, ageCategory } = {}, fallback) {
  const found = hit(index, line, color, ageCategory);
  return found && Number.isFinite(found.price) && found.price > 0 ? found.price : fallback;
}

/** Размеры карточки выбранной формы. Пусто = каталог не ответил или атрибут не заполнен. */
export function resolveFormSizes(index, { line, color, ageCategory } = {}) {
  const found = hit(index, line, color, ageCategory);
  return found && Array.isArray(found.sizes) ? found.sizes : [];
}
