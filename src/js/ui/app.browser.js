// Оркестратор стенда: конфиг → канвас → панель управления → живая цена.
// Браузерный слой (.browser.js, вне node:test). Источник правды о размещениях — this.edit
// (чистая модель EditHistory: undo + перенос между зонами). Канвас лишь отображает.
// Цена считается тестируемой calculatePrice из core/.
import { CanvasView } from './canvas.browser.js';
import { calculatePrice } from '../core/PriceCalculator.js';
import { buildOrder } from '../core/OrderSummary.js';
import { createState, setPlacement, removePlacement } from '../core/EditHistory.js';

const money = (n) => `${n.toLocaleString('ru-RU')} ₽`;
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const VIEW_LABEL = { front: 'Перед', back: 'Спина', shoulder: 'Плечо' };

export class UniformApp {
  constructor({ config, viewsEl, panelEl }) {
    this.config = config;
    this.viewsEl = viewsEl;
    this.panelEl = panelEl;

    // Перёд и спина показываются одновременно (ТЗ 2.2): по одному CanvasView на вид.
    this.views = new Map(); // viewName -> CanvasView
    this.formId = config.forms[0].id;
    this.colorId = config.forms[0].colorId; // выбор идёт от цвета (ТЗ §2.1): цвет → карусель форм
    this.ageCategory = 'adult';
    this.gaiters = false;
    this.quantity = 1;
    this.jetron = { chest: false, back: false };
    // Размещения на макете — производная от кэша опций: ключ `${view}:${zoneKey}` → {type,value,fontId,color}.
    this.edit = createState();
    // Дизайн-конструктор 2026-07-12 (2 голосовых клиента):
    // optCache — введённые данные опции, ПЕРЕЖИВАЮТ выключение (щёлкнул OFF → данные целы).
    // optShown — показана ли опция на макете (тумблер ON/OFF).
    // openOpt — id раскрытой карточки (аккордеон: открыта только одна, «не хватит места»).
    this.optCache = {}; // id → { name,number,fontId,color } | { image } | { text } | { number }
    this.optShown = {}; // id → bool
    this.openOpt = null; // id раскрытой опции
    this.textColor = (config.textColors && config.textColors[1]) ? config.textColors[1].hex : '#111111'; // чёрный по умолчанию
  }

  get form() {
    return this.config.forms.find((f) => f.id === this.formId);
  }

  // Зоны текущей формы: собственные zones, иначе именованный zoneSet
  // (напр. singleFront для линеек с отдельным фото переда), иначе общий шаблон.
  get formZones() {
    const named = this.form.zoneSet && this.config.zoneSets
      ? this.config.zoneSets[this.form.zoneSet]
      : null;
    return this.form.zones || named || this.config.zoneTemplate || [];
  }

  // Все формы выбранного цвета — это и есть «карусель» из ТЗ §2.1.
  formsForColor(colorId) {
    return this.config.forms.filter((f) => f.colorId === colorId);
  }

