// Сборка инструкции для клиента в .docx (источник: docs/ИНСТРУКЦИЯ-АДМИН.md).
// Пересобрать: node docs/build/make-instruction-docx.js
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, LevelFormat
} = require('docx');

const ACCENT = '14294C';
const MUTED = '6B6459';
const LINE = 'DAD0BD';
const WARN = 'FDF2E0';
const TABLE_W = 9360;

const t = (text, opts = {}) => new TextRun({ text, ...opts });
const arr = (x) => (Array.isArray(x) ? x : [t(x)]);
const p = (children, opts = {}) => new Paragraph({ children: arr(children), spacing: { after: 140, line: 276 }, ...opts });
const h1 = (text) => new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 160 } });
const h2 = (text) => new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 260, after: 120 } });
const code = (text) => t(text, { font: 'Consolas', size: 20, color: ACCENT });

const callout = (children) => new Paragraph({
  children: arr(children),
  spacing: { before: 120, after: 160, line: 276 },
  indent: { left: 220, right: 220 },
  shading: { type: ShadingType.CLEAR, fill: WARN },
  border: {
    top: { style: BorderStyle.SINGLE, size: 2, color: LINE },
    bottom: { style: BorderStyle.SINGLE, size: 2, color: LINE },
    left: { style: BorderStyle.SINGLE, size: 12, color: 'E0922F' },
    right: { style: BorderStyle.SINGLE, size: 2, color: LINE }
  }
});

const cell = (content, opts) => new TableCell({
  width: { size: opts.width, type: WidthType.DXA },
  margins: { top: 90, bottom: 90, left: 140, right: 140 },
  shading: opts.header ? { type: ShadingType.CLEAR, fill: 'F4EFE3' } : undefined,
  children: [new Paragraph({
    children: [t(content, { bold: !!opts.header, color: opts.header ? ACCENT : undefined })],
    spacing: { after: 0 }
  })]
});

const bd = { style: BorderStyle.SINGLE, size: 2, color: LINE };
const table = (widths, rows) => new Table({
  columnWidths: widths,
  width: { size: TABLE_W, type: WidthType.DXA },
  borders: { top: bd, bottom: bd, left: bd, right: bd, insideHorizontal: bd, insideVertical: bd },
  rows: rows.map((cells, i) => new TableRow({
    tableHeader: i === 0,
    children: cells.map((c, j) => cell(c, { width: widths[j], header: i === 0 }))
  }))
});

const bullet = (children) => new Paragraph({ children: arr(children), numbering: { reference: 'dash', level: 0 }, spacing: { after: 90, line: 276 } });
const step = (children) => new Paragraph({ children: arr(children), numbering: { reference: 'steps', level: 0 }, spacing: { after: 90, line: 276 } });

const numbering = { config: [
  { reference: 'dash', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 420, hanging: 240 } } } }] },
  { reference: 'steps', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 420, hanging: 240 } } } }] }
] };

const styles = { default: {
  document: { run: { font: 'Calibri', size: 22, color: '1B1B1B' } },
  heading1: { run: { font: 'Calibri', size: 30, bold: true, color: ACCENT } },
  heading2: { run: { font: 'Calibri', size: 25, bold: true, color: ACCENT } }
} };

