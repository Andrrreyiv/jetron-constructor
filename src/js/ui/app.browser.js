// Оркестратор стенда: конфиг → канвас → панель управления → живая цена.
// Браузерный слой (.browser.js, вне node:test). Источник правды о размещениях — this.edit
// (чистая модель EditHistory: undo + перенос между зонами). Канвас лишь отображает.
// Цена считается тестируемой calculatePrice из core/.
import { CanvasView } from './canvas.browser.js';
import { calculatePrice } from '../core/PriceCalculator.js';
import { buildOrder } from '../core/OrderSummary.js';
import { createState, setPlacement, removePlacement, movePlacement, undo, canUndo } from '../core/EditHistory.js';

const money = (n) => `${n.toLocaleString('ru-RU')} ₽`;
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const VIEW_LABEL = { front: 'Перёд', back: 'Спина', shoulder: 'Плечо' };

export class UniformApp {
  constructor({ config, viewsEl, panelEl }) {
    this.config = config;
    this.viewsEl = viewsEl;
    this.panelEl = panelEl;

    // Перёд и спина показываются одновременно (ТЗ 2.2): по одному CanvasView на вид.
    this.views = new Map(); // viewName -> CanvasView
    this.formId = config.forms[0].id;
    this.ageCategory = 'adult';
    this.gaiters = false;
    this.quantity = 1;
    this.jetron = { chest: false, back: false };
    // Размещения живут в чистой модели истории: ключ `${view}:${zoneKey}` → {type,value,fontId,color}.
    this.edit = createState();
    this.textColor = (config.textColors && config.textColors[0]) ? config.textColors[0].hex : '#ffffff';
    this.selected = null; // { view, key } выбранной зоны
    this.anyMode = {}; // pkey → 'text'|'image' — выбор режима для зон type:'any' (ТЗ 2026-07-10, C13)
  }

  get form() {
    return this.config.forms.find((f) => f.id === this.formId);
  }

  get placements() {
    return this.edit.placements;
  }

  zonesFor(view) {
    return this.form.zones.filter((z) => z.view === view);
  }

  // Виды к показу: перёд и спина всегда, плечо — если у модели есть зона плеча (ТЗ §9.3, C10).
  // Плечо показывается отдельной картинкой сбоку, а не на теле формы, поэтому у него нет фон-мокапа.
  viewList() {
    const views = [
      { id: 'front', label: 'Перёд' },
      { id: 'back', label: 'Спина' }
    ];
    if (this.form.zones.some((z) => z.view === 'shoulder')) views.push({ id: 'shoulder', label: 'Плечо' });
    return views;
  }

  async start() {
    await this.loadFonts();
    this.buildPanel();
    this.buildViews();
    await this.renderAll();
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
    const displayWidth = list.length >= 3 ? 210 : 300;

    for (const v of list) {
      const col = document.createElement('div');
      col.className = 'canvas-col';
      const label = document.createElement('div');
      label.className = 'canvas-label';
      label.textContent = v.label;
      const wrap = document.createElement('div');
      wrap.className = 'canvas-wrap';
      const canvasEl = document.createElement('canvas');
      wrap.appendChild(canvasEl);
      col.appendChild(label);
      col.appendChild(wrap);
      this.viewsEl.appendChild(col);

      const view = new CanvasView(canvasEl, { ...base, displayWidth });
      view.onChange = () => this.updatePrice();
      view.onZoneClick((key) => this.selectZone(v.id, key));
      this.views.set(v.id, view);
    }
  }

