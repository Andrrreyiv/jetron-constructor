import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculatePrice } from '../src/js/core/PriceCalculator.js';

// Прайс из ТЗ раздел 5 (CONFIRMED C26-C30).
const prices = {
  form: { adult: 1280, child: 1090 },
  gaiters: 450,
  placement: {
    name_number: 600,
    chest_logo_small: 300,
    chest_logo_large: 300,
    chest_number: 300,
    logo_under_number: 300,
    shoulder_logo: 300,
    shorts_number: 0,
    shorts_logo: 0
  },
  baseFee: 0,
  discounts: { jetron_chest: 0.05, jetron_back: 0.05, bulk_free_chest_logo_from: 20 }
};

test('пустой заказ взрослой формы = только цена формы, нанесение 0', () => {
  const r = calculatePrice({ prices, ageCategory: 'adult', usedZones: [] });
  assert.equal(r.formPrice, 1280);
  assert.equal(r.placementTotal, 0);
  assert.equal(r.total, 1280);
});

test('детская форма дешевле', () => {
  const r = calculatePrice({ prices, ageCategory: 'child', usedZones: [] });
  assert.equal(r.formPrice, 1090);
});

test('фамилия+номер тарифицируются как одна группа = 600', () => {
  const r = calculatePrice({
    prices,
    ageCategory: 'adult',
    usedZones: [
      { key: 'name', priceGroup: 'name_number', price: 600 },
      { key: 'back_number', priceGroup: 'name_number', price: 0 }
    ]
  });
  assert.equal(r.placementTotal, 600);
  assert.equal(r.total, 1880);
});

test('только номер тарифицируется как 600 (ТЗ §5)', () => {
  const r = calculatePrice({
    prices,
    ageCategory: 'adult',
    usedZones: [{ key: 'back_number', priceGroup: 'name_number', price: 0 }]
  });
  assert.equal(r.placementTotal, 600);
  assert.equal(r.total, 1880);
});

test('гетры добавляют 450 к итогу', () => {
  const r = calculatePrice({ prices, ageCategory: 'adult', usedZones: [], gaiters: true });
  assert.equal(r.gaitersPrice, 450);
  assert.equal(r.total, 1730);
});

test('базового сбора нет (C28)', () => {
  const r = calculatePrice({ prices, ageCategory: 'adult', usedZones: [] });
  assert.equal(r.baseFee, 0);
});

test('скидка Jetron грудь -5% от итога', () => {
  const r = calculatePrice({
    prices,
    ageCategory: 'adult',
    usedZones: [{ key: 'name', priceGroup: 'name_number', price: 600 }],
    jetron: { chest: true }
  });
  // итог до скидки = 1280 + 600 = 1880; -5% = 1786
  assert.equal(r.discountPct, 0.05);
  assert.equal(r.total, 1786);
});

test('скидки Jetron грудь+спина складываются в -10% (потолок)', () => {
  const r = calculatePrice({
    prices,
    ageCategory: 'adult',
    usedZones: [],
    jetron: { chest: true, back: true }
  });
  // 1280 -10% = 1152
  assert.equal(r.discountPct, 0.10);
  assert.equal(r.total, 1152);
});

test('от 20 комплектов малое лого на груди бесплатно', () => {
  const zones = [{ key: 'chest_logo_small', priceGroup: 'chest_logo_small', price: 300 }];
  const one = calculatePrice({ prices, ageCategory: 'adult', usedZones: zones, quantity: 1 });
  const bulk = calculatePrice({ prices, ageCategory: 'adult', usedZones: zones, quantity: 20 });
  // 1 шт: форма 1280 + лого 300 = 1580
  assert.equal(one.total, 1580);
  // от 20: малое лого груди обнуляется → только форма 1280
  assert.equal(bulk.placementTotal, 0);
  assert.equal(bulk.total, 1280);
});
