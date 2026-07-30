import test from 'node:test';
import assert from 'node:assert/strict';
import { sizeKey, sizeKeySet, filterGridBySizes } from '../src/js/core/SizeMatch.js';

test('sizeKey достаёт буквенный размер из записи вида «44 RU (XS)»', () => {
  assert.equal(sizeKey('44 RU (XS)'), 'XS');
  assert.equal(sizeKey('48-50 RU (M-L)'), 'M-L');
  assert.equal(sizeKey('4XS'), '4XS');
  assert.equal(sizeKey('  m '), 'M');
  assert.equal(sizeKey('XXL'), '2XL');
  assert.equal(sizeKey(null), '');
});

test('sizeKeySet принимает и массив, и строку с разными разделителями', () => {
  assert.deepEqual(sizeKeySet(['M', 'L', 'XL']), ['M', 'L', 'XL']);
  assert.deepEqual(sizeKeySet('M, L, XL'), ['M', 'L', 'XL']);
  assert.deepEqual(sizeKeySet('M/L/XL'), ['M', 'L', 'XL']);
  assert.deepEqual(sizeKeySet('M, m, L'), ['M', 'L'], 'дубли не плодим');
  assert.deepEqual(sizeKeySet(''), []);
});

const взрослая = {
  title: 'Взрослые размеры',
  columns: ['Российский размер'],
  rows: [['44 RU (XS)'], ['46 RU (S)'], ['48 RU (M)'], ['50 RU (L)'], ['52 RU (XL)'], ['54 RU (2XL)']]
};
const детская = {
  title: 'Детские размеры',
  columns: ['Размер на бирке', 'Рост, см', 'Возраст, лет'],
  rows: [['4XS', '120-128', '5-6'], ['3XS', '128-136', '6-7'], ['2XS', '136-145', '8-9'],
         ['XS', '145-155', '10-11'], ['S', '155-160', '12-13'], ['M', '160-165', '13-14']]
};

test('в сетке остаются только размеры карточки, порядок сетки сохранён', () => {
  // Star взрослая: L…5XL, значит XS/S/M уйти должны
  const out = filterGridBySizes(взрослая, 'L, XL, 2XL, 3XL, 4XL, 5XL');
  assert.deepEqual(out.rows.slice(0, 3), [['50 RU (L)'], ['52 RU (XL)'], ['54 RU (2XL)']]);
  assert.equal(out.title, 'Взрослые размеры');
});

test('размеры карточки без строки в сетке дописываются в конец', () => {
  const out = filterGridBySizes(взрослая, 'L, XL, 2XL, 3XL, 4XL, 5XL');
  const хвост = out.rows.slice(3).map((r) => r[0]);
  assert.deepEqual(хвост, ['3XL', '4XL', '5XL'], 'их можно выбрать, пояснения пока нет');
});

test('детская сетка режется под конкретную линейку', () => {
  // Winner детская: 4XS…M — все шесть строк подходят
  assert.equal(filterGridBySizes(детская, '4XS/3XS/2XS/XS/S/M').rows.length, 6);
  // Champion детская: 3XS…XL — 4XS уходит, XL дописывается
  const champ = filterGridBySizes(детская, '3XS/2XS/XS/S/M/L/XL');
  assert.deepEqual(champ.rows.map((r) => r[0]), ['3XS', '2XS', 'XS', 'S', 'M', 'L', 'XL']);
  const дописанная = champ.rows.find((r) => r[0] === 'L');
  assert.deepEqual(дописанная, ['L', '—', '—'], 'колонки заполнены прочерками');
});

test('пустой набор из карточки оставляет сетку как была', () => {
  assert.deepEqual(filterGridBySizes(детская, []).rows.length, 6);
  assert.deepEqual(filterGridBySizes(детская, null), детская);
  assert.equal(filterGridBySizes(null, 'M'), null);
});
