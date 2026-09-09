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
    // sizeGrid — готовая таблица размеров модели из ACF-полей термина «Модель» (клиент 31.07
    // на видео показал: она уже заведена у него в админке, по каждой модели своя, с российским
    // размером у взрослой). Источник правды, заменяет угадывание по группам линеек.
    const grid = it.sizeGrid;
    const validGrid = grid && Array.isArray(grid.rows) && grid.rows.length && Array.isArray(grid.columns)
      ? grid
      : null;
    index.set(keyOf(it.model, it.color, it.age), {
      price,
      sizes: Array.isArray(it.sizes) ? it.sizes.filter((s) => typeof s === 'string' && s.trim() !== '') : [],
      sizeGrid: validGrid,
      // Адрес карточки этой расцветки (клиент 28.08) — приходит тем же ответом каталога.
      url: typeof it.url === 'string' ? it.url.trim() : '',
    });
  }
  return index;
}

// Написание расходится не только регистром — замер живого каталога 2026-09-07 (91 позиция)
// показал расхождение по СЛОВУ, которого нормализация не берёт: линейка Legend заведена
// в WooCommerce как «Легенда». Из-за этого шесть расцветок не находили свою карточку,
// и кнопка уводила на несуществующий раздел (клиент 2026-09-07: «перейти в карточку —
// пишет, что страница не найдена»). Замена пробуется ТОЛЬКО после точного совпадения.
// Тем же замером у трёх расцветок атрибут цвета разошёлся с самим товаром: «Легенда Голубой»
// лежит по адресу …sinyaya-legenda, «Фаворит Зелёный» и «Space Зелёный» — по …salatovaya.
const ЗАМЕНЫ_ЛИНЕЕК = { legend: ['Легенда'] };
// «Лаймовая Легенда» заведена как жёлтая — доказано картинкой её карточки
// (…/detskaya-igrovaya-futbolnaya-forma-lajm-l.png), а не догадкой по остатку.
// 2026-09-08: в конфиге эта расцветка переименована в «Жёлтый», и совпадение стало прямым.
// Строку «лаймовый» всё равно НЕ убираем: на боевом лежит свой `admin.json`, он замещает
// список форм целиком (см. AdminOverrides.listOr) и до его перевыкладки шлёт сюда «Лаймовый».
const ЗАМЕНЫ_ЦВЕТОВ = { синий: ['Голубой'], салатовый: ['Зелёный'], лаймовый: ['Жёлтый'] };

function hit(index, line, color, ageCategory) {
  if (!index || typeof index.get !== 'function') return null;
  let found = null;
  for (const l of [line, ...(ЗАМЕНЫ_ЛИНЕЕК[norm(line)] || [])]) {
    for (const c of [color, ...(ЗАМЕНЫ_ЦВЕТОВ[norm(color)] || [])]) {
      found = index.get(keyOf(l, c, ageCategory));
      if (found) break;
    }
    if (found) break;
  }
  if (!found) return null;
  // Индекс старого формата (только число) — поддерживаем, чтобы ничего не отвалилось.
  return typeof found === 'number' ? { price: found, sizes: [] } : found;
}

/**
 * Настоящая цена возраста в линейке — по её же соседним расцветкам. null = такого возраста
 * в линейке нет НИ В ОДНОЙ расцветке.
 *
 * Клиент 09.09 голосовым: «ну тогда и ставим запасные взрослые 1680, детские 1480, как бы
 * здесь без вариантов, это все игровые формы, и мы цены приравниваем к фактическим».
 * Общий запасной прайс конфига (1280/1090) не подходит ни одной линейке разом: New стоит 780,
 * Легенда и Фаворит — 1680/1480. Вести вторую таблицу цен руками не нужно и опасно (разъедется
 * с WooCommerce): цену линейки знает сам каталог. Замер боевого 09.09: у Фаворита взрослыми
 * заведены только Зелёный и Сиреневый, остальные три расцветки продавались за 1280 вместо
 * 1680 — минус 400 ₽ с изделия.
 *
 * Тот же ответ решает и вопрос «показывать ли возраст вообще»: у Чемпиона все 6 позиций
 * детские, взрослого нет нигде — значит его и предлагать нечего («зачем показывать взрослую
 * цену, если её у нас в природе нет»). А взрослый Фаворит существует, просто не доведён
 * по трём расцветкам, и прятать его нельзя.
 *
 * Цена берётся самая частая среди расцветок линейки: замер показал, что внутри линейки она
 * одна на всех, но одна кривая позиция не должна перетягивать остальные.
 */
