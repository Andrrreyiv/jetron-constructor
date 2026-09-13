// Размножение разметки зон: донор → вся линейка.
//
// Клиент 12.09: «И зоны по остальным картинкам раскидайте пожалуйста». Он разметил ВОСЕМЬ
// белых доноров и считает работу законченной, но `formId` — это линейка И расцветка
// (`champion-white`, `champion-blue`), а `applyZoneOverrides` (ZoneOverrides.js:36-44) ищет
// строго `overrides[formId]`, без фолбэка на линейку. Значит остальные 37 расцветок из 45
// берут базовый `zoneSet` и разметку донора не видят.
//
// Переносить между расцветками ОДНОЙ линейки можно без пересчёта: внутри линейки кадр мокапа
// один. Это не декларация — сторож `tests/test_zonesets_sync.py:40-64` читает реальные пиксели
// файлов и падает, если кадры внутри линейки разъехались. Между линейками нельзя: кадры разные
// (836 у Champion против 937 у New).
//
// ⚠️ Своя разметка расцветки НЕ затирается: если админ поправил конкретный цвет руками,
// размножение обязано его сохранить, иначе работа пропадёт молча.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { propagateZonesToLines } from '../src/js/core/ZoneOverrides.js';

const формы = [
  { id: 'champion-white', line: 'Champion' },
  { id: 'champion-blue', line: 'Champion' },
  { id: 'champion-red', line: 'Champion' },
  { id: 'new-white', line: 'New' },
  { id: 'new-teal', line: 'New' },
];
const донор = { back_number: { x: 0.65, y: 0.24, w: 0.23, h: 0.24 } };

test('разметка донора расходится на все расцветки его линейки', () => {
  const res = propagateZonesToLines({ 'champion-white': донор }, формы);
  assert.deepEqual(res.overrides['champion-blue'], донор);
  assert.deepEqual(res.overrides['champion-red'], донор);
});

test('донор остаётся в результате нетронутым — файл пишется целиком', () => {
  const res = propagateZonesToLines({ 'champion-white': донор }, формы);
  assert.deepEqual(res.overrides['champion-white'], донор,
    'сервер перезаписывает zones.json целиком, потерять донора нельзя');
});

test('чужая линейка не задета: кадры у линеек разные', () => {
  const res = propagateZonesToLines({ 'champion-white': донор }, формы);
  assert.equal(res.overrides['new-teal'], undefined);
  assert.equal(res.overrides['new-white'], undefined);
});

// Главная страховка: ручная правка конкретной расцветки ценнее копии с донора.
test('своя разметка расцветки не затирается', () => {
  const своя = { back_number: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } };
  const res = propagateZonesToLines({ 'champion-white': донор, 'champion-blue': своя }, формы);
  assert.deepEqual(res.overrides['champion-blue'], своя);
  assert.deepEqual(res.overrides['champion-red'], донор, 'остальным донор всё же достаётся');
});

test('копия независима — правка донора потом не поедет в расцветки сама собой', () => {
  const src = { back_number: { x: 0.65, y: 0.24, w: 0.23, h: 0.24 } };
  const res = propagateZonesToLines({ 'champion-white': src }, формы);
  res.overrides['champion-blue'].back_number.x = 0.99;
  assert.equal(res.overrides['champion-white'].back_number.x, 0.65);
});

// Бренд-ключи несут ещё и цвет знака; он обязан переехать вместе с боксом.
test('цвет бренд-знака переносится вместе с координатами', () => {
  const сЦветом = { chest_brand: { x: 0.4, y: 0.2, w: 0.09, h: 0.03, color: '#ffffff' } };
  const res = propagateZonesToLines({ 'champion-white': сЦветом }, формы);
  assert.equal(res.overrides['champion-red'].chest_brand.color, '#ffffff');
});

test('отчёт говорит, что и куда разошлось', () => {
  const res = propagateZonesToLines({ 'champion-white': донор }, формы);
  assert.equal(res.добавлено, 2);
  assert.deepEqual(res.поЛинейкам, [{ линейка: 'Champion', донор: 'champion-white', получили: ['champion-blue', 'champion-red'] }]);
});

test('без доноров ничего не меняется', () => {
  const res = propagateZonesToLines({}, формы);
  assert.deepEqual(res.overrides, {});
  assert.equal(res.добавлено, 0);
});

// Запись под formId, которого нет в каталоге (в боевом файле такое уже встречалось —
// `champion-sinij3`), не должна ни ломать перенос, ни пропадать из файла.
test('запись неизвестной формы сохраняется и линейку не задаёт', () => {
  const res = propagateZonesToLines({ 'champion-sinij3': донор, 'champion-white': донор }, формы);
  assert.deepEqual(res.overrides['champion-sinij3'], донор, 'неизвестную запись не теряем');
  assert.equal(res.добавлено, 2, 'линейку определяет только известный донор');
});

test('донором становится размеченная расцветка, даже если она не белая', () => {
  const res = propagateZonesToLines({ 'champion-red': донор }, формы);
  assert.deepEqual(res.overrides['champion-white'], донор);
  assert.deepEqual(res.overrides['champion-blue'], донор);
});
