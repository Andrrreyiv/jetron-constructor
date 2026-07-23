// Оркестратор стенда: конфиг → канвас → панель управления → живая цена.
// Браузерный слой (.browser.js, вне node:test). Источник правды о размещениях — this.edit
// (чистая модель EditHistory: undo + перенос между зонами). Канвас лишь отображает.
// Цена считается тестируемой calculatePrice из core/.
import { CanvasView } from './canvas.browser.js?v=20260723b';
import { calculatePrice } from '../core/PriceCalculator.js';
import { buildOrder } from '../core/OrderSummary.js';
import { createState, setPlacement, removePlacement } from '../core/EditHistory.js';
import { applyZoneOverrides, resolveBrandBox } from '../core/ZoneOverrides.js?v=20260723b';

const money = (n) => `${n.toLocaleString('ru-RU')} ₽`;
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const VIEW_LABEL = { front: 'Перед', back: 'Спина', shoulder: 'Плечо' };

// Иконка «волшебная палочка» для кнопки «Удалить фон» (по эскизу клиента: чёрная палочка + жёлтые искры).
// Инлайн-SVG вместо картинки: масштабируется, без лишнего запроса, легко перекрасить.
const WAND_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
  <line x1="3.4" y1="20.6" x2="14" y2="10" stroke="#111" stroke-width="3.4" stroke-linecap="round"/>
  <line x1="12.4" y1="11.6" x2="15" y2="9" stroke="#fff" stroke-width="1.1" stroke-linecap="round"/>
  <path d="M17 2.5l.86 2.14 2.14.86-2.14.86L17 8.5l-.86-2.14L14 5.5l2.14-.86z" fill="#F5C518"/>
  <path d="M20.8 8.6l.56 1.4 1.4.56-1.4.56-.56 1.4-.56-1.4-1.4-.56 1.4-.56z" fill="#F5C518"/>
  <path d="M11.4 3.4l.5 1.24 1.24.5-1.24.5-.5 1.24-.5-1.24-1.24-.5 1.24-.5z" fill="#F5C518"/>
