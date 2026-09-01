import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoneToRect, fitFontSize, fitTextToRect, fitInkToRect, inkAlignedCenter, FABRIC_BASELINE_RATIO, FABRIC_BOX_RATIO, NUMBER_TOP_INSET_PX } from '../src/js/core/ZoneManager.js';

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

test('fitTextToRect: масштаб по осям не трогается — текст не деформируется', () => {
  const obj = fakeText(87, 113);
  fitTextToRect(obj, { width: 156, height: 143 });
  assert.equal(obj.scaleX, 1);
  assert.equal(obj.scaleY, 1);
});

// ── Посадка номера по чернилам (заказчик 2026-07-24) ────────────────────────────────
// Метрики чернил при кегле 100: реальная краска глифа, без коробки Fabric.
// «23» шрифтом РПЛ ~ 62.5×47.5 при кегле 100 (замер measureText), «2» ~ 31×47.

// Заказчик: «если написать 23, то он по бокам упрётся просто в стенки… максимально до стенки
// слева направо». Широкая строка ограничена шириной рамки → чернила заполняют её целиком.
test('fitInkToRect: широкий номер упирается чернилами в боковые стенки', () => {
  const rect = { left: 0, top: 0, width: 171, height: 156 };
  const ink = { width: 62.5, ascent: 47.5, descent: 0 };
  const { fontSize } = fitInkToRect(rect, ink, { ref: 100 });
  const k = fontSize / 100;
  assert.ok(Math.abs(ink.width * k - rect.width) < 1e-6);   // ширина заполнена впритык
  assert.ok(ink.ascent * k <= rect.height + 1e-6);          // по высоте остаётся запас
});

// Одна цифра узкая → ограничивает высота рамки, деформации нет ни в одном случае.
test('fitInkToRect: одиночная цифра ограничена высотой рамки', () => {
  const rect = { left: 0, top: 0, width: 171, height: 156 };
  const ink = { width: 31, ascent: 47, descent: 0 };
  const { fontSize } = fitInkToRect(rect, ink, { ref: 100 });
  const k = fontSize / 100;
  assert.ok(Math.abs((ink.ascent + ink.descent) * k - rect.height) < 1e-6);
  assert.ok(ink.width * k <= rect.width + 1e-6);
});

// Главное требование заказчика: «номер прилип к верхней рамке». Проверяем сам глиф, не коробку.
test('inkAlignedCenter: верх чернил совпадает с верхней кромкой рамки', () => {
  const rect = { left: 100, top: 40, width: 171, height: 156 };
  const fontSize = 200;
  const m = {
    fontSize,
    boxWidth: 120,
    boxHeight: FABRIC_BOX_RATIO * fontSize,
    inkWidth: 100,
    inkAscent: 130,
    inkLeftOffset: 8
  };
  const { centerY } = inkAlignedCenter(rect, m);
  // где реально окажется верх краски: центр коробки → верх коробки → базовая линия → минус подъём
  const inkTop = centerY - m.boxHeight / 2 + FABRIC_BASELINE_RATIO * fontSize - m.inkAscent;
  assert.ok(Math.abs(inkTop - rect.top) < 1e-6);
});

// Цифра центрируется по ширине рамки именно чернилами: боковые полуапроши у номерных шрифтов
// несимметричны, и центрирование по коробке давало видимый перекос при упоре в стенки.
test('inkAlignedCenter: чернила центрированы по ширине рамки', () => {
  const rect = { left: 100, top: 40, width: 171, height: 156 };
  const m = {
    fontSize: 200,
    boxWidth: 120,
    boxHeight: FABRIC_BOX_RATIO * 200,
    inkWidth: 100,
    inkAscent: 130,
    inkLeftOffset: 8
  };
  const { centerX } = inkAlignedCenter(rect, m);
  const inkCenterX = centerX - m.boxWidth / 2 + m.inkLeftOffset + m.inkWidth / 2;
  assert.ok(Math.abs(inkCenterX - (rect.left + rect.width / 2)) < 1e-6);
});