  buildPanel() {
    const forms = this.config.forms;
    this.panelEl.innerHTML = `
      <section>
        <h3>Модель и цвет</h3>
        <div class="swatches">
          ${forms.map((f) => `<button class="swatch ${f.id === this.formId ? 'active' : ''}"
             data-form="${f.id}" title="${f.name}"
             style="background:${f.colorHex || '#ccc'}"></button>`).join('')}
        </div>
      </section>
      <section>
        <h3>Размерная категория</h3>
        <label><input type="radio" name="age" value="adult" checked> Взрослая (${money(this.config.prices.form.adult)})</label>
        <label><input type="radio" name="age" value="child"> Детская (${money(this.config.prices.form.child)})</label>
      </section>
      <section>
        <h3>Опции</h3>
        <label><input type="checkbox" id="opt-gaiters"> Гетры (+${money(this.config.prices.gaiters)})</label>
        <label><input type="checkbox" id="opt-jchest"> Джетрон на груди (−5%)</label>
        <label><input type="checkbox" id="opt-jback"> Джетрон на спине (−5%)</label>
        <label>Комплектов: <input type="number" id="opt-qty" min="1" value="1" style="width:64px"></label>
      </section>
      <section id="zone-tool">
        <h3>Зона</h3>
        <p class="hint">Кликните пунктирную зону на макете, чтобы добавить текст или логотип.</p>
      </section>
      <section>
        <h3>Действия</h3>
        <div class="row">
          <button id="undo-btn" class="ghost" disabled>↶ Отменить</button>
          <button id="size-btn" class="ghost">Размеры</button>
          <button id="download-btn" class="ghost">Скачать макет</button>
        </div>
      </section>
      <section id="price-box">
        <h3>Стоимость</h3>
        <div id="price-lines"></div>
        <div id="price-total"></div>
        <button id="order-btn" style="width:100%;margin-top:12px">Оформить заказ</button>
      </section>
    `;

    this.panelEl.querySelectorAll('.swatch').forEach((b) => {
      b.onclick = async () => {
        this.formId = b.dataset.form;
        this.selected = null;
        this.buildPanel();
        this.buildViews();
        await this.renderAll();
      };
    });
    this.panelEl.querySelectorAll('input[name="age"]').forEach((r) => {
      r.onchange = () => { this.ageCategory = r.value; this.updatePrice(); };
    });
    this.panelEl.querySelector('#opt-gaiters').onchange = (e) => { this.gaiters = e.target.checked; this.updatePrice(); };
    this.panelEl.querySelector('#opt-jchest').onchange = (e) => { this.jetron.chest = e.target.checked; this.renderJetron(); this.updatePrice(); };
    this.panelEl.querySelector('#opt-jback').onchange = (e) => { this.jetron.back = e.target.checked; this.renderJetron(); this.updatePrice(); };
    this.panelEl.querySelector('#opt-qty').onchange = (e) => { this.quantity = Math.max(1, +e.target.value || 1); this.updatePrice(); };
    this.panelEl.querySelector('#order-btn').onclick = () => this.showOrder();
    this.panelEl.querySelector('#undo-btn').onclick = () => this.doUndo();
    this.panelEl.querySelector('#size-btn').onclick = () => this.showSizes();
    this.panelEl.querySelector('#download-btn').onclick = () => this.downloadImage();
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
    const age = this.panelEl.querySelector(`input[name="age"][value="${this.ageCategory}"]`);
    if (age) age.checked = true;
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
        if (p.type === 'text') view.placeText(zone, p.value, p.fontId, p.color);
        else if (p.type === 'image') await view.placeImage(zone, p.value);
      }
    }
    this.renderJetron();
    this.renderZoneTool();
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

  selectZone(view, key) {
    this.selected = { view, key };
    this.renderZoneTool();
  }

  doUndo() {
    if (!canUndo(this.edit)) return;
    this.edit = undo(this.edit);
    this.selected = null;
    this.renderAll();
  }

  // Зоны-кандидаты для переноса нанесения: того же типа, ещё свободные, кроме текущей.
  moveTargets(zone, currentPkey) {
    return this.form.zones
      .filter((z) => z.type === zone.type)
      .map((z) => ({ z, pkey: `${z.view}:${z.key}` }))
      .filter(({ pkey }) => pkey !== currentPkey && !(pkey in this.placements));
  }

  renderZoneTool() {
    const box = this.panelEl.querySelector('#zone-tool');
    const sel = this.selected;
    const zone = sel ? this.zonesFor(sel.view).find((z) => z.key === sel.key) : null;
    if (!zone) {
      box.innerHTML = `<h3>Зона</h3><p class="hint">Кликните пунктирную зону на макете, чтобы добавить текст или логотип.</p>`;
      return;
    }
    const priceLabel = zone.price ? `+${money(zone.price)}` : (zone.included ? 'входит в комплект' : 'бесплатно');
    const fonts = this.config.fonts || [];
    const colors = this.config.textColors || [];
    const view = this.views.get(sel.view);
    const pkey = `${sel.view}:${zone.key}`;
    const existing = this.placements[pkey];
    if (existing && existing.color) this.textColor = existing.color;

    const moveBlock = existing
      ? (() => {
          const targets = this.moveTargets(zone, pkey);
          if (!targets.length) return '';
          return `<label>Перенести в
            <select id="z-move">
              <option value="">— выберите зону —</option>
              ${targets.map(({ z, pkey: tk }) => `<option value="${tk}">${VIEW_LABEL[z.view] || z.view}: ${z.label}</option>`).join('')}
            </select>
          </label>`;
        })()
      : '';

    // Зона type:'any' (ТЗ 2026-07-10, C13) — человек сам решает: текст ИЛИ логотип.
    // Режим берём из уже нанесённого → из его выбора переключателем → по умолчанию текст.
    const isAny = zone.type === 'any';
    const mode = isAny ? ((existing && existing.type) || this.anyMode[pkey] || 'text') : zone.type;
    const toggleBlock = isAny
      ? `<div class="seg" id="z-mode">
          <button class="seg-btn ${mode === 'text' ? 'active' : ''}" data-mode="text">Текст</button>
          <button class="seg-btn ${mode === 'image' ? 'active' : ''}" data-mode="image">Логотип</button>
        </div>`
      : '';

    if (mode === 'text') {
      const colorSwatches = colors.map((c) => `<button class="color-sw ${c.hex === this.textColor ? 'active' : ''}"
        data-color="${c.hex}" title="${c.name}" style="background:${c.hex}"></button>`).join('');
      box.innerHTML = `
        <h3>${zone.label} <small>${priceLabel}</small></h3>
        ${toggleBlock}
        <input type="text" id="z-text" placeholder="Текст" value="${existing && existing.type === 'text' ? escapeHtml(existing.value) : ''}">
        <label>Шрифт
          <select id="z-font">
            ${fonts.map((f) => `<option value="${f.id}" ${existing && existing.fontId === f.id ? 'selected' : ''}>${f.name}${f.cyrillic ? ' (кириллица)' : ''}</option>`).join('')}
          </select>
        </label>
        <label>Цвет шрифта</label>
        <div class="swatches color-row">${colorSwatches}</div>
        ${moveBlock}
        <div class="row">
          <button id="z-apply">${existing ? 'Обновить' : 'Добавить'}</button>
          <button id="z-remove" class="ghost">Убрать</button>
        </div>`;
      const apply = () => {
        const text = box.querySelector('#z-text').value.trim();
        const fontId = box.querySelector('#z-font').value;
        if (!text) return;
        this.edit = setPlacement(this.edit, pkey, { type: 'text', value: text, fontId, color: this.textColor });
        view.placeText(zone, text, fontId, this.textColor);
        this.renderJetron();
        this.updatePrice();
      };
      box.querySelectorAll('.color-sw').forEach((b) => {
        b.onclick = () => {
          this.textColor = b.dataset.color;
          box.querySelectorAll('.color-sw').forEach((x) => x.classList.remove('active'));
          b.classList.add('active');
          if (this.placements[pkey]) apply(); // живой предпросмотр для уже нанесённого текста
        };
      });
      box.querySelector('#z-apply').onclick = apply;
      box.querySelector('#z-text').onkeydown = (e) => { if (e.key === 'Enter') apply(); };
    } else {
      box.innerHTML = `
        <h3>${zone.label} <small>${priceLabel}</small></h3>
        ${toggleBlock}
        <input type="file" id="z-file" accept="image/*">
        ${moveBlock}
        <div class="row"><button id="z-remove" class="ghost">Убрать</button></div>`;
      box.querySelector('#z-file').onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        this.edit = setPlacement(this.edit, pkey, { type: 'image', value: url });
        view.placeImage(zone, url);
        this.renderJetron();
        this.updatePrice();
      };
    }

    // Переключатель текст/логотип для 'any'-зоны: запоминаем выбор и перерисовываем инструмент.
    const modeSeg = box.querySelector('#z-mode');
    if (modeSeg) {
      modeSeg.querySelectorAll('.seg-btn').forEach((b) => {
        b.onclick = () => {
          this.anyMode[pkey] = b.dataset.mode;
          this.renderZoneTool();
        };
      });
    }

    const moveSel = box.querySelector('#z-move');
    if (moveSel) {
      moveSel.onchange = () => {
        const target = moveSel.value;
        if (!target) return;
        this.edit = movePlacement(this.edit, pkey, target);
        const [tv, ...trest] = target.split(':');
        this.selected = { view: tv, key: trest.join(':') };
        this.renderAll();
      };
    }
    box.querySelector('#z-remove').onclick = () => {
      this.edit = removePlacement(this.edit, pkey);
      view.removeFromZone(zone.key);
      this.renderJetron();
      this.updatePrice();
    };
  }

  // Собираем занятые зоны по всем видам (перёд+спина+плечо) → цена за весь комплект.
  usedZones() {
    const byKey = new Map(this.form.zones.map((z) => [z.key, z]));
    const out = [];
    for (const composite of Object.keys(this.placements)) {
      const key = composite.split(':').slice(1).join(':');
      const z = byKey.get(key);
      if (z) out.push({ key, priceGroup: z.priceGroup || z.key, price: z.price || 0 });
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
    linesEl.innerHTML = lines.map(([k, v]) => `<div class="pline"><span>${k}</span><span>${money(v)}</span></div>`).join('');
    if (r.discountPct > 0) {
      linesEl.innerHTML += `<div class="pline discount"><span>Скидка Джетрон</span><span>−${Math.round(r.discountPct * 100)}%</span></div>`;
    }
    const perKit = money(r.total);
    totalEl.innerHTML = this.quantity > 1
      ? `<strong>${perKit}</strong> × ${this.quantity} = <strong>${money(r.total * this.quantity)}</strong>`
      : `<strong>${perKit}</strong>`;

    const undoBtn = this.panelEl.querySelector('#undo-btn');
    if (undoBtn) undoBtn.disabled = !canUndo(this.edit);
  }
}
