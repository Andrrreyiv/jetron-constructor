import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyAdminOverrides } from '../src/js/core/AdminOverrides.js';

const base = JSON.parse(
  readFileSync(fileURLToPath(new URL('../src/config/mock-config.json', import.meta.url)), 'utf8')
);

test('пустые настройки не меняют конфиг', () => {
  const r = applyAdminOverrides(base, null);
  assert.equal(r.prices.placement.name_number, base.prices.placement.name_number);
  assert.equal(r.fonts.length, base.fonts.length);
});

// Владелец меняет прайс нанесений в админке: подставляются только переданные группы.
test('цены нанесений: заданные группы перекрываются, остальные остаются', () => {
  const r = applyAdminOverrides(base, { prices: { placement: { name_number: 750 }, gaiters: 500 } });
  assert.equal(r.prices.placement.name_number, 750);
  assert.equal(r.prices.placement.chest_logo_small, base.prices.placement.chest_logo_small);
  assert.equal(r.prices.gaiters, 500);
});

// Цена изделия приходит из карточки товара — админка её не трогает даже если прислали.
test('цена изделия из админки игнорируется', () => {
  const r = applyAdminOverrides(base, { prices: { form: { adult: 1, child: 1 } } });
  assert.equal(r.prices.form.adult, base.prices.form.adult);
  assert.equal(r.prices.form.child, base.prices.form.child);
});

test('мусор вместо цены игнорируется, база сохраняется', () => {
  const r = applyAdminOverrides(base, { prices: { placement: { name_number: 'дорого', chest_number: -5 }, gaiters: null } });
  assert.equal(r.prices.placement.name_number, base.prices.placement.name_number);
  assert.equal(r.prices.placement.chest_number, base.prices.placement.chest_number);
  assert.equal(r.prices.gaiters, base.prices.gaiters);
});

test('размерная сетка заменяется целиком, если структура верная', () => {
  const grid = { title: 'Взрослые', columns: ['Размер'], rows: [['S'], ['M']] };
  const r = applyAdminOverrides(base, { sizes: { adult: grid } });
  assert.deepEqual(r.sizes.adult, grid);
  assert.deepEqual(r.sizes.child, base.sizes.child);
});

test('битая сетка не ломает таблицу размеров', () => {
  const r = applyAdminOverrides(base, { sizes: { adult: { columns: 'нет', rows: null } } });
  assert.deepEqual(r.sizes.adult, base.sizes.adult);
});

// Шрифты и цвета владелец ведёт списком: пустой список — это «не трогай», а не «удали всё».
test('шрифты и цвета заменяются списком, пустой список игнорируется', () => {
  const fonts = [{ id: 'my', name: 'Мой', file: 'assets/fonts/my.ttf', cyrillic: true }];
  const r = applyAdminOverrides(base, { fonts, colors: [] });
  assert.deepEqual(r.fonts, fonts);
  assert.equal(r.colors.length, base.colors.length);
});

test('позиции без обязательных полей выкидываются', () => {
  const r = applyAdminOverrides(base, { fonts: [{ id: 'ok', name: 'Ок', file: 'assets/fonts/a.ttf' }, { name: 'без id' }] });
  assert.equal(r.fonts.length, 1);
  assert.equal(r.fonts[0].id, 'ok');
});

// Новая модель из админки должна попасть в каталог и карусель.
test('модели: список из админки заменяет каталог форм', () => {
  const forms = [{ id: 'x-white', line: 'X', colorId: 'white', color: 'Белый', colorHex: '#fff',
    images: { front: 'assets/mockups/a.png', back: 'assets/mockups/a.png' } }];
  const r = applyAdminOverrides(base, { forms });
  assert.equal(r.forms.length, 1);
  assert.equal(r.forms[0].id, 'x-white');
});

test('форма без картинки не попадает в каталог', () => {
  const r = applyAdminOverrides(base, { forms: [{ id: 'bad', line: 'X', colorId: 'white', color: 'Б', colorHex: '#fff' }] });
  assert.deepEqual(r.forms, base.forms);
});

// Исходный конфиг не должен мутировать: он же общий объект приложения.
test('базовый конфиг не мутируется', () => {
  const before = base.prices.gaiters;
  applyAdminOverrides(base, { prices: { gaiters: 999 } });
  assert.equal(base.prices.gaiters, before);
});
