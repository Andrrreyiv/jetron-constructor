// Черновик покупателя: настройки конструктора переживают перезагрузку страницы (п. 7 клиента 07.09).
// Хранилище ВНЕДРЯЕТСЯ параметром — модуль чистый и проверяется в Node без браузера.

export const DRAFT_KEY = 'jetron:draft:v1';
export const DRAFT_VERSION = 1;
// Сутки — срок, названный самим клиентом: «через день, через два, тогда ладно, бог с ним».
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
// localStorage у браузеров — около 5 МБ на домен, берём с запасом на чужие ключи страницы.
export const DRAFT_MAX_BYTES = 3 * 1024 * 1024;

// Признак «эту запись выбросить». Именно признак, а не null: null в черновике может быть
// осмысленным значением (пустой шрифт, закрытая карточка), и путать одно с другим нельзя.
const DROP = Symbol('drop');

// blob: URL живёт ровно столько, сколько вкладка. После перезагрузки он даёт битую картинку,
// поэтому запись с ним не «чинится» — выбрасывается целиком, а потеря считается вслух.
// dropAll=true — второй заход, когда черновик не влез в квоту: тогда выбрасываем и data:.
function stripBlobs(value, counter, dropAll = false) {
  if (Array.isArray(value)) {
    return value.map((v) => stripBlobs(v, counter, dropAll)).filter((v) => v !== DROP);
  }
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const heavy = typeof v === 'string' && (v.startsWith('blob:') || (dropAll && v.startsWith('data:')));
    if (heavy) { counter.n += 1; return DROP; }
    const kept = stripBlobs(v, counter, dropAll);
    if (kept !== DROP) out[k] = kept;
  }
  return out;
}

export function saveDraft(
  storage,
  snapshot,
  { now = Date.now(), key = DRAFT_KEY, maxBytes = DRAFT_MAX_BYTES } = {}
) {
  const counter = { n: 0 };
  const pack = (value) => JSON.stringify({ v: DRAFT_VERSION, savedAt: now, data: value === DROP ? {} : value });

  let body = pack(stripBlobs(snapshot, counter));
  if (body.length > maxBytes) {
    // Не влезли — выбрасываем картинки и пробуем ещё раз: текст покупателя дороже логотипа.
    counter.n = 0;
    body = pack(stripBlobs(snapshot, counter, true));
  }
  if (body.length > maxBytes) return { saved: false, reason: 'too-big', droppedImages: counter.n };
  try {
    storage.setItem(key, body);
  } catch {
    return { saved: false, reason: 'storage', droppedImages: counter.n };
  }
  return { saved: true, droppedImages: counter.n };
}

export function clearDraft(storage, { key = DRAFT_KEY } = {}) {
  try {
    storage.removeItem(key);
  } catch { /* хранилища нет или оно запрещено — забыть черновик и так уже нечего */ }
}

export function loadDraft(storage, { now = Date.now(), key = DRAFT_KEY, ttlMs = DRAFT_TTL_MS } = {}) {
  let payload = null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }
  const stale = !payload || payload.v !== DRAFT_VERSION || now - payload.savedAt > ttlMs;
  if (stale) {
    clearDraft(storage, { key });
    return null;
  }
  return payload.data;
}
