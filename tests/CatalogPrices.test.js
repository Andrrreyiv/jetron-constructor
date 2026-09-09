import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexCatalogPrices, resolveFormPrice, resolveFormSizes, resolveFormSizeGrid, resolveFormProductUrl, resolveLinePrice, indexColorHexes, resolveColorHex, applyColorHexes } from '../src/js/core/CatalogPrices.js';

const items = [
  { model: 'Champion', color: 'Белый', age: 'adult', price: 1280 },
  { model: 'Champion', color: 'Белый', age: 'child', price: 1090 },
  { model: 'Champion', color: 'Жёлтый', age: 'child', price: 1090 },
  { model: 'Legend', color: 'Красный', age: 'adult', price: 1350 }
];

test('индекс находит цену по модели, цвету и возрасту', () => {
  const idx = indexCatalogPrices(items);
  assert.equal(resolveFormPrice(idx, { line: 'Champion', color: 'Белый', ageCategory: 'adult' }, 999), 1280);
  assert.equal(resolveFormPrice(idx, { line: 'Champion', color: 'Белый', ageCategory: 'child' }, 999), 1090);
  assert.equal(resolveFormPrice(idx, { line: 'Legend', color: 'Красный', ageCategory: 'adult' }, 999), 1350);
});

// В каталоге и в конфиге написание расходится: «Жёлтый»/«Желтый», разный регистр и пробелы.
// Без нормализации цена молча свалится на fallback и клиент снова увидит «не подтягивается».
test('сопоставление терпимо к ё/е, регистру и пробелам', () => {
  const idx = indexCatalogPrices(items);
  assert.equal(resolveFormPrice(idx, { line: 'champion', color: ' Желтый ', ageCategory: 'child' }, 999), 1090);
  assert.equal(resolveFormPrice(idx, { line: 'CHAMPION', color: 'белый', ageCategory: 'adult' }, 999), 1280);
});

// Нет совпадения или каталог недоступен — работаем на цене из конфига, а не роняем конструктор.
test('без совпадения и на пустом каталоге возвращает запасную цену', () => {
  const idx = indexCatalogPrices(items);
  assert.equal(resolveFormPrice(idx, { line: 'Space', color: 'Синий', ageCategory: 'adult' }, 1280), 1280);
  assert.equal(resolveFormPrice(indexCatalogPrices([]), { line: 'Champion', color: 'Белый', ageCategory: 'adult' }, 1280), 1280);
  assert.equal(resolveFormPrice(null, { line: 'Champion', color: 'Белый', ageCategory: 'adult' }, 1280), 1280);
});

// Мусор из сети (нет цены, нулевая цена, битые поля) не должен подменять цену конфига.
test('позиции без корректной цены игнорируются', () => {
  const idx = indexCatalogPrices([
    { model: 'Champion', color: 'Белый', age: 'adult', price: 0 },
    { model: 'Rich', color: 'Синий', age: 'adult', price: 'дорого' },
    { model: 'Star', age: 'adult', price: 1200 }
  ]);
  assert.equal(resolveFormPrice(idx, { line: 'Champion', color: 'Белый', ageCategory: 'adult' }, 1280), 1280);
  assert.equal(resolveFormPrice(idx, { line: 'Rich', color: 'Синий', ageCategory: 'adult' }, 1280), 1280);
});

test('индекс запоминает размеры карточки, разные у линеек', () => {
  const index = indexCatalogPrices([
    { model: 'New', color: 'Белый', age: 'adult', price: 780, sizes: ['M', 'L', 'XL'] },
    { model: 'Star', color: 'Белый', age: 'adult', price: 1180, sizes: ['L', 'XL', '2XL'] },
    { model: 'New', color: 'Белый', age: 'child', price: 780 }
  ]);
  assert.deepEqual(resolveFormSizes(index, { line: 'New', color: 'Белый', ageCategory: 'adult' }), ['M', 'L', 'XL']);
  assert.deepEqual(resolveFormSizes(index, { line: 'Star', color: 'Белый', ageCategory: 'adult' }), ['L', 'XL', '2XL']);
  assert.deepEqual(resolveFormSizes(index, { line: 'New', color: 'Белый', ageCategory: 'child' }), [], 'атрибут не заполнен — пусто');
  assert.deepEqual(resolveFormSizes(index, { line: 'Venom', color: 'Белый', ageCategory: 'adult' }), [], 'нет карточки — пусто');
  assert.equal(resolveFormPrice(index, { line: 'Star', color: 'Белый', ageCategory: 'adult' }, 1280), 1180, 'цена не сломалась');
});

