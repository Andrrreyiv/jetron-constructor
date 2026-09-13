// Разнос зон ОТ НАЗВАННОГО донора с перезаписью.
//
// Клиент 13.09 голосовым и текстом: «подправил зоны у белых форм, распределите на остальные
// цвета». Существующая `propagateZonesToLines` этого уже не делает: 13.09 разметка разошлась
// на все 45 расцветок, а та функция заполняет только ПУСТЫЕ (`if (исход[id]) continue`).
// На боевом `zones.json` размечены 45 из 45 — она ответила бы «переносить нечего», и правка
// белых осталась бы на белых. Отсюда вторая функция: донор назван явно и затирает свою линейку.
//
// ⚠️ Граница та же, что у соседа: между линейками переносить НЕЛЬЗЯ, кадры мокапов разные
// (836 у Champion против 937 у New). Это держит сторож `tests/test_zonesets_sync.py`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { propagateFromDonor } from '../src/js/core/ZoneOverrides.js';

const формы = [
  { id: 'champion-white', line: 'Champion' },
  { id: 'champion-blue', line: 'Champion' },
  { id: 'champion-red', line: 'Champion' },
  { id: 'new-white', line: 'New' },
  { id: 'new-teal', line: 'New' },
];
const поправленные = { back_number: { x: 0.65, y: 0.24, w: 0.23, h: 0.24 } };
const старые = { back_number: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } };

// Главное отличие от propagateZonesToLines: там ручная правка расцветки сильнее копии,
// здесь наоборот — админ сознательно требует разнести донора поверх.
test('зоны донора перезаписывают уже размеченные расцветки его линейки', () => {
  const было = { 'champion-white': поправленные, 'champion-blue': старые, 'champion-red': старые };
  const res = propagateFromDonor(было, формы, 'champion-white');
  assert.deepEqual(res.overrides['champion-blue'], поправленные);
  assert.deepEqual(res.overrides['champion-red'], поправленные);
  assert.equal(res.затронуто, 2);
  assert.equal(res.линейка, 'Champion');
});

test('чужая линейка не задета: кадры у линеек разные', () => {
  const было = { 'champion-white': поправленные, 'new-teal': старые };
  const res = propagateFromDonor(было, формы, 'champion-white');
  assert.deepEqual(res.overrides['new-teal'], старые, 'New живёт на своём кадре');
  assert.equal(res.overrides['new-white'], undefined);
});

test('донор остаётся в результате нетронутым — файл пишется целиком', () => {
  const res = propagateFromDonor({ 'champion-white': поправленные }, формы, 'champion-white');
  assert.deepEqual(res.overrides['champion-white'], поправленные,
    'сервер перезаписывает zones.json целиком, потерять донора нельзя');
});

test('копия независима — правка донора потом не поедет в расцветки сама собой', () => {
  const src = { back_number: { x: 0.65, y: 0.24, w: 0.23, h: 0.24 } };
  const res = propagateFromDonor({ 'champion-white': src }, формы, 'champion-white');
  res.overrides['champion-blue'].back_number.x = 0.99;
  assert.equal(res.overrides['champion-white'].back_number.x, 0.65);
});

// Страховка от тихой потери: если админ нажал кнопку на неразмеченной расцветке, линейка
// не должна получить пустоту вместо своей разметки.
test('донор без разметки ничего не затирает', () => {
  const было = { 'champion-blue': старые };
  const res = propagateFromDonor(было, формы, 'champion-white');
  assert.equal(res.затронуто, 0);
  assert.deepEqual(res.overrides['champion-blue'], старые);
});

test('неизвестный id донора не роняет и не портит карту', () => {
  const было = { 'champion-blue': старые };
  const res = propagateFromDonor(было, формы, 'нет-такой-формы');
  assert.equal(res.затронуто, 0);
  assert.equal(res.линейка, null);
  assert.deepEqual(res.overrides['champion-blue'], старые);
});

// Записи форм, которых нет в каталоге, тоже обязаны дожить до файла: сервер пишет его целиком.
test('чужие записи в карте сохраняются', () => {
  const было = { 'champion-white': поправленные, 'форма-из-архива': старые };
  const res = propagateFromDonor(было, формы, 'champion-white');
  assert.deepEqual(res.overrides['форма-из-архива'], старые);
});
