// Цвет надписей: кто у кого его берёт.
//
// Клиент 30.08 (скриншоты + текст): «привяжи пожалуйста цвет номера на груди к цвету надписей
// на спине, чтобы они одинакового цвета были». На его снимке фамилия и номер на спине белые,
// а номер на груди чёрный — потому что у номера на груди своего выбора цвета нет и никогда
// не было: он рисовался цветом по умолчанию (`this.textColor`) мимо выбора клиента.

import test from 'node:test';
import assert from 'node:assert/strict';

import { linkedNumberColor, linkedNumberFont } from '../src/js/core/TextColor.js';

// Опции размещения из `mock-config.json`: спина — `name_number`, грудь — `chest_number`.
const опции = [
  { id: 'name_number', kind: 'name_number' },
  { id: 'chest_number', kind: 'number' }
];

test('номер на груди берёт цвет у надписей на спине, а не цвет по умолчанию', () => {
  const кэш = { name_number: { name: 'ИВАН', number: '10', color: '#ffffff' } };
  assert.equal(linkedNumberColor(опции, кэш, '#111111'), '#ffffff');
});

// Клиент 31.08 письменно: «Шрифт номера на груди, привязать к шрифту на спине».
// Тот же дефект, что был с цветом: своего выбора шрифта у номера на груди нет,
// он рисовался шрифтом по умолчанию мимо выбора клиента на спине.
test('номер на груди берёт шрифт у надписей на спине, а не шрифт по умолчанию', () => {
  const кэш = { name_number: { name: 'ИВАН', number: '10', fontId: 'college' } };
  assert.equal(linkedNumberFont(опции, кэш, 'default'), 'college');
});