// Клиент 31.07 (видео): у каждой модели своя таблица размеров в ACF-полях термина «Модель»,
// с российским размером у взрослой. Она приходит от сервера уже готовой (title/columns/rows) —
// это источник правды, вместо угадывания групп линеек (bug 30.07: Winner показывал сетку Star).
test('готовая сетка модели (sizeGrid) приходит из индекса как есть', () => {
  const grid = {
    title: 'Взрослые размеры',
    columns: ['Размер на бирке', 'Российский размер', 'Рост, см'],
    rows: [['S', '44 (XS) RU', '160-168'], ['M', '46 (S) RU', '165-173']],
  };
  const index = indexCatalogPrices([
    { model: 'Winner', color: 'Красный', age: 'adult', price: 1280, sizeGrid: grid },
    { model: 'Champion', color: 'Белый', age: 'adult', price: 1280, sizeGrid: null },
  ]);
  assert.deepEqual(resolveFormSizeGrid(index, { line: 'Winner', color: 'Красный', ageCategory: 'adult' }), grid);
  assert.equal(resolveFormSizeGrid(index, { line: 'Champion', color: 'Белый', ageCategory: 'adult' }), null, 'пустая сетка (нет ACF-данных) — null, а не мусор');
  assert.equal(resolveFormSizeGrid(index, { line: 'Venom', color: 'Белый', ageCategory: 'adult' }), null, 'нет карточки — null');
  assert.equal(resolveFormSizeGrid(null, { line: 'Winner', color: 'Красный', ageCategory: 'adult' }), null, 'каталог недоступен — null, вызывающая сторона падает на конфиг');
});

// Битая форма (без rows/columns, будущая порча ACF-ответа) не должна долетать до рендера как есть.
test('sizeGrid без rows/columns отбрасывается на индексации', () => {
  const index = indexCatalogPrices([
    { model: 'Rich', color: 'Синий', age: 'adult', price: 1280, sizeGrid: { title: 'битая' } },
    { model: 'Star', color: 'Синий', age: 'adult', price: 1280, sizeGrid: { columns: ['a'], rows: [] } },
  ]);
  assert.equal(resolveFormSizeGrid(index, { line: 'Rich', color: 'Синий', ageCategory: 'adult' }), null);
  assert.equal(resolveFormSizeGrid(index, { line: 'Star', color: 'Синий', ageCategory: 'adult' }), null, 'пустой rows тоже не считается сеткой');
});

// Клиент 28.08 просил 45 ссылок на карточки расцветок. Собирать их руками не нужно: сопоставление
// «модель + цвет + возраст» у нас уже построено ради цены, и адрес приходит тем же ответом каталога.
test('адрес карточки расцветки берётся из каталога по той же паре модель+цвет', () => {
  const index = indexCatalogPrices([
    { model: 'Волна', color: 'Синий', age: 'adult', price: 1280, url: 'https://jetronsport.ru/product/volna-blue/' },
  ]);
  assert.equal(
    resolveFormProductUrl(index, { line: 'Волна', color: 'Синий', ageCategory: 'adult' }),
    'https://jetronsport.ru/product/volna-blue/'
  );
});

// Клиент 09.09: «цвет в конструкторе нужно самому выставлять? автоматически привязать нельзя?».
// Можно: оттенки кружков он уже ведёт у себя в поле «Цвет для иконки» расцветки, каталог отдаёт
// их тем же ответом. Ключ — имя расцветки, с той же терпимостью к ё/е и регистру, что и у цены.
test('оттенок кружка находится по имени расцветки', () => {
  const hexes = indexColorHexes([
    { name: 'Салатовый', hex: '#00FF00' },
    { name: 'Жёлтый', hex: '#ffde00' },
  ]);
  assert.equal(resolveColorHex(hexes, 'Салатовый', '#a4c639'), '#00ff00');
  assert.equal(resolveColorHex(hexes, ' желтый ', '#ffd400'), '#ffde00', 'ё/е и регистр не должны мешать');
});

// 🔴 Здесь ЗАМЕНЫ_ЦВЕТОВ применять НЕЛЬЗЯ, хотя для цены они и нужны. Замены существуют потому,
// что у части товаров атрибут разошёлся с адресом карточки («Легенда Голубой» лежит по
// …sinyaya-legenda). Но в фильтре каталога «Синий» и «Голубой» — две РАЗНЫЕ расцветки с разными
// оттенками (#213faa против #42d9ff), и по замене наш синий кружок стал бы голубым: привязка
// не починила бы цвет, а испортила. Совпадение по имени только точное.
test('оттенок не подменяется по заменам цветов: синий не берёт голубой', () => {
  const hexes = indexColorHexes([{ name: 'Голубой', hex: '#42d9ff' }]);
  assert.equal(resolveColorHex(hexes, 'Синий', '#213faa'), '#213faa');
});

