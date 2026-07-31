import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexCatalogPrices, resolveFormPrice, resolveFormSizes, resolveFormSizeGrid } from '../src/js/core/CatalogPrices.js';

const items = [
  { model: 'Champion', color: 'Белый', age: 'adult', price: 1280 },
  { model: 'Champion', color: 'Белый', age: 'child', price: 1090 },
  { model: 'Champion', color: 'Жёлтый', age: 'child', price: 1090 },
  { model: 'Legend', color: 'Красный', age: 'adult', price: 1350 }
];

test('индекс находит цену по модели, цвету и возрасту', () => {
  const idx = indexCatalogPrices(items);
  assert.equal(resolveFormPrice(idx, { line: 'Champion', color: 'Белый', ageCategory: 'adult' }, 999), 1280);
  assert.equal(resolveFormPrice(idx, { line: 'Champion', color: 'Белый', ageCategory: 'child' }, 999), 1090);
  assert.equal(resolveFormPrice(idx, { line: 'Legend', color: 'Красный', ageCategory: 'adult' }, 999), 1350);
});

// В каталоге и в конфиге написание расходится: «Жёлтый»/«Желтый», разный регистр и пробелы.
// Без нормализации цена молча свалится на fallback и клиент снова увидит «не подтягивается».
test('сопоставление терпимо к ё/е, регистру и пробелам', () => {
  const idx = indexCatalogPrices(items);
  assert.equal(resolveFormPrice(idx, { line: 'champion', color: ' Желтый ', ageCategory: 'child' }, 999), 1090);
  assert.equal(resolveFormPrice(idx, { line: 'CHAMPION', color: 'белый', ageCategory: 'adult' }, 999), 1280);
});

// Нет совпадения или каталог недоступен — работаем на цене из конфига, а не роняем конструктор.
test('без совпадения и на пустом каталоге возвращает запасную цену', () => {
  const idx = indexCatalogPrices(items);
  assert.equal(resolveFormPrice(idx, { line: 'Space', color: 'Синий', ageCategory: 'adult' }, 1280), 1280);
  assert.equal(resolveFormPrice(indexCatalogPrices([]), { line: 'Champion', color: 'Белый', ageCategory: 'adult' }, 1280), 1280);
  assert.equal(resolveFormPrice(null, { line: 'Champion', color: 'Белый', ageCategory: 'adult' }, 1280), 1280);
});

// Мусор из сети (нет цены, нулевая цена, битые поля) не должен подменять цену конфига.
test('позиции без корректной цены игнорируются', () => {
  const idx = indexCatalogPrices([
    { model: 'Champion', color: 'Белый', age: 'adult', price: 0 },
    { model: 'Rich', color: 'Синий', age: 'adult', price: 'дорого' },
    { model: 'Star', age: 'adult', price: 1200 }
  ]);
  assert.equal(resolveFormPrice(idx, { line: 'Champion', color: 'Белый', ageCategory: 'adult' }, 1280), 1280);
  assert.equal(resolveFormPrice(idx, { line: 'Rich', color: 'Синий', ageCategory: 'adult' }, 1280), 1280);
});

test('индекс запоминает размеры карточки, разные у линеек', () => {
  const index = indexCatalogPrices([
    { model: 'New', color: 'Белый', age: 'adult', price: 780, sizes: ['M', 'L', 'XL'] },
    { model: 'Star', color: 'Белый', age: 'adult', price: 1180, sizes: ['L', 'XL', '2XL'] },
    { model: 'New', color: 'Белый', age: 'child', price: 780 }
  ]);
  assert.deepEqual(resolveFormSizes(index, { line: 'New', color: 'Белый', ageCategory: 'adult' }), ['M', 'L', 'XL']);
  assert.deepEqual(resolveFormSizes(index, { line: 'Star', color: 'Белый', ageCategory: 'adult' }), ['L', 'XL', '2XL']);
  assert.deepEqual(resolveFormSizes(index, { line: 'New', color: 'Белый', ageCategory: 'child' }), [], 'атрибут не заполнен — пусто');
  assert.deepEqual(resolveFormSizes(index, { line: 'Venom', color: 'Белый', ageCategory: 'adult' }), [], 'нет карточки — пусто');
  assert.equal(resolveFormPrice(index, { line: 'Star', color: 'Белый', ageCategory: 'adult' }, 1280), 1180, 'цена не сломалась');
});

// Клиент 31.07 (видео): у каждой модели своя таблица размеров в ACF-полях термина «Модель»,
// с российским размером у взрослой. Она приходит от сервера уже готовой (title/columns/rows) —
// это источник правды, вместо угадывания групп линеек (bug 30.07: Winner показывал сетку Star).
test('готовая сетка модели (sizeGrid) приходит из индекса как есть', () => {
  const grid = {
    title: 'Взрослые размеры',
    columns: ['Размер на бирке', 'Российский размер', 'Рост, см'],
    rows: [['S', '44 (XS) RU', '160-168'], ['M', '46 (S) RU', '165-173']],
  };
  const index = indexCatalogPrices([
    { model: 'Winner', color: 'Красный', age: 'adult', price: 1280, sizeGrid: grid },
    { model: 'Champion', color: 'Белый', age: 'adult', price: 1280, sizeGrid: null },
  ]);
  assert.deepEqual(resolveFormSizeGrid(index, { line: 'Winner', color: 'Красный', ageCategory: 'adult' }), grid);
  assert.equal(resolveFormSizeGrid(index, { line: 'Champion', color: 'Белый', ageCategory: 'adult' }), null, 'пустая сетка (нет ACF-данных) — null, а не мусор');
  assert.equal(resolveFormSizeGrid(index, { line: 'Venom', color: 'Белый', ageCategory: 'adult' }), null, 'нет карточки — null');
  assert.equal(resolveFormSizeGrid(null, { line: 'Winner', color: 'Красный', ageCategory: 'adult' }), null, 'каталог недоступен — null, вызывающая сторона падает на конфиг');
});

// Битая форма (без rows/columns, будущая порча ACF-ответа) не должна долетать до рендера как есть.
test('sizeGrid без rows/columns отбрасывается на индексации', () => {
  const index = indexCatalogPrices([
    { model: 'Rich', color: 'Синий', age: 'adult', price: 1280, sizeGrid: { title: 'битая' } },
    { model: 'Star', color: 'Синий', age: 'adult', price: 1280, sizeGrid: { columns: ['a'], rows: [] } },
  ]);
  assert.equal(resolveFormSizeGrid(index, { line: 'Rich', color: 'Синий', ageCategory: 'adult' }), null);
  assert.equal(resolveFormSizeGrid(index, { line: 'Star', color: 'Синий', ageCategory: 'adult' }), null, 'пустой rows тоже не считается сеткой');
});
