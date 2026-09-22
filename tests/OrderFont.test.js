import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildOrder } from '../src/js/core/OrderSummary.js';

const config = JSON.parse(
  readFileSync(fileURLToPath(new URL('../src/config/mock-config.json', import.meta.url)), 'utf8')
);
const app = readFileSync(fileURLToPath(new URL('../src/js/ui/app.browser.js', import.meta.url)), 'utf8');

// Клиент 15.09: «в идеале бы здесь ещё указать шрифт, а то каждый раз придётся его искать
// вручную». Шрифт обязан доехать от размещения до позиции заказа — иначе спецификации
// неоткуда его взять.
test('позиция заказа несёт шрифт текстового нанесения', () => {
  const order = buildOrder({
    config, formId: 'champion-blue', ageCategory: 'adult', quantity: 1,
    placements: [{ view: 'back', zoneKey: 'name', type: 'text', value: 'ГРАФКИН', fontId: 'oswald' }]
  });
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].fontId, 'oswald');
});

// У логотипа шрифта нет и быть не может: подпись «(шрифт: …)» у картинки означала бы ложь
// в документе, по которому печатают.
test('у логотипа шрифт в позицию не попадает', () => {
  const order = buildOrder({
    config, formId: 'champion-blue', ageCategory: 'adult', quantity: 1,
    placements: [{ view: 'front', zoneKey: 'chest_logo_small', type: 'image', value: 'data:image/png;base64,AA', fontId: 'oswald' }]
  });
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].fontId, undefined);
});

// Каждая расцветка наследует общий zoneTemplate — шрифт должен доезжать и там, а не только
// у форм с собственными зонами.
test('шрифт доезжает и у формы без собственных зон', () => {
  const form = config.forms.find((f) => f.id === 'legend-red');
  assert.ok(form && !form.zones, 'форма каталога не должна хранить собственные зоны');
  const order = buildOrder({
    config, formId: 'legend-red', ageCategory: 'adult', quantity: 1,
    placements: [{ view: 'front', zoneKey: 'chest_number', type: 'text', value: '11', fontId: 'russoone' }]
  });
  assert.equal(order.items[0].fontId, 'russoone');
});

// Спецификация печатает шрифт ФАКТИЧЕСКИ НАРИСОВАННЫЙ: resolveFont откатывает латинский
// шрифт на РПЛ, если текст кириллицей. Подпись обязана совпадать с макетом, иначе в печать
// уйдёт имя шрифта, которого на форме нет.
test('спецификация берёт шрифт через resolveFont, а не выбранный', () => {
  const кусок = app.slice(app.indexOf('_specText(o)'), app.indexOf('_specText(o)') + 1400);
  assert.match(кусок, /resolveFont\(it\.fontId, it\.text\)/, 'шрифт должен проходить через resolveFont');
  assert.match(кусок, /шрифт:/, 'в строке нанесения должна быть подпись шрифта');
});

// Исходники логотипов уходят в заказ: тема ждёт их в jetron_logos[], иначе в заказе снова
// будет только сведённый макет и пустое поле «Логотипы».
test('логотипы отправляются в корзину отдельными файлами', () => {
  assert.match(app, /add\('jetron_logos\[\]', исходник \|\| c\.image\)/,
    'логотипы должны уходить полем jetron_logos[]');
  assert.match(app, /this\.optionActive\(o\)/, 'отправляем только показанные на макете логотипы');
});

// Клиент 22.09: покупатель грузил хорошее качество, а в заказ уезжал webp 1600 px —
// это наш `prepareImage()` пережимает всё тяжелее 1,5 МБ. Пережатая копия нужна холсту,
// но в ЗАКАЗ обязан идти исходный файл.
test('в заказ уходит ИСХОДНЫЙ файл логотипа, а не пережатая копия', () => {
  assert.match(app, /resolve\(\{ url: out, original: String\(чтец\.result\) \}\)/,
    'prepareImage обязан отдавать исходник рядом с пережатой копией');
  assert.match(app, /const исходник = this\.logoOriginals && this\.logoOriginals\[o\.id\]/,
    'при отправке заказа исходник обязан иметь приоритет');
  // ⚠️ Оригиналы живут ОТДЕЛЬНО от optCache: тот целиком уезжает в черновик (snapshotOf),
  // а у черновика лимит 3 МБ — исходники его бы разорвали.
  const снимок = app.match(/export function snapshotOf[\s\S]*?\n\}/)
    || app.match(/snapshotOf\(app\)[\s\S]{0,400}/);
  assert.ok(!/logoOriginals/.test(String(снимок)), 'исходники не должны попадать в черновик');
  assert.match(app, /if \(this\.logoOriginals\) \{ delete this\.logoOriginals\[opt\.id\]; \}/,
    'удаление логотипа обязано чистить и исходник');
});
