// Номер на шортах двигается РАМКОЙ, как на спине.
//
// Клиент 12.09 (голосовое 15:29): «очень правильно сделано номер на спине — рамка, ты её просто
// двигаешь, и номер внутри пропорционально изменяется. Так же бы сделать на шортах».
// И текстом: «размеры рамки не сохраняются», «когда рамку меняешь, цифры искажаются, но должны
// пропорционально увеличиваться и уменьшаться, как на спине».
//
// Причина была не в регрессии (git log -S "shorts_number_dup" даёт один коммит 2f325f1), а в том,
// что дубль номера с рождения жил бренд-механикой: админ тянул САМ ТЕКСТ оранжевыми ручками,
// а сохранялся габарит текста (advance-ширина × 1.13·кегль). Поэтому подогнанная «7» не подходила
// под «22» — бокс был посчитан от ширины одной цифры.
//
// Здесь проверяется ядро нового поведения: дубль считается номерной зоной (сажается по чернилам)
// и получает рамку от зоны-якоря, а не крошечный бренд-бокс 0.09×0.033.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNumberZone } from '../src/js/core/ZoneManager.js';
import { isEditorFrameKey, EDITOR_FRAME_KEYS, resolveFrameBox } from '../src/js/core/ZoneOverrides.js';

test('дубль номера на шортах считается номерной зоной — садится по чернилам, как на спине', () => {
  assert.equal(isNumberZone('shorts_number_dup'), true);
  assert.equal(isNumberZone('back_number'), true, 'спина не должна пострадать');
  assert.equal(isNumberZone('chest_number'), true);
});

// Дубль ЛОГОТИПА остаётся картинкой: для неё бренд-механика корректна (round-trip
// brandBoxFromObject ↔ placeStaticImage писался именно под картинку).
test('дубль логотипа номерной зоной НЕ становится', () => {
  assert.equal(isNumberZone('shorts_logo_dup'), false);
  assert.equal(isNumberZone('back_logo'), false);
  assert.equal(isNumberZone('name'), false);
});

test('редакторскую рамку получают только дубли на шортах', () => {
  assert.equal(isEditorFrameKey('shorts_number_dup'), true);
  assert.equal(isEditorFrameKey('shorts_logo_dup'), true);
  assert.equal(isEditorFrameKey('chest_brand'), false, 'монограмма остаётся бренд-объектом');
  assert.equal(isEditorFrameKey('shorts_brand'), false);
  assert.equal(isEditorFrameKey('back_number'), false, 'обычная зона рамку получает своим путём');
  assert.equal(isEditorFrameKey(null), false);
  assert.equal(EDITOR_FRAME_KEYS.length, 2);
});

// Ключевое отличие от resolveBrandBox: у рамки НЕТ крошечного бренд-размера по умолчанию.
// Знак Jetron — мелкая монограмма 0.09×0.033, а рамка номера должна открываться во всю зону-якорь,
// иначе админ получает полоску, в которую цифра не влезает, и начинает тянуть её руками.
test('без сохранённой записи рамка открывается во всю зону-якорь', () => {
  const anchor = { x: 0.3, y: 0.74, w: 0.12, h: 0.16 };
  assert.deepEqual(resolveFrameBox({}, 'champion-white', 'shorts_number_dup', anchor), anchor);
  assert.deepEqual(resolveFrameBox(null, 'champion-white', 'shorts_number_dup', anchor), anchor);
});

test('сохранённая рамка побеждает якорь', () => {
  const anchor = { x: 0.3, y: 0.74, w: 0.12, h: 0.16 };
  const ov = { 'champion-white': { shorts_number_dup: { x: 0.33, y: 0.75, w: 0.05, h: 0.15 } } };
  assert.deepEqual(resolveFrameBox(ov, 'champion-white', 'shorts_number_dup', anchor),
    { x: 0.33, y: 0.75, w: 0.05, h: 0.15 });
});

// Запись другой формы не должна протекать: у каждой расцветки своя разметка (formId = линейка+цвет).
test('чужая расцветка не подменяет рамку', () => {
  const anchor = { x: 0.3, y: 0.74, w: 0.12, h: 0.16 };
  const ov = { 'champion-blue': { shorts_number_dup: { x: 0.9, y: 0.9, w: 0.01, h: 0.01 } } };
  assert.deepEqual(resolveFrameBox(ov, 'champion-white', 'shorts_number_dup', anchor), anchor);
});

// Цвет знака лежит в той же записи zones.json; рамка обязана отдавать только геометрию,
// иначе цвет утечёт в бокс и санитайзер на сервере отвергнет запись.
test('рамка отдаёт только геометрию, без посторонних полей', () => {
  const anchor = { x: 0.3, y: 0.74, w: 0.12, h: 0.16 };
  const ov = { 'champion-white': { shorts_number_dup: { x: 0.33, y: 0.75, w: 0.05, h: 0.15, color: '#ffffff' } } };
  const box = resolveFrameBox(ov, 'champion-white', 'shorts_number_dup', anchor);
  assert.deepEqual(Object.keys(box).sort(), ['h', 'w', 'x', 'y']);
});

// ── Обрезка цифр ─────────────────────────────────────────────
// Клиент 12.09: «почему опять цифры обрезаются?». Замер на стенде 12.09 показал причину:
// у ДВУЗНАЧНЫХ номеров на спине запас до боковых кромок клипа ровно 0 px (чернила 140 при
// рамке 140), у однозначных по высоте — 1 px. Рамка отсечения совпадает с зоной кромка в кромку,
// поэтому сглаженные крайние пиксели глифа срезаются.
//
// Сжимать номер нельзя: край-в-край — осознанное требование клиента (коммит 2f325f1,
// «номер край-в-край, стретч ≤15%»), и NUMBER_TOP_INSET_PX = 1 уже лечит верх именно так —
// отступом посадки, а не уменьшением. Поэтому запас даём РАМКЕ ОТСЕЧЕНИЯ: цифра остаётся
// прежнего размера, а клип перестаёт съедать её край.
import { CLIP_SLACK_PX, clipRect } from '../src/js/core/ZoneManager.js';

test('рамка отсечения шире зоны на запас с каждой стороны', () => {
  const r = clipRect({ left: 100, top: 200, width: 140, height: 134 });
  assert.equal(r.left, 100 - CLIP_SLACK_PX);
  assert.equal(r.top, 200 - CLIP_SLACK_PX);
  assert.equal(r.width, 140 + 2 * CLIP_SLACK_PX);
  assert.equal(r.height, 134 + 2 * CLIP_SLACK_PX);
});

// Запас именно пиксельный, как и NUMBER_TOP_INSET_PX: доля от зоны на мелких холстах
// вырождается в ноль, и срез возвращается (разбор 31.08 в шапке ZoneManager).
test('запас задан в пикселях холста и не равен нулю', () => {
  assert.equal(typeof CLIP_SLACK_PX, 'number');
  assert.ok(CLIP_SLACK_PX >= 1, 'нулевой запас — это и есть срез, ради которого всё затевалось');
});

// Клип обязан остаться клипом: запас снимает срез сглаживания, но не превращает рамку
// в бесконечную — длинная фамилия по-прежнему не должна расползаться по всему макету.
test('запас мал относительно самой зоны', () => {
  const r = clipRect({ left: 0, top: 0, width: 140, height: 134 });
  assert.ok(r.width < 140 * 1.1, 'запас не должен заметно расширять зону');
});
