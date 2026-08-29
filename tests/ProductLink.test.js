// Контракт кнопки на плашке над макетом.
//
// Клиент 28.08 (голосовое): «кнопка перейти в карточку, справа наверху, ведёт в карточку
// той формы, которая сейчас на экране», а не в раздел каталога по линейке.

import test from 'node:test';
import assert from 'node:assert/strict';

import { productLink } from '../src/js/core/ProductLink.js';
import { indexCatalogPrices, resolveFormProductUrl } from '../src/js/core/CatalogPrices.js';

const каталог = { base: '/shop/', suffix: '/', lineSlugs: { Волна: 'volna' } };

// Склейка, которую делает `_productLink()` в app.browser.js: адрес карточки приходит из того же
// ответа каталога, что цена и сетка размеров. Пишем её здесь, потому что сами по себе обе
// половины зелёные и по отдельности молчат, если звено между ними не соединено, — так и было
// до 28.08: `resolveFormProductUrl` существовал, PHP адрес не отдавал, кнопка вела в раздел.
function ссылкаИзКаталога(позиции, форма, возраст) {
  const index = indexCatalogPrices(позиции);
  const url = resolveFormProductUrl(index, { ...форма, ageCategory: возраст });
  return productLink({ ...форма, productUrl: url }, каталог);
}

test('адрес карточки берётся у формы, и кнопка так и подписана', () => {
  const l = productLink({ line: 'Волна', productUrl: '/product/volna-blue/' }, каталог);
  assert.equal(l.href, '/product/volna-blue/');
  assert.equal(l.isCard, true);
  assert.match(l.label, /карточк/i);
});

test('без адреса карточки ведёт в раздел линейки и не обещает карточку', () => {
  // Адреса 45 карточек клиент ещё не дал. Подписать кнопку «в карточку», а увести в раздел —
  // ровно та ложь, за которую он нас поправил 28.08.
  const l = productLink({ line: 'Волна' }, каталог);
  assert.equal(l.href, '/shop/volna/');
  assert.equal(l.isCard, false);
  assert.doesNotMatch(l.label, /карточк/i);
});

test('незаполненный адрес карточки не считается адресом', () => {
  // Поле заводится сразу на все 45 форм, а заполняется по мере сбора ссылок: пустая строка
  // должна читаться как «адреса пока нет», иначе кнопка уведёт в никуда.
  assert.equal(productLink({ line: 'Волна', productUrl: '   ' }, каталог).isCard, false);
});

test('без линейки и без адреса кнопки нет вовсе', () => {
  // Плашка рисуется только когда есть куда вести: иначе на макете висела бы мёртвая кнопка.
  assert.equal(productLink({}, каталог), null);
});

const позиции = [
  { model: 'Волна', color: 'Синий', age: 'adult', price: 3900, url: '/product/volna-siniy/' },
  { model: 'Волна', color: 'Синий', age: 'child', price: 3200, url: '/product/volna-siniy-det/' },
];

test('адрес карточки приезжает из каталога — 45 ссылок у клиента не просим', () => {
  const l = ссылкаИзКаталога(позиции, { line: 'Волна', color: 'Синий' }, 'adult');
  assert.equal(l.href, '/product/volna-siniy/');
  assert.equal(l.isCard, true);
});

test('возраст выбирает свою карточку: у взрослой и детской формы они разные', () => {
  // Кнопка обязана вести туда же, откуда взята показанная цена, иначе человек увидит одну
  // цену на макете и другую в карточке.
  assert.equal(ссылкаИзКаталога(позиции, { line: 'Волна', color: 'Синий' }, 'child').href,
    '/product/volna-siniy-det/');
});

test('расхождение написания цвета не роняет кнопку в раздел', () => {
  // Каталог пишет «Жёлтый», конфиг «Желтый». На этом уже спотыкалась цена — ключ нормализуется,
  // и адрес обязан находиться по тому же ключу.
  const l = ссылкаИзКаталога(
    [{ model: 'Волна', color: 'Жёлтый', age: 'adult', price: 3900, url: '/product/volna-yellow/' }],
    { line: 'волна ', color: 'Желтый' }, 'adult');
  assert.equal(l.href, '/product/volna-yellow/');
});

test('позиции нет в каталоге — кнопка честно уходит в раздел линейки', () => {
  // Чёрный Star клиент пришлёт позже; до тех пор обещать карточку нельзя.
  const l = ссылкаИзКаталога(позиции, { line: 'Волна', color: 'Коралловый' }, 'adult');
  assert.equal(l.href, '/shop/volna/');
  assert.equal(l.isCard, false);
});

test('карточка без адреса не выдаётся за карточку', () => {
  // WooCommerce вернул false вместо ссылки — PHP кладёт пустую строку, и это не адрес.
  const l = ссылкаИзКаталога(
    [{ model: 'Волна', color: 'Синий', age: 'adult', price: 3900, url: '' }],
    { line: 'Волна', color: 'Синий' }, 'adult');
  assert.equal(l.isCard, false);
  assert.equal(l.href, '/shop/volna/');
});
