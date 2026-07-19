import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampBox, applyZoneOverrides, validateOverrides, cropToImageRect, validateCrops } from '../src/js/core/ZoneOverrides.js';

// Редактор зон в админке пишет per-form переопределения box в zones.json.
// Ядро — чистые функции: зажим box в границы холста и слияние переопределений с зонами формы.

test('clampBox зажимает координаты в [0,1] и не даёт зоне вылезти за холст', () => {
  assert.deepEqual(clampBox({ x: -0.1, y: 0.5, w: 0.8, h: 0.9 }), { x: 0, y: 0.5, w: 0.8, h: 0.5 });
  assert.deepEqual(clampBox({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }), { x: 0.9, y: 0.9, w: 0.1, h: 0.1 });
});

test('applyZoneOverrides заменяет box только у совпавших по ключу зон текущей формы, не мутируя исходник', () => {
  const zones = [
    { key: 'chest_number', box: { x: 0.2, y: 0.3, w: 0.1, h: 0.05 } },
    { key: 'name', box: { x: 0.6, y: 0.16, w: 0.2, h: 0.05 } }
  ];
  const overrides = { form_a: { chest_number: { x: 0.25, y: 0.25, w: 0.12, h: 0.08 } } };
  const out = applyZoneOverrides(zones, 'form_a', overrides);
  assert.deepEqual(out[0].box, { x: 0.25, y: 0.25, w: 0.12, h: 0.08 });
  assert.deepEqual(out[1].box, { x: 0.6, y: 0.16, w: 0.2, h: 0.05 }, 'зона без override не тронута');
  assert.equal(zones[0].box.x, 0.2, 'исходная зона не изменена');
  assert.notEqual(out[0], zones[0], 'вернулась новая зона');
});

test('validateOverrides принимает корректную структуру и отвергает мусор (защита границы zones.json)', () => {
  assert.equal(validateOverrides({ form_a: { k: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } } }).ok, true);
  assert.equal(validateOverrides({}).ok, true, 'пустой объект валиден');
  assert.equal(validateOverrides(null).ok, false);
  assert.equal(validateOverrides('строка').ok, false);
  assert.equal(validateOverrides({ f: 'нестрока' }).ok, false);
  assert.equal(validateOverrides({ f: { k: { x: 0.1, y: 0.1 } } }).ok, false, 'нет w/h → невалидно');
});

// Phase 2: кадрирование фона. Админ задаёт per-form crop (доля изображения, которую оставляем),
// crops.json пишет тот же mu-плагин. Ядро — перевод доли в пиксельный прямоугольник источника Fabric.
test('cropToImageRect переводит долевой crop в пиксельный прямоугольник источника; полный/пустой crop → null', () => {
  assert.deepEqual(
    cropToImageRect({ x: 0.1, y: 0.2, w: 0.5, h: 0.6 }, 1000, 800),
    { cropX: 100, cropY: 160, cropWidth: 500, cropHeight: 480 }
  );
  assert.equal(cropToImageRect(null, 1000, 800), null, 'нет crop → без кадрирования');
  assert.equal(cropToImageRect({ x: 0, y: 0, w: 1, h: 1 }, 1000, 800), null, 'полный кадр → без кадрирования');
});

// crops.json — ПЛОСКАЯ форма { <formId>: {x,y,w,h} } (один кадр на форму, без zoneKey),
// в отличие от вложенных zones.json. Свой валидатор границы, иначе validateOverrides её отвергает.
test('validateCrops принимает плоский per-form crop и отвергает мусор/вложенную форму зон', () => {
  assert.equal(validateCrops({ champion: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } }).ok, true);
  assert.equal(validateCrops({}).ok, true, 'пустой объект валиден');
  assert.equal(validateCrops(null).ok, false);
  assert.equal(validateCrops('строка').ok, false);
  assert.equal(validateCrops({ f: { x: 0.1, y: 0.1 } }).ok, false, 'нет w/h → невалидно');
  assert.equal(validateCrops({ f: { k: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } } }).ok, false, 'вложенная (зоны) форма → невалидно');
});
