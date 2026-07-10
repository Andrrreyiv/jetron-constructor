import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoneToRect, fitFontSize } from '../src/js/core/ZoneManager.js';

// Зоны в ТЗ заданы долями 0..1 от холста (раздел 10.5) — так вёрстка масштабируется на мобильном.
test('доля 0..1 переводится в пиксели относительно размера холста', () => {
  const rect = zoneToRect(
    { x: 0.5, y: 0.25, w: 0.2, h: 0.1 },
    { width: 900, height: 1200 }
  );
  assert.deepEqual(rect, { left: 450, top: 300, width: 180, height: 120 });
});

// ТЗ авто-фит: 1 цифра занимает всю высоту зоны.
test('одна цифра растягивается на высоту зоны', () => {
  const size = fitFontSize({ text: '7', rect: { width: 200, height: 300 }, charWidthRatio: 0.6 });
  assert.equal(size, 300);
});

// Две цифры не помещаются по высоте → ужимаются под ширину зоны.
test('две цифры ужимаются под ширину зоны', () => {
  // ширина 120, ratio 0.6 → byWidth = 120 / (2*0.6) = 100; высота 300 не ограничивает
  const size = fitFontSize({ text: '88', rect: { width: 120, height: 300 }, charWidthRatio: 0.6 });
  assert.equal(size, 100);
});
