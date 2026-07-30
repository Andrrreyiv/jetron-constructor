// Размеры из карточки товара (клиент 30.07: «важно, чтобы подтянулась именно та таблица размеров,
// которая в карточке выбранной линейки»). У линеек РАЗНЫЕ наборы: New взрослая M…4XL, Star L…5XL,
// Winner детская 4XS…M. Единая таблица показывала всем 44 RU (XS)…54 RU (2XL), и покупатель мог
// выбрать размер, которого у этой формы нет. Здесь чистое сопоставление сетки с набором из карточки.

/** Ключ размера: «44 RU (XS)» → «XS», «  m » → «M», «2XL» → «2XL». */
export function sizeKey(label) {
  const raw = String(label == null ? '' : label).trim();
  if (!raw) return '';
  const inBrackets = raw.match(/\(([^)]+)\)/);
  const core = inBrackets ? inBrackets[1] : raw;
  return core.trim().toUpperCase().replace(/\s+/g, '').replace(/^XXL$/, '2XL').replace(/^XXXL$/, '3XL');
}

/** Набор размеров карточки в виде ключей. Принимает массив или строку «M, L, XL» / «M/L/XL». */
export function sizeKeySet(sizes) {
  const list = Array.isArray(sizes) ? sizes : String(sizes == null ? '' : sizes).split(/[,/;]/);
  const out = [];
  for (const s of list) {
    const k = sizeKey(s);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * Оставить в сетке только размеры выбранной карточки, сохранив порядок сетки.
 * Размеры карточки, которых в сетке нет, дописываются в конец: покупатель должен иметь
 * возможность их выбрать, даже если пояснение по росту для них ещё не заведено.
 * Пустой набор из карточки (каталог не ответил) — возвращаем сетку как есть.
 */
export function filterGridBySizes(grid, sizes) {
  if (!grid || !Array.isArray(grid.rows) || !Array.isArray(grid.columns)) return grid;
  const keys = sizeKeySet(sizes);
  if (!keys.length) return grid;

  const rows = grid.rows.filter((row) => keys.includes(sizeKey(row && row[0])));
  const покрыто = rows.map((row) => sizeKey(row[0]));
  const extras = keys
    .filter((k) => !покрыто.includes(k))
    .map((k) => {
      const row = new Array(grid.columns.length).fill('—');
      row[0] = k;
      return row;
    });

  return { ...grid, rows: [...rows, ...extras] };
}
