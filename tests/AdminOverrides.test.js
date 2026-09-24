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

// Клиент 24.09: «шрифты в алфавитном порядке выстраивать… где кириллица да — их лучше бы
// не трогать, а вот где кириллица нет — вот там в алфавитном порядке». Новые клубные шрифты
// дописываются в конец файла, и владелец искал их глазами по всему списку.
test('клубные шрифты идут по алфавиту, русские остаются первыми в своём порядке', () => {
  const шрифт = (id, name, cyrillic) => ({ id, name, file: 'assets/fonts/' + id + '.ttf', cyrillic });
  const r = applyAdminOverrides(base, {
    fonts: [
      шрифт('rpl', 'РПЛ', true),
      шрифт('oswald', 'Oswald', true),
      шрифт('udinese', 'Udinese 19/20', false),
      шрифт('brazil2024', 'Brazil 2024', false),
      шрифт('brazil2021', 'Brazil 2021', false),
      шрифт('alhilal', 'AL Hilal', false), // добавлен последним — и падал в хвост списка
    ],
  });
  assert.deepEqual(r.fonts.map((f) => f.name),
    ['РПЛ', 'Oswald', 'AL Hilal', 'Brazil 2021', 'Brazil 2024', 'Udinese 19/20']);
  // ⚠️ Первым обязан остаться русский: fonts[0] — запасной шрифт по умолчанию (main.browser.js),
  // клубный на этом месте показал бы фамилию квадратами.
  assert.equal(r.fonts[0].cyrillic, true);
});

// ☠️ Замер на боевом 24.09 (43 шрифта): админка и конструктор дали РАЗНЫЙ порядок,
// потому что PHP-шный strnatcasecmp пропускает пробелы, а localeCompare нет. Владелец
// видел «Manchester City» впереди «Man City», покупатель наоборот. Этот тест стережёт
// сторону покупателя; сторона PHP — tests/test_font_order_php.py, и оба списка обязаны
// совпадать. На составе из 25 шрифтов дефект не проявлялся: нужны именно такие пары.
test('пробел в названии не выбрасывается при сортировке', () => {
  const шрифт = (name) => ({ id: name.toLowerCase().replace(/\W+/g, ''), name, file: 'f.ttf', cyrillic: false });
  const r = applyAdminOverrides(base, {
    fonts: [
      шрифт('Manchester City 23-24'), шрифт('Man City 24/25'),
      шрифт('BarcelonaLaliga-Regular'), шрифт('Barcelona La Liga 2023 2024'),
      шрифт('Real Madrid 2021'), шрифт('Real Madrid 21/22'),
    ],
  });
  assert.deepEqual(r.fonts.map((f) => f.name), [
    'Barcelona La Liga 2023 2024', 'BarcelonaLaliga-Regular',
    'Man City 24/25', 'Manchester City 23-24',
    'Real Madrid 21/22', 'Real Madrid 2021',
  ]);
});

test('русские шрифты не пересортировываются, даже если идут не по алфавиту', () => {
  const шрифт = (id, name, cyrillic) => ({ id, name, file: 'assets/fonts/' + id + '.ttf', cyrillic });
  const r = applyAdminOverrides(base, {
    fonts: [шрифт('rpl', 'РПЛ', true), шрифт('play', 'Play', true), шрифт('oswald', 'Oswald', true)],
  });
  assert.deepEqual(r.fonts.map((f) => f.name), ['РПЛ', 'Play', 'Oswald']);
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

// Клиент 07.09: «поменял салатовый в админке — квадратик не поменялся, сделайте связку».
// Правка палитры в админке уходит в admin.json списком colors, и покупательский свотч обязан
// взять оттенок ОТТУДА. Это последнее звено связки; до 07.09 оно не было закреплено тестом,
// а сама правка была невозможна — форма админки умела только ДОБАВИТЬ новый id, не изменить hex.
test('новый оттенок из admin.json доезжает до палитры покупателя', () => {
  const colors = base.colors.map((c) => (c.id === 'lightgreen' ? { ...c, hex: '#7CFC00' } : c));
  const r = applyAdminOverrides(base, { colors });
  const got = r.colors.find((c) => c.id === 'lightgreen');
  assert.equal(got.hex, '#7CFC00');
  assert.equal(got.name, base.colors.find((c) => c.id === 'lightgreen').name, 'название менять не должно');
  assert.equal(r.colors.length, base.colors.length, 'палитра не должна расти или худеть');
});
