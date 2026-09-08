import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotOf, sanitizeDraft } from '../src/js/core/DraftShape.js';

// Конфиг живой: расцветки приходят и уходят (клиент сам снял «синий3» 31.08).
const config = () => ({
  forms: [
    { id: 'champion-white', colorId: 'white' },
    { id: 'star-black', colorId: 'black' }
  ],
  placementOptions: [{ id: 'name_number' }, { id: 'chest_number' }]
});

// Черновик кладётся в localStorage целиком, поэтому в снимок попадает ТОЛЬКО то,
// что покупатель ввёл руками. Холсты, DOM и производные размещения туда не идут:
// они восстанавливаются обычным ходом конструктора из тех же введённых данных.
test('в снимок попадают только введённые покупателем поля, без DOM и производных', () => {
  const app = {
    formId: 'champion-white',
    colorId: 'white',
    ageCategory: 'child',
    gaiters: true,
    quantity: 4,
    jetron: { chest: true, back: false },
    optCache: { name_number: { name: 'ИВАНОВ', number: '10' } },
    optShown: { name_number: true },
    // ниже — то, чего в черновике быть не должно
    views: new Map([['front', {}]]),
    edit: { placements: { 'front:chest_number': { type: 'text' } }, past: [] },
    config: { forms: [] },
    openOpt: 'name_number'
  };
  assert.deepEqual(snapshotOf(app), {
    formId: 'champion-white',
    colorId: 'white',
    ageCategory: 'child',
    gaiters: true,
    quantity: 4,
    jetron: { chest: true, back: false },
    optCache: { name_number: { name: 'ИВАНОВ', number: '10' } },
    optShown: { name_number: true }
  });
});

// Расцветку из черновика могли удалить из каталога, пока покупатель ходил в корзину.
// Показать её значит нарисовать форму, которой нет в продаже, и назвать за неё цену.
test('исчезнувшая из каталога расцветка не восстанавливается, остальное живо', () => {
  const draft = {
    formId: 'champion-sinij3',
    colorId: 'sinij3',
    ageCategory: 'adult',
    quantity: 2,
    optCache: { name_number: { name: 'ИВАНОВ' } }
  };
  const safe = sanitizeDraft(draft, config());
  assert.equal('formId' in safe, false, 'мёртвая форма не должна доехать до конструктора');
  assert.equal('colorId' in safe, false, 'цвет без формы оставит карусель в разнобое');
  assert.equal(safe.quantity, 2);
  assert.deepEqual(safe.optCache, { name_number: { name: 'ИВАНОВ' } });
});

// Пара «форма + цвет» в конструкторе неразрывна: карусель моделей строится от цвета.
// В черновике цвет мог протухнуть отдельно от формы, поэтому берём его из конфига.
test('живая форма восстанавливается, цвет берётся из конфига, а не из черновика', () => {
  const safe = sanitizeDraft({ formId: 'star-black', colorId: 'ustarel' }, config());
  assert.equal(safe.formId, 'star-black');
  assert.equal(safe.colorId, 'black');
});

// Опции конструктора тоже меняются. Чужой ключ в optCache не нарисуется никогда,
// но будет вечно жить в черновике и занимать квоту хранилища.
test('опции, которых больше нет в конфиге, из черновика выбрасываются', () => {
  const draft = {
    optCache: { name_number: { name: 'ИВАНОВ' }, sleeve_patch: { text: 'старая опция' } },
    optShown: { name_number: true, sleeve_patch: true }
  };
  const safe = sanitizeDraft(draft, config());
  assert.deepEqual(Object.keys(safe.optCache), ['name_number']);
  assert.deepEqual(Object.keys(safe.optShown), ['name_number']);
});

// Флажки восстанавливаются только настоящими булевыми: строка "false" из чужого
// черновика включила бы гетры и накинула покупателю 450 ₽ молча.
test('гетры и Jetron берутся только булевыми, мусор не восстанавливается', () => {
  const ok = sanitizeDraft({ gaiters: true, jetron: { chest: true, back: false } }, config());
  assert.equal(ok.gaiters, true);
  assert.deepEqual(ok.jetron, { chest: true, back: false });

  const junk = sanitizeDraft({ gaiters: 'false', jetron: 'chest' }, config());
  assert.equal('gaiters' in junk, false);
  assert.equal('jetron' in junk, false);
});

// Черновика может не быть вовсе, а в ключе может лежать чужая строка или число.
// Конструктор от этого не падает и просто открывается чистым.
test('нечерновик даёт null, а не пустую половину настроек', () => {
  assert.equal(sanitizeDraft(null, config()), null);
  assert.equal(sanitizeDraft('строка', config()), null);
  assert.equal(sanitizeDraft(42, config()), null);
  assert.deepEqual(sanitizeDraft({}, config()), {});
});