// Расцветка без заполненного поля и вовсе неотвечающий каталог не должны оставить кружок пустым.
test('без оттенка на сайте и на пустом каталоге остаётся свой оттенок', () => {
  const hexes = indexColorHexes([{ name: 'Розовый', hex: '' }, null, { hex: '#123456' }]);
  assert.equal(resolveColorHex(hexes, 'Розовый', '#ff69b4'), '#ff69b4');
  assert.equal(resolveColorHex(indexColorHexes(null), 'Белый', '#ffffff'), '#ffffff');
  assert.equal(resolveColorHex(undefined, 'Белый', '#ffffff'), '#ffffff');
});

// Ручная правка оттенка в админке («Цвета кружков в фильтре») обязана быть СИЛЬНЕЕ сайта:
// иначе она молча вернулась бы к значению каталога — та же жалоба клиента 07.09 («поменял
// салатовый, а квадратик не поменялся»), только с другой стороны. Метку ставит сам сохраняющий
// обработчик admin.php, поэтому здесь достаточно её уважать.
test('привязка палитры: сайт побеждает, но не трогает оттенки, заданные руками', () => {
  const hexes = indexColorHexes([
    { name: 'Салатовый', hex: '#00ff00' },
    { name: 'Розовый', hex: '#ff007f' },
    { name: 'Белый', hex: '#ffffff' },
  ]);
  const palette = [
    { id: 'lightgreen', name: 'Салатовый', hex: '#7ac943' },
    { id: 'pink', name: 'Розовый', hex: '#ff69b4', hexManual: true },
    { id: 'white', name: 'Белый', hex: '#ffffff' },
    { id: 'gold', name: 'Золотой', hex: '#d4af37' },
  ];
  const changed = applyColorHexes(palette, hexes);
  assert.equal(changed, 1, 'меняется только салатовый: розовый закреплён руками, белый совпал, золотого на сайте нет');
  assert.equal(palette[0].hex, '#00ff00');
  assert.equal(palette[1].hex, '#ff69b4');
  assert.equal(palette[3].hex, '#d4af37');
});

// Клиент 09.09, голосовое: «ну тогда и ставим запасные взрослые 1680, детские 1480, как бы
// здесь без вариантов, это все игровые формы, и мы цены приравниваем к фактическим».
// Общий запасной прайс конфига (1280/1090) не годится ни одной линейке разом: New стоит 780,
// Легенда и Фаворит 1680/1480. Руками таблицу цен вести не нужно — настоящую цену линейки
// знают её же соседние расцветки в каталоге. Заодно это ответ «есть ли такой возраст вообще»:
// взрослого Чемпиона нет ни в одной расцветке, а взрослый Фаворит есть, просто не у всех.
test('цена возраста по линейке берётся у соседних расцветок', () => {
  const idx = indexCatalogPrices([
    { model: 'Фаворит', color: 'Зелёный', age: 'adult', price: 1680 },
    { model: 'Фаворит', color: 'Сиреневый', age: 'adult', price: 1680 },
    { model: 'Фаворит', color: 'Белый', age: 'child', price: 1480 },
    { model: 'Champion', color: 'Белый', age: 'child', price: 1090 },
  ]);
  assert.equal(resolveLinePrice(idx, { line: 'Фаворит', ageCategory: 'adult' }), 1680);
  assert.equal(resolveLinePrice(idx, { line: 'Фаворит', ageCategory: 'child' }), 1480);
  assert.equal(resolveLinePrice(idx, { line: 'Champion', ageCategory: 'adult' }), null,
    'взрослого Чемпиона нет ни в одной расцветке — придумывать цену нечем');
  assert.equal(resolveLinePrice(idx, { line: 'Волна', ageCategory: 'child' }), null,
    'линейки нет в каталоге вовсе');
  assert.equal(resolveLinePrice(null, { line: 'Фаворит', ageCategory: 'adult' }), null,
    'каталога нет — цену линейки взять неоткуда');
});

// Та же подмена, что и в точечном поиске: линейка Legend заведена в WooCommerce как «Легенда».
// Без неё шесть расцветок Легенды остались бы на общем запасном прайсе 1280 вместо 1680.
test('цена по линейке знает про подмену Legend → Легенда', () => {
  const idx = indexCatalogPrices([
    { model: 'Легенда', color: 'Белый', age: 'adult', price: 1680 },
    { model: 'Легенда', color: 'Синий', age: 'adult', price: 1680 },
  ]);
  assert.equal(resolveLinePrice(idx, { line: 'Legend', ageCategory: 'adult' }), 1680);
});
