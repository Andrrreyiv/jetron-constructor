# Хендофф: деплой правок на боевой jetronsport.ru (2026-07-22)

Продолжение для другого аккаунта Claude. Контекст закончился на 2% лимита ПОСЕРЕДИНЕ подготовки деплоя.

## Что УЖЕ сделано (готово)
- Все правки закоммичены и запушены в GitHub. 2 коммита: `63653ae` (монограмма JS, плашка линейки, макеты к верху) и `2fb1ffd` (сброс кеша: конфиг no-store, версия ?v=20260722 у CSS/JS).
- Демо на GitHub Pages ОБНОВЛЕНО и проверено вживую: `https://andrrreyiv.github.io/jetron-constructor/` отдаёт новый код (`_renderLineBadge` есть, `lineSlugs`/`logoInverse` в конфиге есть, `?v=20260722` в HTML). `git status` = синхронизирован с origin/main.

## Что ОСТАЛОСЬ (главная задача)
**Клиент смотрит боевой jetronsport.ru, а НЕ демо. Там СТАРАЯ версия.** GitHub push НЕ трогает jetronsport.ru — это отдельная копия внутри WordPress под `/constructor/`. Нужно залить файлы туда.

Проверено вживую: `curl https://jetronsport.ru/constructor/src/js/ui/app.browser.js` → 0 совпадений `_renderLineBadge` (старьё). Обе монограммы отсутствуют (HTTP 302). Все 7 текстовых файлов ниже отличаются от локальных (cmp DIFFERS).

### Файлы на заливку (локальный = источник истины, repo HEAD)
ТЕКСТ (cmd=put):
1. `constructor/index.html` → hash `l1_Y29uc3RydWN0b3IvaW5kZXguaHRtbA`
2. `constructor/src/js/main.browser.js` → `l1_Y29uc3RydWN0b3Ivc3JjL2pzL21haW4uYnJvd3Nlci5qcw`
3. `constructor/src/js/ui/app.browser.js` → `l1_Y29uc3RydWN0b3Ivc3JjL2pzL3VpL2FwcC5icm93c2VyLmpz`
4. `constructor/src/js/ui/canvas.browser.js` → `l1_Y29uc3RydWN0b3Ivc3JjL2pzL3VpL2NhbnZhcy5icm93c2VyLmpz`
5. `constructor/src/js/ui/zone-editor.browser.js` → `l1_Y29uc3RydWN0b3Ivc3JjL2pzL3VpL3pvbmUtZWRpdG9yLmJyb3dzZXIuanM`
6. `constructor/src/css/stand.css` → `l1_Y29uc3RydWN0b3Ivc3JjL2Nzcy9zdGFuZC5jc3M`
7. `constructor/src/config/mock-config.json` → `l1_Y29uc3RydWN0b3Ivc3JjL2NvbmZpZy9tb2NrLWNvbmZpZy5qc29u`

БИНАРЬ (cmd=upload, multipart, target=папка assets `l1_Y29uc3RydWN0b3IvYXNzZXRz`):
8. `constructor/assets/jetron-monogram.png`
9. `constructor/assets/jetron-monogram-white.png`

Хеш пути: `l1_` + base64url(путь относительно веб-корня). Формула: `printf '%s' "constructor/..." | base64 -w0 | tr '+/' '-_' | tr -d '='`.

## Канал деплоя (проверен на чтении, HTTP 200)
- WordPress-админ jetronsport.ru — пользователь ЗАЛОГИНЕН (Chrome + Claude-in-Chrome).
- Плагин "Диспетчер файлов WP" (wp-file-manager). Страница: `/wp-admin/admin.php?page=wp_file_manager`.
- Коннектор: `POST https://jetronsport.ru/wp-admin/admin-ajax.php`, `credentials:'include'`.
- customData elFinder: `action=mk_file_folder_manager`, `_wpnonce=37675323cb`, `networkhref`.
  - ⚠️ NONCE ПРОТУХАЕТ. Взять свежий: открыть страницу wp_file_manager, затем в JS:
    `jQuery('.elfinder').elfinder('instance').options.customData._wpnonce`
- Корень elFinder = веб-корень (volume `l1_`, root hash `l1_Lw` = "/"). Пути относительные `constructor/...`.

