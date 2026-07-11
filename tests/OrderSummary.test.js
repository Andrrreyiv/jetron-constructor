import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildOrder } from '../src/js/core/OrderSummary.js';

const config = JSON.parse(
  readFileSync(fileURLToPath(new URL('../src/config/mock-config.json', import.meta.url)), 'utf8')
);

// Сводка заказа — это ровно тот объект, что уйдёт в WooCommerce (U1).
// Пустой дизайн: идентификация модели, размерная категория, комплекты, нулевые нанесения.
test('пустой заказ несёт модель, категорию, комплекты и цену за комплект', () => {
  const order = buildOrder({ config, formId: 'champion-blue', ageCategory: 'adult', quantity: 3, placements: [] });
  assert.equal(order.formName, 'Champion Синий');
  assert.equal(order.color, 'Синий');
  assert.equal(order.ageCategory, 'adult');
  assert.equal(order.quantity, 3);
  assert.deepEqual(order.items, []);
  assert.equal(order.price.perKit, 1280);
  assert.equal(order.price.grandTotal, 3840);
});

// Color-first каталог: форма не хранит свои зоны, наследует общий zoneTemplate.
// Нанесение по зоне из шаблона должно тарифицироваться (иначе заказ «теряет» позиции).
test('форма без собственных зон использует zoneTemplate каталога', () => {
  const form = config.forms.find((f) => f.id === 'legend-red');
  assert.ok(form && !form.zones, 'форма каталога не должна хранить собственные зоны');
  const order = buildOrder({
    config, formId: 'legend-red', ageCategory: 'adult', quantity: 1,
    placements: [{ view: 'front', zoneKey: 'chest_number', type: 'text', value: '7', fontId: 'rpl' }]
  });
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].label, 'Номер на грудь');
  assert.equal(order.price.placementTotal, 300);
});

// Каждое нанесение попадает в позиции с человекочитаемым названием и видом,
// фамилия+номер тарифицируются одной группой 600 (ТЗ §5).
test('нанесения собираются в позиции, фамилия+номер = одна группа 600', () => {
  const order = buildOrder({
    config, formId: 'champion-blue', ageCategory: 'adult', quantity: 1,
    placements: [
      { view: 'back', zoneKey: 'name', type: 'text', value: 'ИВАНОВ', fontId: 'rpl' },
      { view: 'back', zoneKey: 'back_number', type: 'text', value: '10', fontId: 'rpl' }
    ]
  });
  assert.equal(order.items.length, 2);
  const byKey = Object.fromEntries(order.items.map((i) => [i.zoneKey, i]));
  assert.equal(byKey.name.label, 'Фамилия');
  assert.equal(byKey.name.view, 'back');
  assert.equal(byKey.name.text, 'ИВАНОВ');
  assert.equal(byKey.back_number.text, '10');
  assert.equal(order.price.placementTotal, 600);
  assert.equal(order.price.perKit, 1880);
});

// Опции доходят до сводки: гетры, скидка Джетрон в price, grandTotal = perKit × комплекты.
test('гетры и скидка Джетрон в сводке, итог умножается на комплекты', () => {
  const order = buildOrder({
    config, formId: 'champion-blue', ageCategory: 'adult', quantity: 2,
    gaiters: true, jetron: { chest: true, back: false }, placements: []
  });
  assert.equal(order.gaiters, true);
  assert.deepEqual(order.jetron, { chest: true, back: false });
  assert.equal(order.price.gaitersPrice, 450);
  assert.equal(order.price.discountPct, 0.05);
  assert.equal(order.price.perKit, 1644); // (1280+450)*0.95 = 1643.5 → 1644
  assert.equal(order.price.grandTotal, 3288);
});