  // Русское склонение числительных: 1 модель / 2 модели / 5 моделей.
  plural(n, one, few, many) {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  // Есть ли в строке кириллица (диапазон U+0400..U+04FF).
  hasCyrillic(s) { return /[\u0400-\u04FF]/.test(s || ''); }

  fontById(fontId) { return (this.config.fonts || []).find((f) => f.id === fontId); }

  defaultFontId() {
    const def = (this.config.fonts || []).find((f) => f.default);
    return def ? def.id : ((this.config.fonts || [])[0] || { id: 'rpl' }).id;
  }

  // Шрифт для ОТРИСОВКИ (ТЗ §10.3/§11.2): если выбран латинский шрифт, а текст с
  // кириллицей — рисуем шрифтом РПЛ (по умолчанию), чтобы не было пустых квадратов.
  resolveFont(fontId, text) {
    const f = this.fontById(fontId);
    if (this.hasCyrillic(text) && f && !f.cyrillic) return this.defaultFontId();
    return fontId;
  }

  // Настройки загрузки из конфига (ТЗ §4) с безопасными значениями по умолчанию.
  uploadCfg() {
    return Object.assign(
      { maxUploadMB: 15, compressOverMB: 1.5, maxDimension: 1600, quality: 0.85 },
      this.config.upload || {}
    );
  }

  // Готовит файл логотипа к вставке (ТЗ §4): отклоняет файлы тяжелее лимита,
  // тяжёлые фото вписывает в maxDimension px и кодирует в web-формат (webp, иначе jpeg).
  // Проверку качества картинки не делаем. Возвращает { url } или { error }.
  prepareImage(file) {
    const cfg = this.uploadCfg();
    const MB = 1024 * 1024;
    if (file.size > cfg.maxUploadMB * MB) {
      return Promise.resolve({
        error: `Файл больше ${cfg.maxUploadMB} МБ. Загрузите изображение поменьше.`,
      });
    }
    // Лёгкие файлы вставляем как есть.
    if (file.size <= cfg.compressOverMB * MB) {
      return Promise.resolve({ url: URL.createObjectURL(file) });
    }
    // Тяжёлые — вписываем в maxDimension и пережимаем в web-формат.
    return new Promise((resolve) => {
      const img = new Image();
      const objUrl = URL.createObjectURL(file);
      img.onload = () => {
        const longSide = Math.max(img.naturalWidth, img.naturalHeight);
        const scale = longSide > cfg.maxDimension ? cfg.maxDimension / longSide : 1;
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(objUrl);
        let out = canvas.toDataURL('image/webp', cfg.quality);
        if (!out.startsWith('data:image/webp')) {
          out = canvas.toDataURL('image/jpeg', cfg.quality); // fallback
        }
        resolve({ url: out });
      };
      img.onerror = () => {
        URL.revokeObjectURL(objUrl);
        resolve({ error: 'Не удалось прочитать изображение. Попробуйте другой файл.' });
      };
      img.src = objUrl;
    });
  }

  get placements() {
    return this.edit.placements;
  }

  zonesFor(view) {
    return this.formZones.filter((z) => z.view === view);
  }

  // Виды к показу: перёд и спина всегда, плечо — если у модели есть зона плеча (ТЗ §9.3, C10).
  // Плечо показывается отдельной картинкой сбоку, а не на теле формы, поэтому у него нет фон-мокапа.
  viewList() {
    return [{ id: 'front', label: 'Перед' }];
  }

  async start() {
    await this.loadFonts();
    this.buildPanel();
    this.buildColorPicker();
    this.buildViews();
    await this.renderAll();
    this._installResizeRefit();
  }

  // Доступная ширина под ряд холстов = ширина сцены минус её внутренние отступы.
  // Меряем именно #stage (родителя), т.к. сам #views центрируется и сжимается по контенту.
  _availWidth() {
    const stage = this.viewsEl.parentElement;
    if (!stage) return 776;
    const cs = getComputedStyle(stage);
    const w = stage.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
    return Math.max(w, 260);
  }

  // Размер холста подстраивается под экран: на десктопе — как раньше (все виды в один ряд),
  // на планшете — 2 в ряд, на телефоне — один большой холст на всю ширину (а не крошечные 210px).
  _displayWidth(n) {
    const gap = 20, chrome = 26; // gap между колонками + паддинг/бордер .canvas-wrap
    const avail = this._availWidth();
    const deskDW = n >= 3 ? 210 : 300;
    const rowNeed = n * (deskDW + chrome) + (n - 1) * gap;
    if (avail >= rowNeed) return deskDW; // десктоп: поведение не меняется
    if (n >= 2 && avail >= 2 * (240 + chrome) + gap) { // планшет: 2 в ряд
      return Math.max(150, Math.min(300, Math.floor((avail - gap) / 2) - chrome));
    }
    return Math.max(150, Math.min(440, Math.round(avail - chrome))); // телефон: один на всю ширину
  }

  // Перестроить холсты при смене ширины экрана / повороте телефона (с дебаунсом).
  // Размещения переживают перестройку — они хранятся в this.edit, renderAll их восстановит.
  _installResizeRefit() {
    if (this._resizeInstalled) return;
    this._resizeInstalled = true;
    let t;
    window.addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const dw = this._displayWidth(this.viewList().length);
        if (Math.abs(dw - (this._lastDisplayWidth || 0)) < 8) return; // мелкие дрожания игнорируем
        this.buildViews();
        this.renderAll();
      }, 180);
    }, { passive: true });
  }

  async loadFonts() {
    this.fontsReady = [];
    for (const f of this.config.fonts || []) {
      try {
        const face = new FontFace(f.id, `url("${encodeURI(f.file)}")`);
        await face.load();
        document.fonts.add(face);
        this.fontsReady.push(f.id);
      } catch {
        // шрифт не критичен для стенда — падаем на sans-serif
      }
    }
  }

  buildViews() {
    // Пересоздаём канвасы (модель могла смениться → появилось/пропало плечо).
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.viewsEl.innerHTML = '';

    // Название линейки слева наверху макета (ТЗ 2026-07-10, C12): человек видит,
    // какую линейку выбрал (Стар/Виннер/…), чтобы потом найти форму в каталоге.
    if (this.form.line) {
      const badge = document.createElement('div');
      badge.className = 'line-badge';
      badge.textContent = this.form.line;
      this.viewsEl.appendChild(badge);
    }

    const list = this.viewList();
    const base = this.config.canvas || { width: 900, height: 1200, displayWidth: 450 };
    const displayWidth = this._displayWidth(list.length);
    this._lastDisplayWidth = displayWidth;

    for (const v of list) {
      const col = document.createElement('div');
      col.className = 'canvas-col';
      const wrap = document.createElement('div');
      wrap.className = 'canvas-wrap';
      const canvasEl = document.createElement('canvas');
      wrap.appendChild(canvasEl);
      // Одиночную картинку не подписываем — она и так одна (клиент 2026-07-12).
      if (list.length > 1) {
        const label = document.createElement('div');
        label.className = 'canvas-label';
        label.textContent = v.label;
        col.appendChild(label);
      }
      col.appendChild(wrap);
      this.viewsEl.appendChild(col);

      const view = new CanvasView(canvasEl, { ...base, displayWidth });
      view.onChange = () => this.updatePrice();
      view.onZoneClick((key) => this.selectZone(v.id, key));
      this.views.set(v.id, view);
    }
  }

  // Правая панель-конструктор (дизайн клиента 2026-07-12): заголовок → список опций-карточек
  // (аккордеон + тумблер ON/OFF + крестик) → доп.опции (размер/гетры/джетрон/кол-во) → итог + CTA.
  buildPanel() {
    const p = this.config.prices;
    this.panelEl.innerHTML = `
      <div class="panel-title">
        <h2>Соберите форму</h2>
        <p>Включайте нужные нанесения. Всё, что добавите, сразу видно на макете слева.</p>
      </div>

      <div id="opt-list" class="opt-list"></div>

      <section id="opt-extra" class="opt-extra">
        <h3>Комплектация</h3>
        <div class="extra-block">
          <span class="extra-label">Размерная категория</span>
          <div class="seg" id="age-seg">
            <button class="seg-btn active" data-age="adult">Взрослая · ${money(p.form.adult)}</button>
            <button class="seg-btn" data-age="child">Детская · ${money(p.form.child)}</button>
          </div>
        </div>
        <label class="extra-check"><input type="checkbox" id="opt-gaiters"> <span>Гетры <em>+${money(p.gaiters)}</em></span></label>
        <label class="extra-check"><input type="checkbox" id="opt-jchest"> <span>Джетрон на груди <em>−5%</em></span></label>
        <label class="extra-check"><input type="checkbox" id="opt-jback"> <span>Джетрон на спине <em>−5%</em></span></label>
        <div class="extra-block qty-block">
          <span class="extra-label">Комплектов</span>
          <div class="qty-stepper">
            <button type="button" id="qty-minus" aria-label="Меньше">−</button>
            <input type="number" id="opt-qty" min="1" value="1" inputmode="numeric">
            <button type="button" id="qty-plus" aria-label="Больше">+</button>
          </div>
        </div>
        <div class="extra-links">
          <button id="size-btn" class="linkbtn" type="button">Таблица размеров</button>
        </div>
      </section>

      <section id="price-box" class="price-box">
        <button id="price-lines-toggle" class="price-lines-toggle" type="button" aria-expanded="false">
          <span>Детализация</span><span class="chev">▾</span>
        </button>
        <div id="price-lines" class="price-lines" hidden></div>
        <div class="price-foot">
          <span class="price-foot-label">Итого</span>
          <span id="price-total" class="price-total"></span>
        </div>
        <button id="order-btn" class="cta">Оформить заказ</button>
      </section>
    `;

    // Размерная категория — сегмент-переключатель.
    this.panelEl.querySelectorAll('#age-seg .seg-btn').forEach((b) => {
      b.onclick = () => {
        this.ageCategory = b.dataset.age;
        this.panelEl.querySelectorAll('#age-seg .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
        this.updatePrice();
      };
    });
    this.panelEl.querySelector('#opt-gaiters').onchange = (e) => { this.gaiters = e.target.checked; this.updatePrice(); };
    this.panelEl.querySelector('#opt-jchest').onchange = (e) => { this.jetron.chest = e.target.checked; this.renderJetron(); this.updatePrice(); };
    this.panelEl.querySelector('#opt-jback').onchange = (e) => { this.jetron.back = e.target.checked; this.renderJetron(); this.updatePrice(); };

    const qty = this.panelEl.querySelector('#opt-qty');
    const setQty = (n) => { this.quantity = Math.max(1, n || 1); qty.value = this.quantity; this.updatePrice(); };
    qty.onchange = () => setQty(+qty.value);
    this.panelEl.querySelector('#qty-minus').onclick = () => setQty(this.quantity - 1);
    this.panelEl.querySelector('#qty-plus').onclick = () => setQty(this.quantity + 1);

    this.panelEl.querySelector('#size-btn').onclick = () => this.showSizes();
    this.panelEl.querySelector('#order-btn').onclick = () => this.showOrder();
    const linesToggle = this.panelEl.querySelector('#price-lines-toggle');
    linesToggle.onclick = () => {
      const lines = this.panelEl.querySelector('#price-lines');
      const open = lines.hidden;
      lines.hidden = !open;
      linesToggle.setAttribute('aria-expanded', String(open));
      linesToggle.classList.toggle('open', open);
    };

    this.renderOptionCards();
  }

  // Блок выбора цвета и модели ПОД макетом на тёмной сцене (дизайн 2026-07-12).
  buildColorPicker() {
    const host = document.getElementById('colorpick');
    if (!host) return;
    const colors = this.config.colors || [];
    const models = this.formsForColor(this.colorId);
    const activeColor = colors.find((c) => c.id === this.colorId);
    host.innerHTML = `
      <div class="cp-head">
        <div class="cp-title">Выберите цвет формы${activeColor ? ` <b>${escapeHtml(activeColor.name)}</b>` : ''}</div>
        <button id="download-btn" class="stage-btn" type="button">Скачать макет</button>
      </div>
      <div class="color-palette">
        ${colors.map((c) => `<button class="pcolor ${c.id === this.colorId ? 'active' : ''}"
           data-color="${c.id}" title="${escapeHtml(c.name)}" aria-label="${escapeHtml(c.name)}"
           style="background:${c.hex}"></button>`).join('')}
      </div>
      <div class="cp-models-label">Модель <b>${models.length} ${this.plural(models.length, 'вариант', 'варианта', 'вариантов')}</b></div>
      <div class="model-carousel">
        ${models.map((f) => `<button class="model-card ${f.id === this.formId ? 'active' : ''}"
           data-form="${f.id}" title="${escapeHtml(f.line)} ${escapeHtml(f.color)}">
           <span class="model-thumb"><img src="${encodeURI(f.images.front)}" alt="${escapeHtml(f.line)}" loading="lazy"></span>
        </button>`).join('')}
      </div>
    `;

    host.querySelectorAll('.pcolor').forEach((b) => {
      b.onclick = async () => {
        if (b.dataset.color === this.colorId) return;
        this.colorId = b.dataset.color;
        const first = this.formsForColor(this.colorId)[0];
        if (first) this.formId = first.id;
        this.buildColorPicker();
        this.buildViews();
        await this.renderAll();
      };
    });
    host.querySelectorAll('.model-card').forEach((b) => {
      b.onclick = async () => {
        if (b.dataset.form === this.formId) return;
        this.formId = b.dataset.form;
        this.buildColorPicker();
        this.buildViews();
        await this.renderAll();
      };
    });
    host.querySelector('#download-btn').onclick = () => this.downloadImage();
  }

  // ── Модель опций (аккордеон + кэш + тумблер) ─────────────────────────────
  // Опция описана в config.placementOptions; зоны и цены берутся из formZones (единый источник).

  availableOptions() {
    const zoneKeys = new Set(this.formZones.map((z) => `${z.view}:${z.key}`));
    return (this.config.placementOptions || []).filter((opt) =>
      this.optionPkeys(opt).every((pk) => zoneKeys.has(pk))
    );
  }

  optionById(id) { return (this.config.placementOptions || []).find((o) => o.id === id); }

  // Зоны опции: name_number → [nameZone, numberZone]; остальные → [zone].
  optionPkeys(opt) {
    return opt.kind === 'name_number' ? [opt.nameZone, opt.numberZone] : [opt.zone];
  }

  zoneByPkey(pkey) {
    const key = pkey.split(':').slice(1).join(':');
    return this.formZones.find((z) => z.key === key) || null;
  }

  // Цена опции = сумма цен её зон (номер на шортах/спине бесплатен → 0).
  optionPrice(opt) {
    let sum = 0;
    for (const pk of this.optionPkeys(opt)) {
      const z = this.zoneByPkey(pk);
      if (z) sum += z.price || 0;
    }
    return sum;
  }

  // Введены ли данные (тумблер показывается только если есть что показывать).
  optionHasData(opt) {
    const c = this.optCache[opt.id];
    if (!c) return false;
    if (opt.kind === 'name_number') return !!(c.name || c.number);
    if (opt.kind === 'upload') return !!c.image;
    if (opt.kind === 'number') return !!c.number;
    return !!(c.text || c.image); // text_or_upload
  }

  // Активна = есть данные И тумблер ON (иначе на макет не наносим).
  optionActive(opt) { return this.optionHasData(opt) && this.optShown[opt.id] !== false; }

  // Нанести данные опции на канвас + в модель размещений.
  applyOption(opt) {
    const c = this.optCache[opt.id] || {};
    const draw = (pkey, entry) => {
      const zone = this.zoneByPkey(pkey);
      if (!zone) return;
      const view = this.views.get(zone.view);
      this.edit = setPlacement(this.edit, pkey, entry);
      if (!view) return;
      if (entry.type === 'text') view.placeText(zone, entry.value, this.resolveFont(entry.fontId, entry.value), entry.color);
      else if (entry.type === 'image') view.placeImage(zone, entry.value);
    };
    if (opt.kind === 'name_number') {
      const fontId = c.fontId || this.defaultFontId();
      const color = c.color || this.textColor;
      if (c.name) draw(opt.nameZone, { type: 'text', value: c.name, fontId, color });
      else this.removePk(opt.nameZone);
      if (c.number) draw(opt.numberZone, { type: 'text', value: c.number, fontId, color });
      else this.removePk(opt.numberZone);
    } else if (opt.kind === 'upload') {
      if (c.image) draw(opt.zone, { type: 'image', value: c.image });
    } else if (opt.kind === 'number') {
      if (c.number) draw(opt.zone, { type: 'text', value: c.number, fontId: this.defaultFontId(), color: this.textColor });
    } else { // text_or_upload
      if (c.image) draw(opt.zone, { type: 'image', value: c.image });
      else if (c.text) draw(opt.zone, { type: 'text', value: c.text, fontId: c.fontId || this.defaultFontId(), color: c.color || this.textColor });
    }
  }

  removePk(pkey) {
    if (!(pkey in this.placements)) return;
    this.edit = removePlacement(this.edit, pkey);
    const zone = this.zoneByPkey(pkey);
    const view = zone && this.views.get(zone.view);
    if (view) view.removeFromZone(zone.key);
  }

  // Убрать опцию с макета, НЕ трогая кэш (клиент: «щёлкает и смотрит»).
  hideOption(opt) {
    for (const pk of this.optionPkeys(opt)) this.removePk(pk);
  }

  // Тумблер ON/OFF — прячет/возвращает без повторной загрузки.
  toggleOption(opt) {
    if (!this.optionHasData(opt)) return;
    const on = this.optShown[opt.id] !== false;
    this.optShown[opt.id] = !on;
    if (this.optShown[opt.id]) this.applyOption(opt);
    else this.hideOption(opt);
    this.renderJetron();
    this.renderOptionCards();
    this.updatePrice();
  }

  // Аккордеон: открыть карточку, закрыв предыдущую.
  openOption(id) {
    this.openOpt = this.openOpt === id ? null : id;
    this.renderOptionCards();
    if (this.openOpt) {
      const card = this.panelEl.querySelector(`.opt-card[data-opt="${id}"]`);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // Крестик: реально очищает кэш → кнопка загрузки снова становится «плюсом».
  deleteOption(opt) {
    this.hideOption(opt);
    delete this.optCache[opt.id];
    delete this.optShown[opt.id];
    this.renderJetron();
    this.renderOptionCards();
    this.updatePrice();
  }

  // Обновить кэш опции и синхронизировать макет (авто-ON при первом вводе данных).
  setOptData(opt, patch) {
    this.optCache[opt.id] = Object.assign({}, this.optCache[opt.id], patch);
    if (this.optionHasData(opt)) {
      if (this.optShown[opt.id] === undefined) this.optShown[opt.id] = true;
      if (this.optShown[opt.id]) this.applyOption(opt);
    } else {
      this.hideOption(opt);
    }
    this.renderJetron();
    this.updatePrice();
  }

  // Map размещений → сериализуемый массив для buildOrder (контракт корзины/U1).
  placementsArray() {
    const out = [];
    for (const [composite, p] of Object.entries(this.placements)) {
      const [view, ...rest] = composite.split(':');
      out.push({ view, zoneKey: rest.join(':'), type: p.type, value: p.value, fontId: p.fontId, color: p.color });
    }
    return out;
  }

  // Оформление заказа (ТЗ §6): выбор размера (детское/взрослое) → таблица размеров →
  // предложение гетр → итог → «В корзину» (на боевом уходит в WooCommerce + на почту grc2@bk.ru).
  showOrder() {
    const overlay = document.createElement('div');
    overlay.className = 'order-overlay';
    const card = document.createElement('div');
    card.className = 'order-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Оформление заказа');
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) close(); };

    const sizeTable = (cat) => {
      const grid = this.config.sizes?.[cat];
      if (!grid) return '';
      return `<table class="order-items">
        <thead><tr>${grid.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
        <tbody>${grid.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell))}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>`;
    };

    const render = () => {
      const order = buildOrder({
        config: this.config,
        formId: this.formId,
        ageCategory: this.ageCategory,
        gaiters: this.gaiters,
        jetron: this.jetron,
        quantity: this.quantity,
        placements: this.placementsArray()
      });
      this.lastOrder = order; // отладочный доступ + будущая отправка в WooCommerce (U1)

      const itemsRows = order.items.length
        ? order.items.map((i) => `<tr>
            <td>${i.label}</td>
            <td class="dim">${(VIEW_LABEL[i.view] || i.view).toLowerCase()}</td>
            <td>${i.text ? escapeHtml(i.text) : (i.type === 'image' ? 'логотип' : '')}</td>
            <td class="num">${i.price ? money(i.price) : '—'}</td>
          </tr>`).join('')
        : `<tr><td colspan="4" class="dim">Нанесений нет — чистая форма.</td></tr>`;

      card.innerHTML = `
        <div class="order-head">
          <h2>Оформление заказа</h2>
          <button class="order-close" aria-label="Закрыть">×</button>
        </div>
        <div class="order-body">
          <div class="order-row"><span>Модель</span><b><span class="dot" style="background:${order.colorHex}"></span>${order.formName}</b></div>

          <h3 style="margin:14px 0 6px">1. Размер</h3>
          <div class="row">
            <label><input type="radio" name="ord-age" value="adult" ${this.ageCategory === 'adult' ? 'checked' : ''}> Взрослый (${money(this.config.prices.form.adult)})</label>
            <label><input type="radio" name="ord-age" value="child" ${this.ageCategory === 'child' ? 'checked' : ''}> Детский (${money(this.config.prices.form.child)})</label>
          </div>
          ${sizeTable(this.ageCategory)}

          <h3 style="margin:14px 0 6px">2. Гетры</h3>
          <label><input type="checkbox" id="ord-gaiters" ${this.gaiters ? 'checked' : ''}> Добавить гетры (+${money(this.config.prices.gaiters)})</label>

          <h3 style="margin:14px 0 6px">3. Нанесения</h3>
          <table class="order-items">
            <thead><tr><th>Нанесение</th><th>Где</th><th>Значение</th><th class="num">Цена</th></tr></thead>
            <tbody>${itemsRows}</tbody>
          </table>

          <div class="order-totals">
            <div class="pline"><span>Форма</span><span>${money(order.price.formPrice)}</span></div>
            ${order.price.placementTotal ? `<div class="pline"><span>Нанесение</span><span>${money(order.price.placementTotal)}</span></div>` : ''}
            ${order.price.gaitersPrice ? `<div class="pline"><span>Гетры</span><span>${money(order.price.gaitersPrice)}</span></div>` : ''}
            ${order.price.discountPct ? `<div class="pline discount"><span>Скидка Джетрон</span><span>−${Math.round(order.price.discountPct * 100)}%</span></div>` : ''}
            <div class="pline"><span>За комплект</span><span>${money(order.price.perKit)}</span></div>
            <div class="pline"><span>Комплектов</span><span>${order.quantity}</span></div>
          </div>
          <div class="order-grand">Итого: <b>${money(order.price.grandTotal)}</b></div>
        </div>
        <div class="order-foot">
          <button class="order-close ghost">Продолжить редактирование</button>
          <button id="order-confirm">В корзину</button>
        </div>`;

      card.querySelectorAll('.order-close').forEach((b) => { b.onclick = close; });
      card.querySelectorAll('input[name="ord-age"]').forEach((r) => {
        r.onchange = () => {
          this.ageCategory = r.value;
          this.syncPanelControls();
          this.updatePrice();
          render();
        };
      });
      card.querySelector('#ord-gaiters').onchange = (e) => {
        this.gaiters = e.target.checked;
        this.syncPanelControls();
        this.updatePrice();
        render();
      };
      card.querySelector('#order-confirm').onclick = () => {
        // Стенд Phase 0: реальной отправки нет. На боевом → корзина WooCommerce (U1) + письмо на grc2@bk.ru (§6).
        const foot = card.querySelector('.order-foot');
        foot.innerHTML = `<p class="hint" style="margin:0">Заказ собран: макет, файлы и надписи готовы к передаче. На боевом сайте уходит в корзину WooCommerce (U1) и на почту grc2@bk.ru.</p>`;
      };
    };

    render();
  }

  // Синхронизировать контролы левой панели с состоянием, изменённым внутри модалки заказа.
  syncPanelControls() {
    this.panelEl.querySelectorAll('#age-seg .seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.age === this.ageCategory);
    });
    const g = this.panelEl.querySelector('#opt-gaiters');
    if (g) g.checked = this.gaiters;
  }

  // Таблица размеров (ТЗ 6): показываем сетки из конфига для всех категорий.
  showSizes() {
    const sizes = this.config.sizes || {};
    const tables = Object.entries(sizes).map(([, grid]) => `
      <h3 style="margin:14px 0 6px">${grid.title}</h3>
      <table class="order-items">
        <thead><tr>${grid.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
        <tbody>${grid.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell))}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>`).join('');

    const overlay = document.createElement('div');
    overlay.className = 'order-overlay';
    overlay.innerHTML = `
      <div class="order-card" role="dialog" aria-label="Таблица размеров">
        <div class="order-head">
          <h2>Таблица размеров</h2>
          <button class="order-close" aria-label="Закрыть">×</button>
        </div>
        <div class="order-body">
          ${tables}
          <p class="hint">Замеряйте по росту/обхвату груди. При сомнении между размерами берите больший.</p>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelectorAll('.order-close').forEach((b) => { b.onclick = close; });
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
  }

  // Скачать макет: собираем все виды (перёд/спина/плечо) в один PNG без служебных рамок.
  async downloadImage() {
    const loadImg = (url) => new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = url;
    });
    const imgs = [];
    for (const [name, view] of this.views) {
      imgs.push({ name, img: await loadImg(view.toDataURL()) });
    }
    if (!imgs.length) return;

    const gap = 24;
    const pad = 24;
    const labelH = 34;
    const maxH = Math.max(...imgs.map((e) => e.img.height));
    const totalW = imgs.reduce((s, e) => s + e.img.width, 0) + gap * (imgs.length - 1) + pad * 2;
    const totalH = maxH + labelH + pad * 2;

    const c = document.createElement('canvas');
    c.width = totalW;
    c.height = totalH;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, totalW, totalH);
    ctx.fillStyle = '#16202e';
    ctx.font = '600 22px -apple-system, Segoe UI, Arial, sans-serif';
    ctx.textAlign = 'center';

    let x = pad;
    for (const e of imgs) {
      ctx.fillText(VIEW_LABEL[e.name] || e.name, x + e.img.width / 2, pad + 24);
      ctx.drawImage(e.img, x, pad + labelH);
      x += e.img.width + gap;
    }

    const a = document.createElement('a');
    a.download = `jetron-${this.formId}.png`;
    a.href = c.toDataURL('image/png');
    a.click();
  }

  async renderAll() {
    for (const [viewName, view] of this.views) {
      const img = this.form.images[viewName];
      // Плечо (и любой вид без мокапа) — нейтральный холст: лого показывается отдельной картинкой (ТЗ §9.3).
      if (img) await view.setBackground(encodeURI(img));
      else view.setNeutral();
      view.renderZones(this.zonesFor(viewName));
      // восстановить размещения этого вида из состояния
      for (const zone of this.zonesFor(viewName)) {
        const p = this.placements[`${viewName}:${zone.key}`];
        if (!p) continue;
        if (p.type === 'text') view.placeText(zone, p.value, this.resolveFont(p.fontId, p.value), p.color);
        else if (p.type === 'image') await view.placeImage(zone, p.value);
      }
    }
    this.renderJetron();
    this.renderOptionCards();
    this.updatePrice();
  }

  // Брендинг Джетрон (ТЗ §5, подтверждено клиентом 2026-07-10): «JETRON» на груди
  // и «JETRONSPORT.RU» под номером на спине — как на реальных макетах клиента.
  // Рисуется только визуально; скидка −5%/−5% считается в calculatePrice независимо от отрисовки.
  renderJetron() {
    const front = this.views.get('front');
    const back = this.views.get('back');
    if (front) front.clearStatic();
    if (back) back.clearStatic();

    if (this.jetron.chest && front) {
      const zone = this.zonesFor('front').find((z) => z.key === 'chest_logo_large');
      if (zone && !this.placements['front:chest_logo_large']) {
        front.placeStaticText(zone.box, 'JETRON', '#111111');
      }
    }
    if (this.jetron.back && back) {
      // «Под номером на спине» — там же, где логотип под номером; пропускаем, если место занято (§5).
      const anchor = this.zonesFor('back').find((z) => z.key === 'back_logo');
      if (anchor && !this.placements['back:back_logo']) {
        back.placeStaticText(anchor.box, 'JETRONSPORT.RU', '#111111');
      }
    }
  }

  // Клик по зоне на макете открывает соответствующую карточку опции (аккордеон).
  selectZone(view, key) {
    const pkey = `${view}:${key}`;
    const opt = this.availableOptions().find((o) => this.optionPkeys(o).includes(pkey));
    if (opt) {
      this.openOpt = opt.id;
      this.renderOptionCards();
      const card = this.panelEl.querySelector(`.opt-card[data-opt="${opt.id}"]`);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // ── Карточки опций (аккордеон + тумблер ON/OFF + крестик удаления) ────────
  renderOptionCards() {
    const list = this.panelEl.querySelector('#opt-list');
    if (!list) return;
    const opts = this.availableOptions();
    list.innerHTML = opts.map((opt) => this.optionCardHtml(opt)).join('');
    opts.forEach((opt) => this.wireOptionCard(opt));
  }

  optionCardHtml(opt) {
    const active = this.optionActive(opt);
    const hasData = this.optionHasData(opt);
    const open = this.openOpt === opt.id;
    const price = this.optionPrice(opt);
    const priceLabel = price > 0 ? `+${money(price)}` : 'бесплатно';
    // Тумблер показываем только когда есть данные (клиент: без данных опция не активна).
    const toggle = hasData
      ? `<button class="opt-toggle ${active ? 'on' : ''}" data-act="toggle" aria-label="Показать на макете" aria-pressed="${active}"><span class="knob"></span></button>`
      : '';
    return `
      <div class="opt-card ${active ? 'active' : ''} ${open ? 'open' : ''}" data-opt="${opt.id}">
        <div class="opt-head" data-act="head" role="button" tabindex="0">
          <div class="opt-head-text">
            <span class="opt-title">${escapeHtml(opt.title)}</span>
            ${opt.subtitle ? `<span class="opt-sub">${escapeHtml(opt.subtitle)}</span>` : ''}
          </div>
          <div class="opt-head-right">
            ${toggle}
            <span class="opt-price">${priceLabel}</span>
            <span class="opt-chev">▾</span>
          </div>
        </div>
        ${open ? `<div class="opt-body">${this.optionBodyHtml(opt)}</div>` : ''}
      </div>`;
  }

  optionBodyHtml(opt) {
    const c = this.optCache[opt.id] || {};
    const uploadBtn = (has, label) => `
      <label class="opt-upload ${has ? 'has' : ''}">
        <input type="file" accept="image/*" data-field="image" hidden>
        <span class="opt-upload-icon">${has ? '✓' : '+'}</span>
        <span class="opt-upload-text">${has ? 'Файл загружен' : label}</span>
        ${has ? '<span class="opt-del" data-act="del" role="button" aria-label="Удалить" title="Удалить">×</span>' : ''}
      </label>
      <p class="opt-note" data-role="note" hidden></p>`;

    if (opt.kind === 'name_number') {
      return `
        <div class="opt-fields">
          <input class="opt-in" type="text" data-field="name" placeholder="Фамилия" value="${escapeHtml(c.name || '')}">
          <input class="opt-in opt-in-sm" type="text" data-field="number" placeholder="№" inputmode="numeric" value="${escapeHtml(c.number || '')}">
        </div>
        ${this.fontColorHtml(c)}`;
    }
    if (opt.kind === 'upload') {
      return uploadBtn(!!c.image, 'Загрузить логотип');
    }
    if (opt.kind === 'number') {
      return `<input class="opt-in" type="text" data-field="number" placeholder="${escapeHtml(opt.placeholder || 'Номер')}" inputmode="numeric" value="${escapeHtml(c.number || '')}">`;
    }
    // text_or_upload — текст ИЛИ логотип.
    return `
      <input class="opt-in" type="text" data-field="text" placeholder="${escapeHtml(opt.placeholder || 'Текст')}" value="${escapeHtml(c.text || '')}" ${c.image ? 'disabled' : ''}>
      <div class="opt-or">или</div>
      ${uploadBtn(!!c.image, 'Загрузить логотип')}
      ${c.image ? '' : this.fontColorHtml(c)}`;
  }

  // Образец для превью шрифта: текст рисуется САМИМ шрифтом, чтобы человек листал
  // и сразу видел, как будет выглядеть (клиент 2026-07-12). Латинские шрифты кириллицу
  // не держат — им даём латинский образец, иначе были бы пустые квадраты.
  fontSampleText(f, c) {
    const num = (c.number || '10').slice(0, 3);
    if (f.cyrillic) return `${c.name || 'Фамилия'} ${num}`;
    const name = (c.name && !this.hasCyrillic(c.name)) ? c.name : 'PLAYER';
    return `${name} ${num}`;
  }

  // Свёрнутый блок «Шрифт и цвет» для текстовых опций.
  fontColorHtml(c) {
    const fonts = this.config.fonts || [];
    const colors = this.config.textColors || [];
    const curColor = c.color || this.textColor;
    const curFont = c.fontId || this.defaultFontId();
    return `
      <details class="opt-font" ${c.fontId || c.color ? 'open' : ''}>
        <summary>Шрифт и цвет</summary>
        <div class="font-list" role="listbox" aria-label="Шрифт">
          ${fonts.map((f) => `<button type="button" class="font-opt ${f.id === curFont ? 'active' : ''}"
             data-font="${f.id}" role="option" aria-selected="${f.id === curFont}" title="${escapeHtml(f.name)}">
             <span class="font-opt-sample" style="font-family:'${f.id}', sans-serif">${escapeHtml(this.fontSampleText(f, c))}</span>
             <span class="font-opt-name">${escapeHtml(f.name)}${f.cyrillic ? '' : ' · лат.'}</span>
          </button>`).join('')}
        </div>
        <div class="swatches color-row">
          ${colors.map((col) => `<button class="color-sw ${col.hex === curColor ? 'active' : ''}" data-color="${col.hex}" title="${escapeHtml(col.name)}" style="background:${col.hex}"></button>`).join('')}
        </div>
      </details>`;
  }

  wireOptionCard(opt) {
    const card = this.panelEl.querySelector(`.opt-card[data-opt="${opt.id}"]`);
    if (!card) return;

    const head = card.querySelector('[data-act="head"]');
    head.onclick = (e) => {
      if (e.target.closest('[data-act="toggle"]')) return;
      this.openOption(opt.id);
    };
    head.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.openOption(opt.id); } };

    const toggle = card.querySelector('[data-act="toggle"]');
    if (toggle) toggle.onclick = (e) => { e.stopPropagation(); this.toggleOption(opt); };

    const body = card.querySelector('.opt-body');
    if (!body) return;

    // Текстовые поля: обновляем кэш без полной перерисовки (не теряем фокус),
    // только подсвечиваем активность карточки на месте.
    body.querySelectorAll('input[type="text"]').forEach((inp) => {
      inp.oninput = () => {
        this.setOptData(opt, { [inp.dataset.field]: inp.value.trim() });
        card.classList.toggle('active', this.optionActive(opt));
        this.refreshToggle(card, opt);
      };
    });

    // Шрифт: список превью, каждый образец нарисован своим шрифтом.
    body.querySelectorAll('.font-opt').forEach((b) => {
      b.onclick = () => {
        body.querySelectorAll('.font-opt').forEach((x) => {
          const on = x === b;
          x.classList.toggle('active', on);
          x.setAttribute('aria-selected', String(on));
        });
        this.setOptData(opt, { fontId: b.dataset.font });
      };
    });

    // Цвет шрифта.
    body.querySelectorAll('.color-sw').forEach((b) => {
      b.onclick = () => {
        body.querySelectorAll('.color-sw').forEach((x) => x.classList.toggle('active', x === b));
        this.setOptData(opt, { color: b.dataset.color });
      };
    });

    // Загрузка файла.
    const file = body.querySelector('input[type="file"]');
    if (file) file.onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const note = body.querySelector('[data-role="note"]');
      const res = await this.prepareImage(f);
      if (res.error) {
        if (note) { note.textContent = res.error; note.hidden = false; }
        e.target.value = '';
        return;
      }
      this.setOptData(opt, { image: res.url });
      this.renderOptionCards();
    };

    // Крестик удаления (внутри upload-кнопки).
    const del = body.querySelector('[data-act="del"]');
    if (del) del.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.deleteOption(opt); };
  }

  // Обновить состояние тумблера в шапке карточки без полной перерисовки списка.
  refreshToggle(card, opt) {
    const right = card.querySelector('.opt-head-right');
    if (!right) return;
    const hasData = this.optionHasData(opt);
    let toggle = right.querySelector('[data-act="toggle"]');
    if (hasData && !toggle) {
      toggle = document.createElement('button');
      toggle.className = 'opt-toggle on';
      toggle.dataset.act = 'toggle';
      toggle.setAttribute('aria-label', 'Показать на макете');
      toggle.innerHTML = '<span class="knob"></span>';
      toggle.onclick = (e) => { e.stopPropagation(); this.toggleOption(opt); };
      right.insertBefore(toggle, right.firstChild);
    } else if (!hasData && toggle) {
      toggle.remove();
    } else if (toggle) {
      const active = this.optionActive(opt);
      toggle.classList.toggle('on', active);
      toggle.setAttribute('aria-pressed', String(active));
    }
  }

  // Занятые зоны = зоны активных опций → цена за весь комплект (единый источник — formZones).
  usedZones() {
    const out = [];
    const seen = new Set();
    for (const opt of this.availableOptions()) {
      if (!this.optionActive(opt)) continue;
      for (const pk of this.optionPkeys(opt)) {
        const z = this.zoneByPkey(pk);
        if (!z || seen.has(z.key)) continue;
        seen.add(z.key);
        out.push({ key: z.key, priceGroup: z.priceGroup || z.key, price: z.price || 0 });
      }
    }
    return out;
  }

  updatePrice() {
    const r = calculatePrice({
      prices: this.config.prices,
      ageCategory: this.ageCategory,
      usedZones: this.usedZones(),
      gaiters: this.gaiters,
      jetron: this.jetron,
      quantity: this.quantity
    });
    const lines = [
      ['Форма', r.formPrice],
      ['Нанесение', r.placementTotal],
      ['Гетры', r.gaitersPrice]
    ].filter(([, v]) => v > 0);
    const linesEl = this.panelEl.querySelector('#price-lines');
    const totalEl = this.panelEl.querySelector('#price-total');
    if (!totalEl) return;
    if (linesEl) {
      linesEl.innerHTML = lines.map(([k, v]) => `<div class="pline"><span>${k}</span><span>${money(v)}</span></div>`).join('');
      if (r.discountPct > 0) {
        linesEl.innerHTML += `<div class="pline discount"><span>Скидка Джетрон</span><span>−${Math.round(r.discountPct * 100)}%</span></div>`;
      }
      if (this.quantity > 1) {
        linesEl.innerHTML += `<div class="pline"><span>За комплект × ${this.quantity}</span><span>${money(r.total)}</span></div>`;
      }
    }
    totalEl.textContent = money(r.total * this.quantity);

    // Микро-взаимодействие: лёгкий «удар» суммы при её изменении.
    const grand = r.total * this.quantity;
    if (this._lastGrand !== undefined && this._lastGrand !== grand) {
      totalEl.classList.remove('bump');
      void totalEl.offsetWidth; // reflow, чтобы перезапустить анимацию
      totalEl.classList.add('bump');
    }
    this._lastGrand = grand;
  }
}
