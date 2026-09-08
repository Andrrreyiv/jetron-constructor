import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveDraft, loadDraft, clearDraft, DRAFT_KEY, DRAFT_TTL_MS } from '../src/js/core/DraftStorage.js';

// Черновик покупателя (п. 7 комментариев 07.09): «навставлял логотипов, обновил страницу — всё сбросилось».
// Клиент сам очертил срок: «через день, через два — бог с ним», значит живём ~сутки, не дольше.
// Хранилище ВНЕДРЯЕТСЯ, поэтому модуль проверяется в Node без браузера.
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    get size() { return map.size; },
    raw: map
  };
}

const snapshot = () => ({
  formId: 'champion-blue',
  ageCategory: 'adult',
  gaiters: true,
  quantity: 3,
  jetron: { chest: true, back: false },
  optShown: { back_name: true },
  optCache: { back_name: { name: 'ИВАНОВ', number: '10', fontId: 'f1', color: '#fff' } }
});

test('сохранённый черновик читается обратно тем же объектом', () => {
  const s = fakeStorage();
  const res = saveDraft(s, snapshot(), { now: 1000 });
  assert.equal(res.saved, true);
  assert.deepEqual(loadDraft(s, { now: 1000 }), snapshot());
});

// Срок жизни задан словами клиента: сутки «в моменте» — да, «через день, через два» — уже не надо.
test('черновик старше суток не возвращается и стирается из хранилища', () => {
  const s = fakeStorage();
  saveDraft(s, snapshot(), { now: 0 });
  assert.ok(loadDraft(s, { now: DRAFT_TTL_MS - 1 }), 'внутри суток черновик обязан жить');
  assert.equal(loadDraft(s, { now: DRAFT_TTL_MS + 1 }), null);
  assert.equal(s.getItem(DRAFT_KEY), null, 'протухший черновик не должен занимать место');
});

// Главная мина: лёгкие файлы `prepareImage()` отдаёт как blob: URL, он умирает вместе со вкладкой.
// Записать его — значит после перезагрузки показать битую картинку вместо честного «логотип не сохранился».
test('blob-ссылки не сохраняются и считаются потерянными', () => {
  const s = fakeStorage();
  const draft = snapshot();
  draft.optCache.chest_logo = { image: 'blob:http://localhost:8778/abc-123' };
  const res = saveDraft(s, draft, { now: 1000 });
  assert.equal(res.saved, true);
  assert.equal(res.droppedImages, 1);
  const back = loadDraft(s, { now: 1000 });
  assert.equal(back.optCache.chest_logo, undefined, 'опция без картинки не должна возвращаться пустой');
  assert.equal(back.optCache.back_name.name, 'ИВАНОВ', 'остальное сохраняется несмотря на потерю логотипа');
});

// localStorage — около 5 МБ на домен, а тяжёлый логотип приезжает как data:image/webp.
// Лучше сохранить фамилию с номером без картинки, чем не сохранить ничего.
test('слишком большой черновик сохраняется без картинок, а не теряется целиком', () => {
  const s = fakeStorage();
  const draft = snapshot();
  draft.optCache.chest_logo = { image: 'data:image/webp;base64,' + 'A'.repeat(5000) };
  const res = saveDraft(s, draft, { now: 1000, maxBytes: 2000 });
  assert.equal(res.saved, true);
  assert.equal(res.droppedImages, 1);
  const back = loadDraft(s, { now: 1000 });
  assert.equal(back.optCache.chest_logo, undefined);
  assert.equal(back.optCache.back_name.number, '10');
});

// Обрезок хуже пустоты: он выглядит как сохранённый черновик и вернёт покупателю половину работы.
test('черновик, не влезающий даже без картинок, честно возвращает saved=false и ничего не пишет', () => {
  const s = fakeStorage();
  const res = saveDraft(s, snapshot(), { now: 1000, maxBytes: 10 });
  assert.equal(res.saved, false);
  assert.equal(res.reason, 'too-big');
  assert.equal(s.size, 0);
});

// Приватный режим Safari и переполненная квота бросают прямо из setItem.
// Конструктор от неудачного сохранения падать не имеет права: черновик — удобство, а не товар.
test('падение хранилища не роняет конструктор', () => {
  const s = fakeStorage();
  s.setItem = () => { throw new Error('QuotaExceededError'); };
  const res = saveDraft(s, snapshot(), { now: 1000 });
  assert.equal(res.saved, false);
  assert.equal(res.reason, 'storage');
});

// Мусор в ключе (чужое расширение, оборванная запись, будущая версия формата) не должен
// ни ронять конструктор, ни оставаться навсегда — иначе покупатель залипнет на нём насовсем.
test('нечитаемый черновик считается отсутствующим и убирается', () => {
  const broken = fakeStorage({ [DRAFT_KEY]: '{не json' });
  assert.equal(loadDraft(broken, { now: 1000 }), null);
  assert.equal(broken.getItem(DRAFT_KEY), null);

  const alien = fakeStorage({ [DRAFT_KEY]: JSON.stringify({ v: 99, savedAt: 1000, data: snapshot() }) });
  assert.equal(loadDraft(alien, { now: 1000 }), null);
  assert.equal(alien.getItem(DRAFT_KEY), null);
});

// Хранилища может не быть вовсе: старый браузер, выключенные куки, iframe со строгой политикой.
// Конструктор — это iframe на странице WP, так что случай не выдуманный.
test('без хранилища модуль молчит, а не бросает', () => {
  const s = fakeStorage();
  saveDraft(s, snapshot(), { now: 1000 });
  clearDraft(s);
  assert.equal(loadDraft(s, { now: 1000 }), null, 'clearDraft обязан убрать черновик');

  assert.equal(saveDraft(null, snapshot(), { now: 1000 }).saved, false);
  assert.equal(loadDraft(null, { now: 1000 }), null);
  assert.doesNotThrow(() => clearDraft(null));
});