</svg>`;

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
    this.size = ''; // конкретный размер (клиент 2026-07-15: «размеры не могу выбрать»)
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
    this.extraOpen = false; // «Комплектация» свёрнута (клиент 2026-07-15: «итого ушло вниз, подтяни выше»)
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
    const base = this.form.zones || named || this.config.zoneTemplate || [];
    // Переопределения координат из редактора зон (zones.json) поверх базовых зон формы.
    return applyZoneOverrides(base, this.formId, this.config.zoneOverrides);
  }

  // Per-form кадрирование фона (crops.json): доля мокапа, которую оставляем (режем серые поля).
  // null → показываем изображение целиком. Пишет редактор зон (Phase 2), читает setBackground.
  get formCrop() {
    return (this.config.bgCrops && this.config.bgCrops[this.formId]) || null;
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

  // Виды к показу зависят от типа мокапа модели:
  //  • Композитный мокап (одна картинка = перёд+спина+гетры рядом, front===back) → ОДИН холст,
  //    на нём рисуются ВСЕ зоны (переда, спины, плеча) — иначе фамилия/номер спины не видны (клиент:
  //    «Всё, что добавите, сразу видно на макете слева»).
  //  • Раздельные картинки переда и спины (front!==back) → ДВА холста, каждый со своими зонами.
  viewList() {
    const im = this.form.images || {};
    if (im.front && im.back && im.front !== im.back) {
      return [{ id: 'front', label: 'Перёд' }, { id: 'back', label: 'Спина' }];
    }
    return [{ id: 'front', label: 'Макет' }];
  }

  // Композитный мокап: перёд и спина — одна и та же картинка (все зоны на одном холсте).
  _isComposite() {
    const im = this.form.images || {};
    return !!(im.front && im.back && im.front === im.back);
  }

  // Единственный (главный) холст — для композитного мокапа и как fallback.
  soleView() {
    return this.views.get('front') || this.views.values().next().value || null;
  }

  // Холст, на который наносится зона: свой вид, а если его нет (композит/плечо) — главный холст.
  // Так «всё, что добавили» всегда попадает на видимый макет.
  targetView(zone) {
    return this.views.get(zone.view) || this.soleView();
  }

  async start() {
    await this.loadFonts();
    await this.loadBranding();
    this.buildPanel();
    this.buildColorPicker();
    this.buildViews();
    await this.renderAll();
    this._installResizeRefit();
    this._installExitButton();
  }

  // Крестик выхода из конструктора (клиент 2026-07-17: «из самого конструктора нет выхода,
  // добавьте крестик»). Конструктор — полноэкранный виджет (на телефоне во всю ширину внутри
  // iframe на странице товара), уйти из него некуда. Крестик возвращает в каталог.
  _installExitButton() {
    if (this._exitInstalled || typeof document === 'undefined') return;
    this._exitInstalled = true;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'constructor-exit';
    btn.setAttribute('aria-label', 'Выйти из конструктора');
    btn.textContent = '×';
    Object.assign(btn.style, {
      position: 'fixed', top: '10px', right: '10px', zIndex: '2147483647',
      width: '40px', height: '40px', lineHeight: '38px', padding: '0',
      borderRadius: '50%', border: 'none', cursor: 'pointer',
      background: 'rgba(17,17,17,0.72)', color: '#fff',
      fontSize: '26px', fontWeight: '400', textAlign: 'center',
      boxShadow: '0 2px 8px rgba(0,0,0,0.25)'
    });
    btn.onclick = () => this._exitConstructor();
    document.body.appendChild(btn);
  }

  // Уводит пользователя из конструктора в каталог. Конструктор встроен в страницу товара
  // тем же доменом (same-origin), поэтому правим верхнее окно; при кросс-доменном/автономном
  // варианте — падаем на навигацию текущего окна.
  _exitConstructor() {
    const target = '/shop/';
    try {
      if (window.top && window.top !== window.self) {
        window.top.location.href = target;
        return;
      }
    } catch { /* кросс-домен: до верхнего окна не дотянуться, уводим текущее */ }
    window.location.href = target;
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
    // Телефон (узкий экран ≤560): всегда один холст во всю ширину. Клиент 2026-07-16 —
    // «во весь экран без полей». Раньше при одном виде срабатывала десктопная ветка (300+26
    // влезало в avail) и холст застревал на 300px — теперь на телефоне сразу full-width.
    if (typeof window !== 'undefined' && window.innerWidth <= 560) {
      return Math.max(150, Math.min(520, Math.round(avail - 6)));
    }
    // Один композитный холст (перёд+спина+гетры на одной картинке) — показываем КРУПНО, почти
    // во всю ширину сцены, а не куцым 300px. Клиент 2026-07-17 (Safari): «картинка маленькая».
    // Клиент 2026-07-18: «форма максимально крупно» — потолок поднят 500→600 (исходник мокапа
    // 900px, при 600 CSS всё ещё даунскейл, значит резко). avail-26 не даёт вылезти за сцену.
    // Два раздельных вида (front≠back) остаются по 300px в ряд — там 300 оправдан.
    if (n === 1) {
      return Math.max(300, Math.min(avail - 26, 600));
    }
    const deskDW = n >= 3 ? 210 : 300;
    const rowNeed = n * (deskDW + chrome) + (n - 1) * gap;
    if (avail >= rowNeed) return deskDW; // десктоп: поведение не меняется
    if (n >= 2 && avail >= 2 * (240 + chrome) + gap) { // планшет: 2 в ряд
      return Math.max(150, Math.min(300, Math.floor((avail - gap) / 2) - chrome));
    }
    // Телефон: один холст на всю ширину. Клиент 2026-07-16 — «во весь экран без полей».
    // На мобиле обёртка .canvas-wrap без паддинга/бордера (см. stand.css @560), поэтому вычитаем
    // не 26 (десктопный chrome), а ~6 — холст растягивается почти до краёв экрана.
    return Math.max(150, Math.min(520, Math.round(avail - 6)));
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
        // keepCards: не пере-рендерим карточки опций при ресайзе. Иначе появление
        // полосы прокрутки (открыли «Шрифт и цвет» → страница выросла → скроллбар сузил
        // окно на ~15px → resize) стирало DOM карточки и мгновенно закрывало выпадашку
        // шрифта. Клиент 2026-07-16: «не могу выбрать шрифт, открывается и сразу закрывается».
        this.renderAll({ keepCards: true });
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

  // Монограмму бренда «JS» грузим один раз в HTMLImageElement, чтобы renderJetron ставил её
  // синхронно на грудь и шорты. Две версии: чёрная (на светлой ткани) и белая (на тёмной) —
  // renderJetron выбирает по яркости ткани под зоной. Нет файла → текстовый фолбэк «JS».
  async loadBranding() {
    const b = this.config.branding || {};
    const load = async (src) => {
      if (!src) return null;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = encodeURI(src);
      });
      return img;
    };
    try { this.brandingImg = await load(b.logo); } catch { /* нет знака — фолбэк на текст */ }
    try { this.brandingImgWhite = await load(b.logoInverse); } catch { /* нет белой версии — возьмём чёрную */ }
  }

  buildViews() {
    // Пересоздаём канвасы (модель могла смениться → появилось/пропало плечо).
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.viewsEl.innerHTML = '';

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
      view.onZoneClick((key) => this.selectZone(key));
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
        <button id="extra-toggle" class="extra-toggle" type="button" aria-expanded="${this.extraOpen ? 'true' : 'false'}">
          <span>Комплектация</span><span class="chev">▾</span>
        </button>
        <div id="extra-body" class="extra-body" ${this.extraOpen ? '' : 'hidden'}>
          <div class="extra-block">
            <span class="extra-label">Размерная категория</span>
            <div class="seg" id="age-seg">
              <button class="seg-btn active" data-age="adult">Взрослая · ${money(p.form.adult)}</button>
              <button class="seg-btn" data-age="child">Детская · ${money(p.form.child)}</button>
            </div>
          </div>
          <label class="extra-check"><input type="checkbox" id="opt-gaiters"> <span>Гетры <em>+${money(p.gaiters)}</em></span></label>
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

    // «Комплектация» — сворачиваемый блок (клиент 2026-07-15), чтобы «Итого» было выше.
    const extraToggle = this.panelEl.querySelector('#extra-toggle');
    const extraBody = this.panelEl.querySelector('#extra-body');
    extraToggle.onclick = () => {
      this.extraOpen = !this.extraOpen;
      extraBody.hidden = !this.extraOpen;
      extraToggle.setAttribute('aria-expanded', this.extraOpen ? 'true' : 'false');
    };

    // Размерная категория — сегмент-переключатель.
    this.panelEl.querySelectorAll('#age-seg .seg-btn').forEach((b) => {
      b.onclick = () => {
        this.ageCategory = b.dataset.age;
        this.panelEl.querySelectorAll('#age-seg .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
        this.updatePrice();
      };
    });
    this.panelEl.querySelector('#opt-gaiters').onchange = (e) => { this.gaiters = e.target.checked; this.updatePrice(); };

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
      const view = this.targetView(zone);
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
    const view = zone && this.targetView(zone);
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

  // Обновить кэш опции и синхронизировать макет.
  // Клиент 2026-07-16: любой ВВОД/ПРАВКА данных авто-включает тумблер ON — даже если раньше
  // его выключили вручную («после его отключения дальнейшее изменение происходило только вручную»).
  // Пустое поле (стёрли всё) — прячем с макета, состояние тумблера не трогаем.
  setOptData(opt, patch) {
    this.optCache[opt.id] = Object.assign({}, this.optCache[opt.id], patch);
    if (this.optionHasData(opt)) {
      this.optShown[opt.id] = true; // авто-ON при любом вводе данных
      this.applyOption(opt);
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

  // Модалки внутри iframe: position:fixed якорится ко ВСЕЙ высоте iframe, а не к видимой
  // области родительской страницы. На встроенном сайте (конструктор в iframe на странице
  // WooCommerce) окно уезжает за экран — клиент 2026-07-16: «таблица размеров сползает вниз».
  // Если мы в iframe того же origin — позиционируем оверлей абсолютно в текущую видимую
  // полосу iframe и держим её при прокрутке. Cross-origin/standalone — мягко остаёмся на fixed.
  _mountOverlay(overlay) {
    document.body.appendChild(overlay);
    try {
      if (window.self === window.top) return; // не встроено — обычный fixed из CSS
      const fe = window.frameElement;         // null или бросит при cross-origin
      if (!fe) return;
      const pv = window.parent;
      const card = overlay.querySelector('.order-card');
      // Высота липкой/фиксированной шапки родителя В ДАННЫЙ МОМЕНТ. Тема сайта прячет шапку
      // при прокрутке вниз и выезжает ей навстречу при прокрутке вверх — считаем динамически на
      // каждый скролл (клиент 2026-07-17: «верх таблицы заползает под шапку», «из корзины нет выхода»).
      const parentHeaderBottom = () => {
        try {
          const pd = pv.document;
          let b = 0;
          pd.querySelectorAll('header, #masthead, #wpadminbar, .sticky, [class*="header" i], [class*="sticky" i], [role="banner"]').forEach((el) => {
            const cs = pv.getComputedStyle(el);
            if (cs.position !== 'fixed' && cs.position !== 'sticky') return;
            const rr = el.getBoundingClientRect();
            // только то, что реально закрывает верх экрана прямо сейчас
            if (rr.top <= 2 && rr.height > 8 && rr.height < 250 && rr.width > (pv.innerWidth || 0) * 0.5) {
              b = Math.max(b, rr.bottom);
            }
          });
          return b;
        } catch { return 0; }
      };
      const reposition = () => {
        const r = fe.getBoundingClientRect();
        const vh = pv.innerHeight || document.documentElement.clientHeight;
        const hdr = parentHeaderBottom();
        const top = Math.max(0, hdr - r.top);                 // старт ниже шапки родителя
        const bottom = Math.min(fe.clientHeight, vh - r.top); // низ видимой полосы iframe
        const h = Math.max(0, bottom - top);
        if (h <= 0) return; // iframe полностью за экраном — не трогаем
        overlay.style.position = 'absolute';
        overlay.style.top = top + 'px';
        overlay.style.left = '0';
        overlay.style.right = '0';
        overlay.style.bottom = 'auto';
        overlay.style.height = h + 'px';
        overlay.style.overflow = 'hidden';   // модалка не вылезает за видимую полосу
        overlay.style.alignItems = 'center';
        // карточка скроллится ВНУТРИ полосы → липкие шапка (с крестиком) и подвал всегда видны
        if (card) card.style.maxHeight = h + 'px';
      };
      reposition();
      const onMove = () => reposition();
      pv.addEventListener('scroll', onMove, { passive: true });
      pv.addEventListener('resize', onMove, { passive: true });
      const origRemove = overlay.remove.bind(overlay);
      overlay.remove = () => {
        pv.removeEventListener('scroll', onMove);
        pv.removeEventListener('resize', onMove);
        origRemove();
      };
    } catch { /* cross-origin — остаёмся на fixed, деградация мягкая */ }
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
    this._mountOverlay(overlay);

    const close = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) close(); };

    // Размер выбирается кликом по строке (клиент 2026-07-15: «размеры не могу выбрать»).
    const sizeTable = (cat) => {
      const grid = this.config.sizes?.[cat];
      if (!grid) return '';
      return `<table class="order-items size-select">
        <thead><tr><th aria-label="Выбор"></th>${grid.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
        <tbody>${grid.rows.map((row) => {
          const sz = String(row[0]);
          const on = this.size === sz;
          return `<tr class="size-row${on ? ' sel' : ''}" data-size="${escapeHtml(sz)}">
            <td class="pick"><input type="radio" name="ord-size" value="${escapeHtml(sz)}" ${on ? 'checked' : ''}></td>
            ${row.map((cell) => `<td>${escapeHtml(String(cell))}</td>`).join('')}
          </tr>`;
        }).join('')}</tbody>
      </table>
      <p class="size-hint">${this.size ? `Выбран размер: <b>${escapeHtml(this.size)}</b>` : 'Выберите размер из таблицы выше'}</p>`;
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
            <div class="pline"><span>Размер</span><span>${this.size ? escapeHtml(this.size) : '—'}</span></div>
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
          this.size = ''; // размерные ряды детской/взрослой различаются — сбрасываем выбор
          this.syncPanelControls();
          this.updatePrice();
          render();
        };
      });
      // Выбор конкретного размера — клик по строке или радиокнопке.
      card.querySelectorAll('.size-row').forEach((tr) => {
        tr.onclick = () => {
          this.size = tr.dataset.size;
          render();
        };
      });
      card.querySelector('#ord-gaiters').onchange = (e) => {
        this.gaiters = e.target.checked;
        this.syncPanelControls();
        this.updatePrice();
        render();
      };
      card.querySelector('#order-confirm').onclick = async () => {
        const foot = card.querySelector('.order-foot');
        const btn = card.querySelector('#order-confirm');
        if (!this.size) {
          // Клиент 2026-07-15: размер обязателен, но раньше его нельзя было выбрать.
          const hint = card.querySelector('.size-hint');
          if (hint) {
            hint.classList.add('need');
            hint.innerHTML = 'Пожалуйста, выберите размер из таблицы';
            hint.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          return;
        }
        const woo = this.config.woo || await this._wooConfig();
        if (!woo || !woo.productId) {
          // Standalone/preview без WooCommerce: показываем что заказ собран.
          foot.innerHTML = `<p class="hint" style="margin:0">Заказ собран: макет, файлы и надписи готовы к передаче.</p>`;
          return;
        }
        btn.disabled = true;
        btn.textContent = 'Добавляем…';
        try {
          const png = await this.mockupDataURL('image/jpeg', 0.85);
          const spec = this._specText(this.lastOrder);
          const base = String(woo.siteUrl || '').replace(/\/$/, '');
          const form = document.createElement('form');
          form.method = 'POST';
          form.action = `${base}/?add-to-cart=${encodeURIComponent(woo.productId)}`;
          form.target = '_top';
          form.style.display = 'none';
          const add = (n, v) => { const i = document.createElement('input'); i.type = 'hidden'; i.name = n; i.value = v; form.appendChild(i); };
          add('quantity', String(this.lastOrder.quantity || 1));
          add('jetron_spec', spec);
          add('jetron_size', this.size);
          add('jetron_total', String(this.lastOrder.price.grandTotal));
          if (png) add('jetron_png', png);
          document.body.appendChild(form);
          form.submit();
        } catch (e) {
          btn.disabled = false;
          btn.textContent = 'В корзину';
          foot.insertAdjacentHTML('beforeend', `<p class="hint" style="color:#c0392b;margin:6px 0 0">Не удалось добавить в корзину: ${escapeHtml(e.message)}. Попробуйте ещё раз.</p>`);
        }
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
    this._mountOverlay(overlay);
    const close = () => overlay.remove();
    overlay.querySelectorAll('.order-close').forEach((b) => { b.onclick = close; });
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
  }

  // Собрать все виды (перёд/спина/плечо) в один canvas без служебных рамок.
  async _composeMockupCanvas() {
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
    if (!imgs.length) return null;

    const gap = 24;
    const pad = 24;
    // Композит — один холст, подпись не нужна (клиент 2026-07-12); при двух видах подписываем.
    const labelH = imgs.length > 1 ? 34 : 0;
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
      if (labelH) ctx.fillText(VIEW_LABEL[e.name] || e.name, x + e.img.width / 2, pad + 24);
      ctx.drawImage(e.img, x, pad + labelH);
      x += e.img.width + gap;
    }
    return c;
  }

  // Скачать макет одним PNG.
  async downloadImage() {
    const c = await this._composeMockupCanvas();
    if (!c) return;
    const a = document.createElement('a');
    a.download = `jetron-${this.formId}.png`;
    a.href = c.toDataURL('image/png');
    a.click();
  }

  // Макет как data-URL для передачи в корзину WooCommerce (JPEG компактнее, фон уже белый).
  async mockupDataURL(type = 'image/jpeg', quality = 0.85) {
    const c = await this._composeMockupCanvas();
    return c ? c.toDataURL(type, quality) : '';
  }

  // Человекочитаемая спецификация заказа для менеджера (прикладывается к позиции корзины/заказа).
  _specText(o) {
    if (!o) return '';
    const money = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' \u20bd';
    const age = o.ageCategory === 'child' ? 'Детская' : 'Взрослая';
    const L = [];
    L.push(`Модель: ${o.formName} (цвет: ${o.color})`);
    L.push(`Размерная категория: ${age}`);
    if (this.size) L.push(`Размер: ${this.size}`);
    L.push(`Комплектов: ${o.quantity}`);
    if (o.items && o.items.length) {
      L.push('Нанесения:');
      for (const it of o.items) {
        const val = it.type === 'text' ? `«${it.text}»` : 'логотип/изображение';
        L.push(`  - ${it.label}: ${val}`);
      }
    } else {
      L.push('Нанесения: нет');
    }
    L.push(`Гетры: ${o.gaiters ? 'да' : 'нет'}`);
    L.push('Логотип Jetron: грудь + шорты (стандартно)');
    const p = o.price;
    const parts = [`форма ${money(p.formPrice)}`];
    if (p.placementTotal) parts.push(`нанесение ${money(p.placementTotal)}`);
    if (p.gaitersPrice) parts.push(`гетры ${money(p.gaitersPrice)}`);
    if (p.discountPct) parts.push(`скидка -${Math.round(p.discountPct * 100)}%`);
    L.push(`Расчёт конструктора: ${parts.join(', ')}; за комплект ${money(p.perKit)}; ИТОГО ${money(p.grandTotal)}`);
    return L.join('\n');
  }

  // Конфиг WooCommerce отдаётся статикой woo.json (пишется mu-плагином) — минуя антибот.
  async _wooConfig() {
    if (this._woo !== undefined) return this._woo;
    try {
      const r = await fetch('woo.json', { cache: 'no-store' });
      this._woo = r.ok ? await r.json() : null;
    } catch {
      this._woo = null;
    }
    return this._woo;
  }

  async renderAll({ keepCards = false } = {}) {
    const composite = this._isComposite();
    // Показываем рамку только у зон, для которых есть доступная опция нанесения.
    // Так на макете нет «пустых» рамок под ещё не реализованные зоны (фамилия/номер — см. docs).
    const optPkeys = new Set();
    for (const o of this.availableOptions()) for (const pk of this.optionPkeys(o)) optPkeys.add(pk);
    const usable = (z) => optPkeys.has(`${z.view}:${z.key}`);
    for (const [viewName, view] of this.views) {
      const img = this.form.images[viewName];
      // Плечо (и любой вид без мокапа) — нейтральный холст: лого показывается отдельной картинкой (ТЗ §9.3).
      if (img) await view.setBackground(encodeURI(img), this.formCrop);
      else view.setNeutral();
      // Композит: единственный холст владеет ВСЕМИ зонами; иначе — только зонами своего вида.
      const zones = (composite ? this.formZones : this.zonesFor(viewName)).filter(usable);
      view.renderZones(zones);
      // восстановить размещения из состояния (ключ размещения — всегда `${zone.view}:${zone.key}`)
      for (const zone of zones) {
        const p = this.placements[`${zone.view}:${zone.key}`];
        if (!p) continue;
        if (p.type === 'text') view.placeText(zone, p.value, this.resolveFont(p.fontId, p.value), p.color);
        else if (p.type === 'image') await view.placeImage(zone, p.value);
      }
    }
    this.renderJetron();
    this._renderLineBadge();
    if (!keepCards) this.renderOptionCards();
    this.updatePrice();
    // Хук для редактора зон (?zones=edit): после каждой перерисовки заново
    // делает пунктирные рамки перетаскиваемыми. В обычном режиме не установлен.
    if (this._afterRender) this._afterRender();
  }

  // Брендинг Джетрон (ТЗ §5, логотип подтверждён клиентом 2026-07-14): картинка «JETRON.RU»
  // на груди и такая же под номером на спине — файл jetron-logo.png (config.branding.logo).
  // Нет картинки → текстовый фолбэк. Рисуется только визуально; скидка −5%/−5% считается
  // в calculatePrice независимо от отрисовки.
  renderJetron() {
    // Штатный фирменный знак Jetron (клиент 2026-07-22): монограмма «JS» ВСЕГДА на груди справа
    // и на шортах слева — это часть бренда, не опция и не скидка. На спине логотипа нет.
    // Клиент 2026-07-22: знак больше не прячется, когда покупатель наносит текст на грудь, и его
    // можно сдвинуть в редакторе зон (позиция сохраняется под ключом chest_brand/shorts_brand).
    for (const v of this.views.values()) v.clearStatic();

    this._placeBrand('chest_logo_large', 'chest_brand'); // грудь справа
    this._placeBrand('shorts_number', 'shorts_brand');   // шорты слева
    this._placeShortsNumber();                           // дубль номера со спины на шортах (белым)
    this._placeShortsLogo();                             // дубль клубного лого с груди слева на шортах
  }

  // Ставит бренд-монограмму. Бокс: сохранённая админом позиция (zoneOverrides[form][brandKey]) либо
  // по умолчанию центрирован на зоне-якоре. Цвет знака выбираем по яркости ткани под зоной: тёмная
  // ткань → белая монограмма, светлая → чёрная (иначе «JS» на чёрных шортах сливается). Картинку
  // помечаем brandKey и регистрируем в view.brandObjects — редактор зон делает её перетаскиваемой.
  _placeBrand(anchorKey, brandKey) {
    const zone = this.formZones.find((z) => z.key === anchorKey);
    const view = zone && this.targetView(zone);
    if (!zone || !view) return;
    const box = resolveBrandBox(this.config.zoneOverrides, this.formId, brandKey, zone.box);
    const lum = view.bgLuminanceAt(box);
    const dark = lum != null && lum < 128;
    const logo = dark ? (this.brandingImgWhite || this.brandingImg) : this.brandingImg;
    // clip:false — бренд подгоняется в бокс точно, а в редакторе его двигают за пределы исходного
    // бокса; фиксированный clipPath обрезал бы сдвинутый знак. Покупателю знак неподвижен (evented:false).
    const obj = logo
      ? view.placeStaticImage(box, logo, { clip: false })
      : view.placeStaticText(box, 'JS', dark ? '#ffffff' : '#111111');
    obj.brandKey = brandKey;
    if (!view.brandObjects) view.brandObjects = new Map();
    view.brandObjects.set(brandKey, obj);
  }

  // Дубль номера со спины на шортах (клиент 2026-07-23): «номер на шортах включён в стоимость».
  // Контент зеркалит покупательский back_number, цвет ВСЕГДА белый (белых шорт нет). Позицию
  // админ двигает в редакторе — храним под собственным ключом shorts_number_dup (как бренд),
  // отдельным от полосок shorts_brand. Нет номера у покупателя → на шортах пусто.
  _placeShortsNumber() {
    const p = this.placements['back:back_number'];
    const value = p && p.value;
    if (!value) return;
    const zone = this.formZones.find((z) => z.key === 'shorts_number');
    const view = zone && this.targetView(zone);
    if (!zone || !view) return;
    const box = resolveBrandBox(this.config.zoneOverrides, this.formId, 'shorts_number_dup', zone.box);
    const font = this.resolveFont(p.fontId, value);
    const obj = view.placeStaticNumber(box, value, '#ffffff', font);
    obj.brandKey = 'shorts_number_dup';
    if (!view.brandObjects) view.brandObjects = new Map();
    view.brandObjects.set('shorts_number_dup', obj);
  }

  // Дубль клубного логотипа на шортах (клиент 2026-07-23): «логотип на шортах включён в стоимость».
  // Зеркалит уже отрисованный на холсте логотип с груди слева (chest_logo_small) — берём его
  // загруженный HTMLImageElement, чтобы не грузить картинку повторно. Позицию админ двигает в
  // редакторе (ключ shorts_logo_dup, как бренд). Нет лого у покупателя → на шортах пусто.
  _placeShortsLogo() {
    const zone = this.formZones.find((z) => z.key === 'shorts_logo');
    const view = zone && this.targetView(zone);
    if (!zone || !view) return;
    const src = view.userObjects && view.userObjects.get('chest_logo_small');
    if (!src) return;
    const imgEl = src.getElement ? src.getElement() : src._element;
    if (!imgEl || !imgEl.complete || !imgEl.naturalWidth) return; // ещё грузится — покажем на следующем рендере
    const box = resolveBrandBox(this.config.zoneOverrides, this.formId, 'shorts_logo_dup', zone.box);
    const obj = view.placeStaticImage(box, imgEl, { clip: false });
    obj.brandKey = 'shorts_logo_dup';
    if (!view.brandObjects) view.brandObjects = new Map();
    view.brandObjects.set('shorts_logo_dup', obj);
  }

  // URL каталога с фильтром по линейке формы (клиент 2026-07-22: клик по плашке линейки
  // ведёт в каталог, отфильтрованный по этой линейке). Слаги в config.catalog.lineSlugs;
  // если линейки там нет — берём название в нижнем регистре.
  _lineCatalogUrl() {
    const c = this.config.catalog || {};
    const line = (this.form && this.form.line) || '';
    const slug = (c.lineSlugs && c.lineSlugs[line]) || line.toLowerCase();
    return (c.base || '/shop/') + slug + (c.suffix || '');
  }

  // Плашка линейки слева вверху над макетом (клиент 2026-07-22): показывает название линейки
  // текущей формы (Champion, Legend, …) — информативно, и по клику ведёт в каталог с фильтром
  // по этой линейке. Позиционируем абсолютно в левом верхнем углу #stage.
  _renderLineBadge() {
    if (typeof document === 'undefined') return;
    // Плашка — часть потока внутри #views (flex-basis:100% в CSS делает её отдельной строкой
    // над холстами, align-self:flex-start прижимает влево). Раньше JS форсил position:absolute
    // и вешал на #stage — плашка «улетала» над полем (клиент 2026-07-22). Теперь кладём первым
    // ребёнком #views и не трогаем позиционирование — раскладку держит CSS.
    const host = this.viewsEl;
    const line = this.form && this.form.line;
    if (!host) return;
    let badge = host.querySelector('.line-badge');
    if (!line) { if (badge) badge.remove(); return; }
    if (!badge) {
      badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'line-badge';
      badge.style.cursor = 'pointer';
      badge.onclick = () => this._goToLineCatalog();
    }
    // Всегда держим плашку первой в потоке (renderAll мог перерисовать холсты после неё).
    if (host.firstChild !== badge) host.insertBefore(badge, host.firstChild);
    // Клиент 2026-07-23: компактная кнопка по размеру текста (чёрный шрифт, в рамке), не широкая
    // полоса. Внешний .line-badge — прозрачная строка (держит перенос над холстами), pill — сама кнопка.
    badge.innerHTML = `<span class="line-badge-pill">${escapeHtml(line)} →</span>`;
  }

  // Переход в каталог по линейке. Как и выход из конструктора: правим верхнее окно, если
  // встроены в страницу товара same-origin; иначе — текущее окно.
  _goToLineCatalog() {
    const target = this._lineCatalogUrl();
    try {
      if (window.top && window.top !== window.self) {
        window.top.location.href = target;
        return;
      }
    } catch { /* кросс-домен: уводим текущее окно */ }
    window.location.href = target;
  }

  // Клик по зоне на макете открывает соответствующую карточку опции (аккордеон).
  // Ключи зон уникальны между видами, поэтому вид определяем по самой зоне (работает и на композите).
  selectZone(key) {
    const zone = this.formZones.find((z) => z.key === key);
    if (!zone) return;
    const pkey = `${zone.view}:${zone.key}`;
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
      <div class="opt-upload-row">
        <label class="opt-upload ${has ? 'has' : ''}">
          <input type="file" accept="image/*" data-field="image" hidden>
          <span class="opt-upload-icon">${has ? '✓' : '+'}</span>
          <span class="opt-upload-text">${has ? 'Файл загружен' : label}</span>
          ${has ? '<span class="opt-del" data-act="del" role="button" aria-label="Удалить" title="Удалить">×</span>' : ''}
        </label>
        <button type="button" class="opt-rmbg ${has ? '' : 'is-idle'}" data-act="rmbg" title="Убрать однотонный фон логотипа">
          <span class="opt-rmbg-icon" aria-hidden="true">${WAND_SVG}</span>
          <span class="opt-rmbg-text">Удалить фон</span>
        </button>
      </div>
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
    // Клиент 2026-07-16 «не могу выбрать шрифт»: латинские шрифты не держат кириллицу,
    // при русском тексте отрисовка молча падала на РПЛ (кнопка «выбиралась», превью не менялось).
    // Блокируем такие шрифты с понятной подсказкой — видно, почему выбрать нельзя.
    const userCyr = this.hasCyrillic([c.name, c.number, c.text].filter(Boolean).join(' '));
    return `
      <details class="opt-font" ${c.fontId || c.color ? 'open' : ''}>
        <summary>Шрифт и цвет</summary>
        <div class="font-list" role="listbox" aria-label="Шрифт">
          ${fonts.map((f) => `<button type="button" class="font-opt ${f.id === curFont ? 'active' : ''}${userCyr && !f.cyrillic ? ' locked' : ''}"
             data-font="${f.id}" role="option" aria-selected="${f.id === curFont}" aria-disabled="${userCyr && !f.cyrillic}" title="${userCyr && !f.cyrillic ? 'Шрифт без кириллицы — выберите шрифт с русскими буквами' : escapeHtml(f.name)}">
             <span class="font-opt-sample" style="font-family:'${f.id}', sans-serif">${escapeHtml(this.fontSampleText(f, c))}</span>
             <span class="font-opt-name">${escapeHtml(f.name)}${f.cyrillic ? '' : ' · лат.'}</span>
          </button>`).join('')}
        </div>
        <div class="swatches color-row">
          ${colors.map((col) => `<button class="color-sw ${col.hex === curColor ? 'active' : ''}" data-color="${col.hex}" title="${escapeHtml(col.name)}" style="background:${col.hex}"></button>`).join('')}
        </div>
      </details>`;
  }

  // Пересчитать блокировку латинских шрифтов при вводе русского текста (без пере-рендера
  // карточки, чтобы не терять фокус в поле). Клиент 2026-07-16 «не могу выбрать шрифт».
  updateFontLocks(card, opt) {
    const c = this.optCache[opt.id] || {};
    const cyr = this.hasCyrillic([c.name, c.number, c.text].filter(Boolean).join(' '));
    card.querySelectorAll('.font-opt').forEach((b) => {
      const f = this.fontById(b.dataset.font);
      const locked = cyr && f && !f.cyrillic;
      b.classList.toggle('locked', locked);
      b.setAttribute('aria-disabled', String(locked));
      b.title = locked ? 'Шрифт без кириллицы — выберите шрифт с русскими буквами' : (f ? f.name : '');
    });
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
        this.updateFontLocks(card, opt); // русский текст → запереть латинские шрифты
      };
    });

    // Шрифт: список превью, каждый образец нарисован своим шрифтом.
    body.querySelectorAll('.font-opt').forEach((b) => {
      b.onclick = () => {
        if (b.classList.contains('locked')) return; // латинский шрифт при русском тексте — нельзя
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

    // «Удалить фон» — убирает однотонную подложку логотипа (частый случай: лого на белом квадрате).
    const rmbg = body.querySelector('[data-act="rmbg"]');
    if (rmbg) rmbg.onclick = async (e) => {
      e.preventDefault(); e.stopPropagation();
      const note = body.querySelector('[data-role="note"]');
      const c = this.optCache[opt.id] || {};
      if (!c.image) {
        if (note) { note.textContent = 'Сначала загрузите логотип, затем уберём фон.'; note.hidden = false; }
        return;
      }
      if (rmbg.classList.contains('busy')) return;
      rmbg.classList.add('busy');
      const prev = rmbg.querySelector('.opt-rmbg-text').textContent;
      rmbg.querySelector('.opt-rmbg-text').textContent = 'Убираем…';
      try {
        const out = await this.removeBackground(c.image);
        this.setOptData(opt, { image: out });
        this.renderOptionCards();
      } catch (err) {
        if (note) { note.textContent = 'Не получилось убрать фон у этого изображения.'; note.hidden = false; }
        rmbg.classList.remove('busy');
        rmbg.querySelector('.opt-rmbg-text').textContent = prev;
      }
    };
  }

  // Убирает однотонный фон логотипа: заливка от краёв по похожему цвету → прозрачность (PNG с альфой).
  // Лёгкий, без внешних библиотек и сервера — работает офлайн и на телефоне. Рассчитан на лого
  // на сплошной подложке (белый/цветной квадрат); сложные фото-фоны не трогает точечно.
  removeBackground(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const w = img.naturalWidth, h = img.naturalHeight;
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          const ctx = cv.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const imgData = ctx.getImageData(0, 0, w, h);
          const px = imgData.data;
          // Опорный цвет фона = среднее по четырём углам.
          const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
          let br = 0, bg = 0, bb = 0;
          for (const [x, y] of corners) { const i = (y * w + x) * 4; br += px[i]; bg += px[i + 1]; bb += px[i + 2]; }
          br /= 4; bg /= 4; bb /= 4;
          const tol = 42;               // допуск по цвету
          const tol2 = tol * tol * 3;
          const visited = new Uint8Array(w * h);
          const stack = [];
          const tryPush = (x, y) => {
            if (x < 0 || y < 0 || x >= w || y >= h) return;
            const p = y * w + x;
            if (visited[p]) return;
            visited[p] = 1;
            const i = p * 4;
            const dr = px[i] - br, dg = px[i + 1] - bg, db = px[i + 2] - bb;
            if (dr * dr + dg * dg + db * db <= tol2) { px[i + 3] = 0; stack.push(p); }
          };
          for (let x = 0; x < w; x++) { tryPush(x, 0); tryPush(x, h - 1); }
          for (let y = 0; y < h; y++) { tryPush(0, y); tryPush(w - 1, y); }
          while (stack.length) {
            const p = stack.pop();
            const x = p % w, y = (p - x) / w;
            tryPush(x - 1, y); tryPush(x + 1, y); tryPush(x, y - 1); tryPush(x, y + 1);
          }
          ctx.putImageData(imgData, 0, 0);
          resolve(cv.toDataURL('image/png'));
        } catch (err) { reject(err); }
      };
      img.onerror = () => reject(new Error('image load failed'));
      img.src = src;
    });
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