const children = [
  new Paragraph({ children: [t('Конструктор футбольной формы', { bold: true, size: 40, color: ACCENT })], spacing: { after: 60 } }),
  new Paragraph({
    children: [t('Что вы можете менять сами, без программиста', { size: 26, color: MUTED })],
    spacing: { after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: LINE, space: 6 } }
  }),
  new Paragraph({ children: [t('Инструкция для администратора jetronsport.ru. Обновлено 28.07.2026.', { size: 20, color: MUTED })], spacing: { after: 260 } }),

  p('Ниже четыре вещи, которые вы настраиваете самостоятельно, и отдельно список того, что пока делается через разработчика.'),

  h1('1. Цена изделия: из карточки товара'),
  p('Конструктор берёт цену из обычной карточки товара WooCommerce. Отдельно в конструкторе цену менять не нужно.'),
  p([t('Как это работает. ', { bold: true }), t('Конструктор ищет товар по трём признакам:')]),
  table([2400, 3600, 3360], [
    ['Признак', 'Где задаётся в товаре', 'Пример'],
    ['Модель', 'атрибут «Модель»', 'Champion, Winner, Space'],
    ['Цвет', 'атрибут «Цвет»', 'Белый, Синий, Красный'],
    ['Возраст', 'категория товара', '«Взрослая форма» или «Детская форма»']
  ]),
  p(''),
  p([t('Что сделать, чтобы изменить цену: ', { bold: true }), t('откройте товар, измените цену, сохраните. В конструкторе новая цена появится в течение 10 минут, столько живёт кеш.')]),
  p([t('Чтобы у модели появилась своя цена', { bold: true }), t(', у товара должны быть заполнены оба атрибута, Модель и Цвет, и выбрана категория «Взрослая форма» или «Детская форма». Если товара нет или атрибуты не заполнены, конструктор покажет базовую цену 1280 руб., детская 1090 руб.')]),
  callout([t('Обратите внимание. ', { bold: true }), t('Сейчас в каталоге нет карточек для взрослого Champion, а также для линеек Legend и Venom. Для них показывается базовая цена. Заведите товары с нужными атрибутами, и цены подтянутся сами.')]),

  h1('2. Зоны нанесения: где и какого размера печать'),
  p('Зона это пунктирная рамка на макете: куда ляжет номер, фамилия или логотип. Рамки можно двигать и растягивать отдельно для каждой модели.'),
  h2('Как открыть редактор'),
  step('Войдите в админку сайта в этом же браузере.'),
  step([t('Откройте адрес: '), code('https://jetronsport.ru/constructor/?zones=edit')]),
  step('Внизу слева появится тёмная панель «Редактор зон».'),
  h2('Как править'),
  bullet('Выберите нужный цвет и модель, как обычный покупатель.'),
  bullet('Тяните рамку мышью, чтобы переместить. Тяните за угол, чтобы изменить размер. Содержимое, номер и фамилия, двигается вместе с рамкой, результат виден сразу.'),
  bullet([t('Нажмите '), t('«Сохранить»', { bold: true }), t('. Появится надпись «Сохранено».')]),
  bullet([t('Кнопка '), t('«Отменить правки»', { bold: true }), t(' возвращает зоны текущей модели к прежнему виду.')]),
  p('Зоны сохраняются отдельно для каждой модели. Покупатели увидят изменения после обновления страницы.')
];

children.push(
  h1('3. Кадрирование мокапа: убрать лишние поля с фотографии'),
  p('Если у фотографии формы большие пустые поля по краям или изделие смещено, кадр можно поправить.'),
  step([t('В том же редакторе, '), code('?zones=edit'), t(', нажмите '), t('«Кадрировать фон»', { bold: true }), t('.')]),
  step('Двигайте фотографию мышью, а за угловые точки увеличивайте или уменьшайте. Масштаб только пропорциональный, изображение не искажается.'),
  step([t('Нажмите '), t('«Применить кадр»', { bold: true }), t(', затем '), t('«Сохранить»', { bold: true }), t('.')]),

  h1('4. Страница конструктора и меню'),
  p([t('Конструктор встроен в страницу '), t('«Онлайн-конструктор формы»', { bold: true }), t('. Найдите её в разделе Страницы. Внутри неё один блок с кодом вставки, его лучше не трогать.')]),
  callout([t('Обратите внимание. ', { bold: true }), t('На сайте два разных меню: основное для компьютера и мобильное. Пункт, добавленный в одно меню, во втором не появится. Если добавляете новый раздел, добавьте в оба: Внешний вид, Меню, «Меню основное» и «Меню мобильное».')]),

  h1('Что пока делается через разработчика'),
  p('Эти настройки живут в файлах конструктора, из админки они недоступны:'),
  bullet([t('Добавить новую линейку или новый цвет формы', { bold: true }), t('. Нужно загрузить фотографии-мокапы и прописать модель в настройках конструктора.')]),
  bullet([t('Цены нанесений', { bold: true }), t(': фамилия и номер 600 руб., логотипы 300 руб. и так далее.')]),
  bullet([t('Шрифты', { bold: true }), t(' для фамилии и номера.')]),
  bullet([t('Размерные сетки', { bold: true }), t(' в таблице размеров.')]),
  p('Пришлите фотографии и данные, добавлю. Если хотите управлять этим самостоятельно, можно сделать отдельную страницу в админке под добавление моделей, цветов и цен нанесения. Это отдельная работа, обсудим объём.'),

  h1('Короткая памятка'),
  table([4680, 4680], [
    ['Что нужно', 'Куда идти'],
    ['Изменить цену формы', 'Товары, нужный товар, поле «Цена»'],
    ['Подвинуть рамку нанесения', '/constructor/?zones=edit, тянуть, «Сохранить»'],
    ['Поправить кадр фотографии', '/constructor/?zones=edit, «Кадрировать фон»'],
    ['Добавить пункт меню', 'Внешний вид, Меню, в оба меню'],
    ['Новая модель, цвет, шрифт, цена нанесения', 'написать разработчику']
  ])
);

const doc = new Document({
  creator: 'JetronSport',
  title: 'Конструктор футбольной формы: что вы можете менять сами',
  description: 'Инструкция для администратора jetronsport.ru',
  numbering,
  styles,
  sections: [{
    properties: { page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } },
    children
  }]
});

const out = path.join(__dirname, '..', 'Инструкция-конструктор-формы.docx');
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(out, buf);
  console.log('готово:', out, buf.length, 'байт');
});