### КРИТИЧНЫЙ GOTCHA (из reference_wp_filemanager_deploy.md)
НЕ передавать `encoding=scheme` с текстом — elFinder примет за data-URI и допишет ведущий NUL-байт (0x00), молча ломает JSON.parse и JS. Использовать `cmd=put` + `content=<UTF-8 текст>` БЕЗ параметра encoding. Проверено на чтении: firstCharCode=47 ('/'), NUL нет.

### javascript_tool НЕ ждёт промисы
Возвращает Promise как `{}`. Паттерн: 1-й вызов запускает fetch и пишет в `window.__r`; 2-й вызов читает `JSON.stringify(window.__r)`. Вывод, содержащий cookie-подобное, режется фильтром — возвращать только короткие поля (len, флаги), не сырой контент.

### Хелперы уже определены в текущей вкладке (могут слететь при новой сессии — переопредели)
```js
window.__NONCE='37675323cb'; // ОБНОВИ!
window.__AJAX='https://jetronsport.ru/wp-admin/admin-ajax.php';
window.b64ToText=function(b64){var bin=atob(b64);var u=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return new TextDecoder('utf-8').decode(u);};
window.__putText=function(b64,targetHash){window.__r=null;var text=window.b64ToText(b64);var body=new URLSearchParams();body.set('action','mk_file_folder_manager');body.set('_wpnonce',window.__NONCE);body.set('cmd','put');body.set('target',targetHash);body.set('content',text);fetch(window.__AJAX,{method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body}).then(function(r){return r.json().then(function(j){return {http:r.status,j:j};});}).then(function(o){var a=(o.j.added&&o.j.added[0])||{};window.__r={http:o.http,ok:!o.j.error,error:o.j.error||null,name:a.name,size:a.size};}).catch(function(e){window.__r={err:String(e)};});return 'PUT_STARTED';};
```
Передача контента: base64 локального файла embed'ится строкой в вызов, декод в браузере через b64ToText. Base64 генерить: `base64 -w0 <файл>` (temp был в /tmp/jdeploy/*.b64, но /tmp может не пережить сессию — регенери).

### PNG (бинарь) — cmd=upload, НЕ put
```js
// blob из base64
var bin=atob(B64), u=new Uint8Array(bin.length); for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);
var blob=new Blob([u],{type:'image/png'});
var fd=new FormData();
fd.append('action','mk_file_folder_manager');
fd.append('_wpnonce',window.__NONCE);
fd.append('cmd','upload');
fd.append('target','l1_Y29uc3RydWN0b3IvYXNzZXRz'); // папка assets
fd.append('upload[]',blob,'jetron-monogram.png');
fetch(window.__AJAX,{method:'POST',credentials:'include',body:fd})... // без Content-Type, браузер сам
```

## ОБЯЗАТЕЛЬНАЯ верификация после каждого put (запустил→увидел→работает)
HTTP 200 НЕ достаточно (NUL-баг тоже даёт 200). После заливки:
```
curl -s "https://jetronsport.ru/constructor/<path>?cb=$(date +%s)" > /tmp/live
cmp -s /tmp/live "/c/Projects/jetron-constructor/<path>" && echo OK || echo MISMATCH
```
Только байт-в-байт = залито. Плюс визуально перезагрузить конструктор на боевом.
Для app.browser.js быстрый чек: `curl ... | grep -c _renderLineBadge` → должно стать >0.
Для config: `grep -c lineSlugs` → >0. Для PNG: `curl -o /dev/null -w "%{http_code}"` → 200 (было 302).

## После деплоя — ответить клиенту
Клиент спрашивал «Можете кеш сбросить?» и «сбросил кэш браузера, ничего не поменялось». Причина была НЕ кеш, а то что боевой сайт не обновляли. После заливки: пусть сделает Cmd+Shift+R на Маке. Живой язык, без длинных тире.

## Открытый хвост (правка 4)
Слаги каталога `/product-category/champion/` и т.д. — ПРЕДПОЛОЖЕНИЕ. Клиент должен подтвердить реальные URL категорий линеек на jetronsport.ru, потом обновить `catalog.lineSlugs` в mock-config.json (и перезалить).