// ── Отступ сверху у цифр (заказчик 2026-08-27) ──────────────────────────────────────
// «Цифры 8 и 7 нужно опустить на 1 пиксель вниз». Геометрия прижимает к кромке ВСЕ цифры
// одинаково, разница у 7 и 8 оптическая: плоский верх глифа читается как касание, скруглённый
// у 0/6/9 — нет. Отступ только двум цифрам разъедет номера «78» и «12», поэтому он единый.

// Отступ — ДОЛЯ высоты зоны, не пиксели: холст пересчитывается под контейнер (замер 27.08 —
// логическая ширина 597 при displayWidth 450 в конфиге), поэтому пиксель на десктопе, на телефоне
// и в печати — три разные величины, и абсолютный отступ двигал бы номер по ткани.
// Клиент 31.08 голосовым закрыл этот вопрос и сам же назвал развилку: «цифра должна касаться
// верхнего края рамки и нижнего края рамки, то есть там отступ один пиксель или 0 пиксель…
// сделать 0, а если не будет обрезаться, то так оставляем. Если будет всё-таки обрезаться
// на 0, тогда сделайте 1 пиксель».
//
// 🔴 Ветка «обрезается» и сработала. Замер в браузере 31.08 (1366×768, холст 397×455,
// номер на спине, шрифт РПЛ, кегль 85): у зоны есть рамка отсечения по её границам, и при
// нуле верхняя строка глифа теряет непрозрачность — 255 → 74, плюс целиком пропадает строка
// сглаживания над ней. Прогон по всем шрифтам списка дал срез у номера в КАЖДОМ.
// Прежний комментарий тут утверждал «проверено глазами: не обрезается» — это не было
// проверено ни разу, замер его опроверг.
//
// Порог найден перебором сдвига того же объекта: 0.25 / 0.38 / 0.5 / 0.75 px срез не убирают
// (альфа верхней строки 80 / 99 / 106 / 102 против свободных 252 / 219 / 188 / 125), и только
// сдвиг ровно на 1 px даёт совпадение с отрисовкой без рамки. Отсюда единица измерения:
// «пиксель» клиента — это пиксель ХОЛСТА, а не доля зоны и не 1/1200 эталонной высоты
// (последняя дала бы на ноутбуке 0.38 px, то есть не спасла бы).
//
// ⚠️ Поэтому константа перестала быть долей. Доля здесь вредна: она берётся от высоты ЗОНЫ,
// а зоны номеров разной высоты — при эталоне 1200 спина 181.6, грудь 97.8, шорты 69.8.
// Одна доля дала бы спине почти вдвое больший отступ, чем груди, и номера встали бы
// ступенькой относительно друг друга — ровно то, что запрещает разбор от 27.08 ниже.
test('NUMBER_TOP_INSET_PX: отступ сверху ровно один пиксель холста — иначе рамка срезает верх цифры', () => {
  assert.equal(NUMBER_TOP_INSET_PX, 1);
});

test('inkAlignedCenter: с отступом верх чернил опускается ровно на отступ', () => {
  const rect = { left: 100, top: 40, width: 171, height: 156 };
  const fontSize = 200;
  const m = {
    fontSize,
    boxWidth: 120,
    boxHeight: FABRIC_BOX_RATIO * fontSize,
    inkWidth: 100,
    inkAscent: 130,
    inkLeftOffset: 8,
    topInset: 2
  };
  const { centerY } = inkAlignedCenter(rect, m);
  const inkTop = centerY - m.boxHeight / 2 + FABRIC_BASELINE_RATIO * fontSize - m.inkAscent;
  assert.ok(Math.abs(inkTop - (rect.top + 2)) < 1e-6);
});

// Если отступ съест высоту молча, цифра вылезет за нижнюю кромку зоны ровно на его величину.
test('fitInkToRect: с отступом чернила остаются внутри рамки по высоте', () => {
  const rect = { left: 0, top: 0, width: 171, height: 156 };
  const ink = { width: 31, ascent: 47, descent: 0 }; // одиночная цифра, ограничена высотой
  const topInset = 2;
  const { fontSize } = fitInkToRect(rect, ink, { ref: 100, topInset });
  const inkH = (ink.ascent + ink.descent) * (fontSize / 100);
  assert.ok(Math.abs(inkH - (rect.height - topInset)) < 1e-6);
  assert.ok(topInset + inkH <= rect.height + 1e-6);
});
