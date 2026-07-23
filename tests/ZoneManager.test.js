import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoneToRect, fitFontSize, fitTextToRect } from '../src/js/core/ZoneManager.js';

// Заглушка текстового объекта Fabric: width/height пропорциональны кеглю (как реальные глифы).
// wPer100/hPer100 — размеры строки при кегле 100.
function fakeText(wPer100, hPer100) {
  return {
    fontSize: 0,
    width: 0,
    height: 0,
    scaleX: 1,
    scaleY: 1,
    set(p) {
      if (p.fontSize !== undefined) this.fontSize = p.fontSize;
      if (p.scaleX !== undefined) this.scaleX = p.scaleX;
      if (p.scaleY !== undefined) this.scaleY = p.scaleY;
    },
    initDimensions() {
      this.width = wPer100 * this.fontSize / 100;
      this.height = hPer100 * this.fontSize / 100;
    }
  };
}

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

// Замер по факту: длинная надпись ограничена шириной → заполняет ширину рамки вплотную (без зазора).
test('fitTextToRect: широкая строка заполняет ширину рамки без отступа', () => {
  const obj = fakeText(770, 113); // РОМАНОВСКИЙ ~ 770×113 при кегле 100
  const size = fitTextToRect(obj, { width: 152, height: 44 });
  assert.ok(Math.abs(size - 100 * 152 / 770) < 1e-9);
  assert.ok(Math.abs(obj.width - 152) < 1e-6); // ширина заполнена целиком
  assert.ok(obj.height <= 44 + 1e-6);
});

// Замер по факту: короткие цифры ограничены высотой → заполняют высоту рамки вплотную.
test('fitTextToRect: цифры заполняют высоту рамки без отступа', () => {
  const obj = fakeText(87, 113); // «23» ~ 87×113 при кегле 100
  const size = fitTextToRect(obj, { width: 156, height: 143 });
  assert.ok(Math.abs(size - 100 * 143 / 113) < 1e-9);
  assert.ok(Math.abs(obj.height - 143) < 1e-6); // высота заполнена целиком
  assert.ok(obj.width <= 156 + 1e-6);
});

// Клиент 2026-07-23: номер должен прилипать к рамке край-в-край. Узкий номерной шрифт по бокам
// не достаёт (пропорции цифры). maxStretch добивает узкую сторону до рамки, но не более лимита,
// чтобы не искажать цифру сильно. Заполненную сторону не трогаем.
test('fitTextToRect: maxStretch добивает узкую сторону до рамки с лимитом', () => {
  const obj = fakeText(87, 113); // «23» ~ 87x113 при кегле 100 (узкая-высокая)
  fitTextToRect(obj, { width: 156, height: 143 }, { maxStretch: 1.15 });
  // высота заполнена равномерной подгонкой → scaleY не растягивается
  assert.ok(Math.abs(obj.scaleY - 1) < 1e-9);
  // ширина не добивала → растягиваем, но упираемся в лимит 1.15
  assert.ok(Math.abs(obj.scaleX - 1.15) < 1e-9);
  // после стретча ширина текста не вылезает за рамку
  assert.ok(obj.width * obj.scaleX <= 156 + 1e-6);
});

test('fitTextToRect: без maxStretch масштаб по осям не трогается (для фамилии/текста)', () => {
  const obj = fakeText(87, 113);
  fitTextToRect(obj, { width: 156, height: 143 });
  assert.equal(obj.scaleX, 1);
  assert.equal(obj.scaleY, 1);
});