export function resolveLinePrice(index, { line, ageCategory } = {}) {
  if (!index || typeof index.get !== 'function') return null;
  const линейки = [line, ...(ЗАМЕНЫ_ЛИНЕЕК[norm(line)] || [])].map(norm);
  const возраст = norm(ageCategory);
  const счёт = new Map();
  for (const [ключ, значение] of index) {
    const части = String(ключ).split('|');
    if (части[0] !== возраст || !линейки.includes(части[1])) continue;
    const цена = typeof значение === 'number' ? значение : значение && значение.price;
    if (!Number.isFinite(цена) || цена <= 0) continue;
    счёт.set(цена, (счёт.get(цена) || 0) + 1);
  }
  let лучшая = null;
  let максимум = 0;
  for (const [цена, сколько] of счёт) {
    if (сколько > максимум || (сколько === максимум && цена < лучшая)) { лучшая = цена; максимум = сколько; }
  }
  return лучшая;
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

/**
 * Готовая таблица размеров модели (Размер / Российский размер / Рост), заведённая клиентом
 * в ACF-полях термина «Модель» — 31.07 подтверждено видео и прямой проверкой полей на боевом.
 * null = у модели/возраста таблицы нет (например, взрослого Champion в каталоге не существует),
 * тогда вызывающая сторона остаётся на старой сетке из конфига + фильтр по размерам карточки.
 */
export function resolveFormSizeGrid(index, { line, color, ageCategory } = {}) {
  const found = hit(index, line, color, ageCategory);
  return found && found.sizeGrid ? found.sizeGrid : null;
}

/**
 * Адрес карточки товара этой расцветки. Клиент 28.08: кнопка над макетом должна вести в карточку
 * ИМЕННО показанной расцветки. Сопоставление «модель + цвет + возраст» у нас уже построено ради
 * цены — значит 45 адресов не нужно ни собирать руками, ни просить у клиента: их отдаёт тот же
 * каталог. '' = каталога нет (демо-стенд) или позиция не сопоставилась; тогда кнопка честно
 * остаётся ссылкой на раздел линейки.
 */
export function resolveFormProductUrl(index, { line, color, ageCategory } = {}) {
  const found = hit(index, line, color, ageCategory);
  return found && typeof found.url === 'string' ? found.url : '';
}

/**
 * Оттенки кружков расцветок из фильтра каталога: [{name, hex}, …] → Map по имени.
 *
 * Клиент 09.09: «цвет в конструкторе нужно самому выставлять? автоматически привязать нельзя?».
 * Можно: он ведёт эти оттенки у себя в поле «Цвет для иконки» расцветки, замер боевого 09.09
 * показал их заполненными у 14 расцветок из 14. По ИМЕНИ палитра сходится 14 из 14, а по коду
 * не совпал ни один; сильнее всего расходятся Салатовый и Розовый — ровно те два, что он и
 * сфотографировал. Мусор (пустой или неполный код) отбрасываем на индексации, чтобы расцветка
 * осталась со своим оттенком, а не с кружком неизвестного цвета.
 */
export function indexColorHexes(colors) {
  const index = new Map();
  for (const c of Array.isArray(colors) ? colors : []) {
    if (!c || typeof c.name !== 'string') continue;
    const hex = typeof c.hex === 'string' ? c.hex.trim().toLowerCase() : '';
    if (!/^#[0-9a-f]{6}$/.test(hex)) continue;
    index.set(norm(c.name), hex);
  }
  return index;
}

/** Оттенок нашей расцветки по её названию; не нашли — остаёмся на своём. */
export function resolveColorHex(index, name, fallback) {
  if (!index || typeof index.get !== 'function') return fallback;
  return index.get(norm(name)) || fallback;
}

/**
 * Подтягивает оттенки палитры с сайта. Правит список НА МЕСТЕ и возвращает число изменённых.
 *
 * `hexManual` — метка «оттенок задан руками» из раздела «Цвета кружков в фильтре»: такую
 * расцветку не трогаем, иначе ручная правка молча вернулась бы к значению каталога (жалоба
 * клиента 07.09 «поменял салатовый, а квадратик не поменялся», только с другой стороны).
 */
export function applyColorHexes(colors, index) {
  let changed = 0;
  for (const c of Array.isArray(colors) ? colors : []) {
    if (!c || c.hexManual) continue;
    const hex = resolveColorHex(index, c.name, '');
    if (!hex || hex === String(c.hex || '').toLowerCase()) continue;
    c.hex = hex;
    changed++;
  }
  return changed;
}
