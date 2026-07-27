import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexCatalogPrices, resolveFormPrice } from '../src/js/core/CatalogPrices.js';

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
