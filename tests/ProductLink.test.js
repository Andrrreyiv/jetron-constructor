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

test('адреса карточки нет — кнопки нет вовсе', () => {
  // Запасной путь «в раздел линейки» отменён 2026-09-07 замером боевого: все восемь адресов
  // /product-category/<линейка>/ отдают 404, такого раздела на сайте нет. Клиент голосом:
  // «кнопка перейти в карточку, но не работает, пишет, что страница не найдена».
  // Молчащая кнопка честнее битой: на боевом карточки нет у 9 пар из 90 (взрослый Champion
  // и три расцветки взрослого Фаворита) — их в WooCommerce не существует.
  assert.equal(productLink({ line: 'Волна' }, каталог), null);
});

test('незаполненный адрес карточки не считается адресом', () => {
  // Поле заводится сразу на все 45 форм, а заполняется по мере сбора ссылок: пустая строка
  // должна читаться как «адреса пока нет», иначе кнопка уведёт в никуда.
  assert.equal(productLink({ line: 'Волна', productUrl: '   ' }, каталог), null);
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

test('линейка Legend заведена в каталоге как «Легенда» — карточка всё равно находится', () => {
  // Замер живого каталога 2026-09-07: в WooCommerce модель называется «Легенда», в конфиге
  // конструктора — «Legend». Нормализация регистра и «ё» такое расхождение не берёт, и все
  // шесть расцветок линейки уходили мимо каталога на несуществующий раздел.
  const l = ссылкаИзКаталога(
    [{ model: 'Легенда', color: 'Белый', age: 'adult', price: 3900, url: '/product/belaya-legenda/' }],
    { line: 'Legend', color: 'Белый' }, 'adult');
  assert.equal(l.href, '/product/belaya-legenda/');
  assert.equal(l.isCard, true);
});

test('атрибут цвета разошёлся с самим товаром — карточка находится по замене', () => {
  // Замер 2026-09-07: «Легенда Голубой» лежит по адресу …sinyaya-legenda, «Фаворит Зелёный»
  // и «Space Зелёный» — по …salatovaya. У клиента в атрибуте одно слово, в самом товаре другое.
  const легенда = ссылкаИзКаталога(
    [{ model: 'Легенда', color: 'Голубой', age: 'adult', price: 3900, url: '/product/sinyaya-legenda/' }],
    { line: 'Legend', color: 'Синий' }, 'adult');
  assert.equal(легенда.href, '/product/sinyaya-legenda/');

  const фаворит = ссылкаИзКаталога(
    [{ model: 'Фаворит', color: 'Зелёный', age: 'adult', price: 3900, url: '/product/salatovaya-favorit/' }],
    { line: 'Фаворит', color: 'Салатовый' }, 'adult');
  assert.equal(фаворит.href, '/product/salatovaya-favorit/');
});

test('замена цвета не перебивает настоящий «Синий» у других линеек', () => {
  // Замены пробуются только после точного совпадения. Иначе Star, Winner, Champion и Волна,
  // у которых синий заведён по-настоящему, начали бы уводить в голубую карточку соседа.
  const l = ссылкаИзКаталога(
    [
      { model: 'Star', color: 'Голубой', age: 'adult', price: 3900, url: '/product/star-golubaya/' },
      { model: 'Star', color: 'Синий', age: 'adult', price: 3900, url: '/product/star-sinyaya/' },
    ],
    { line: 'Star', color: 'Синий' }, 'adult');
  assert.equal(l.href, '/product/star-sinyaya/');
});

test('лаймовая Легенда заведена в каталоге как жёлтая', () => {
  // Не догадка по остатку: на карточке «жёлтая Легенда» лежит картинка
  // …/detskaya-igrovaya-futbolnaya-forma-lajm-l.png — то есть тот же лайм (замер 2026-09-07).
  // Это же расхождение клиент назвал голосом: «форма с атрибутом жёлтый показывается
  // в конструкторе под зелёным».
  const l = ссылкаИзКаталога(
    [{ model: 'Легенда', color: 'Жёлтый', age: 'adult', price: 3900, url: '/product/zhyoltaya-legenda/' }],
    { line: 'Legend', color: 'Лаймовый' }, 'adult');
  assert.equal(l.href, '/product/zhyoltaya-legenda/');
});

test('позиции нет в каталоге — кнопки нет', () => {
  // Кораллового в каталоге нет: адрес карточки взять неоткуда, а раздела линейки на сайте
  // не существует (все восемь отдают 404). Значит кнопку не рисуем вовсе.
  assert.equal(ссылкаИзКаталога(позиции, { line: 'Волна', color: 'Коралловый' }, 'adult'), null);
});

test('карточка без адреса не выдаётся за карточку', () => {
  // WooCommerce вернул false вместо ссылки — PHP кладёт пустую строку, и это не адрес.
  assert.equal(ссылкаИзКаталога(
    [{ model: 'Волна', color: 'Синий', age: 'adult', price: 3900, url: '' }],
    { line: 'Волна', color: 'Синий' }, 'adult'), null);
});
