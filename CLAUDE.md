# jetron-constructor — конструктор футбольной формы

Статус-хендофф. Обновлено: 2026-07-24. Self-contained контекст для любой сессии/аккаунта Claude на этом ПК.
(Память в `~/.claude/...` привязана к аккаунту; этот файл в репозитории — источник правды для передачи между аккаунтами.)

## Что это
Онлайн-конструктор футбольной формы (vanilla JS + Fabric.js v6): 8 линеек (Champion, Legend, New, Rich, Space, Star, Venom, Winner), зоны нанесения (номер/фамилия/лого), редактор зон `?zones=edit` (админ). Заказ через profi.ru; заказчик = русскоязычный, он же WP-админ jetronsport.ru.

⚠️ НЕ ПУТАТЬ с `tshirt-constructor` (конструктор ФУТБОЛОК) — отдельный продукт того же заказчика, отдельное репо. Вопросы про принты по см / ivory / плотности / карточки товара — туда.

## Репозиторий и запуск
- Git: `https://github.com/Andrrreyiv/jetron-constructor` (ветка main). HEAD сейчас `d433c6e`.
- Локальный сервер: `npx --yes serve -l 8777 .` (см. `.claude/launch.json`, имя конфигурации `jetron`). Открывать `http://localhost:8777/` (query теряется на /index.html-редиректе → `?zones=edit` цеплять к корню: `http://localhost:8777/?zones=edit`).
- Тесты: `npm test` (37/37). Рантайм-хуки в браузере: `window.__jetronApp` (покупатель), `window.__jetronEditor` (только при `?zones=edit`).
- Ключевые файлы: `src/js/ui/app.browser.js` (панель, рендер, плашка), `src/js/ui/canvas.browser.js` (Fabric: placeText/placeImage), `src/js/core/ZoneManager.js` (fitTextToRect), `src/js/ui/zone-editor.browser.js` (админ-редактор зон + кадрирование фона), `src/config/mock-config.json`, `src/css/stand.css`.

## Деплой — ДВА таргета
- **Демо:** GitHub Pages, деплой = `git push origin main`. https://andrrreyiv.github.io/jetron-constructor/. Проверять токен: `curl .../index.html | grep stand.css?v=`.
- **Боевой:** jetronsport.ru/constructor/ (WordPress/WooCommerce). Канал — WP File Manager (elFinder), НЕ git:
  1. Нужен Chrome с расширением Claude, залогиненный WP-админом. Проверить: `mcp__claude-in-chrome__list_connected_browsers` (не пусто). Curl напрямую НЕЛЬЗЯ (нужен админ-cookie, вводить учётки запрещено).
  2. Открыть в этой вкладке `https://jetronsport.ru/wp-admin/admin.php?page=wp_file_manager`, взять nonce: `jQuery('.elfinder').elfinder('instance').options.customData._wpnonce` (24.07 был `e908034cce`; живёт ~12–24ч, при errorNonce перевзять).
  3. Оркестратор в этой же вкладке: для каждого файла `fetch('https://raw.githubusercontent.com/Andrrreyiv/jetron-constructor/main/<repoPath>')` → POST на `/wp-admin/admin-ajax.php` `action=mk_file_folder_manager&_wpnonce=<n>&cmd=put&target=l1_<b64url("constructor/"+repoPath)>&content=<text>`. Root elFinder = `l1_Lw` (=«/»), конструктор в `/constructor/`.
  4. ⚠️ НИКОГДА не слать `encoding=scheme` (elFinder добавляет NUL-байт 0x00 → ломает JSON.parse/JS). Только `cmd=put content=<text>` без encoding.
  5. **Обязательная байт-сверка:** `curl -s ".../constructor/<path>?cb=$(date +%s)"` и `cmp` со снятием `\r` против `git show HEAD:<path>` (НЕ против рабочего дерева — Windows autocrlf). Проверить первый байт (не 0 → нет NUL-порчи: 47=«/» для JS/CSS, 60=«<» HTML, 123=«{» JSON). HTTP 200 сам по себе НЕ гарантия.
- ESM-кеш: у импортов версия `?v=` (сейчас `20260724a`). При изменении модуля бустить токен во ВСЕХ ссылках/импортах (index.html + main.browser.js), иначе кеш отдаёт старьё.

## Текущее состояние (24.07)
- **Боевой = HEAD (`d433c6e`)**, задеплоено и байт-сверено 8/8 файлов 24.07. Демо тоже на HEAD.
- Плашка линейки — ТЕКСТОВАЯ (`Champion →`), теперь ВНУТРИ поля (абсолют в левом-верхнем углу `.views`), по клику ведёт в каталог. Картинки-кнопки не будет (её у заказчика в проекте нет, решение 23.07).
- Цена изделия на боевом подтягивается из карточки товара WooCommerce (заказчик 23.07) → `prices.form` в конфиге (adult/child 1280/1280) = демо-заглушка.

## Комментарии заказчика 24.07 (видео+голос) — 5 пунктов
Расшифровка голосовых: `PYTHONIOENCODING=utf-8 python docs/transcribe_one.py <файл>` (Whisper base); аудио из mp4 — ffmpeg (imageio_ffmpeg).
СДЕЛАНО (коммит d433c6e, на демо и боевом, тесты 37/37):
- **Баг 5 — кадрирование деформировало мокап:** причина — рёберные маркеры (ml/mr/mt/mb) тянут по одной оси. Фикс: `enterCropMode` (zone-editor.browser.js) показывает только угловые tl/tr/bl/br, `lockUniScaling` уже был. Проверено рантаймом.
- **Баг 4 — плашка внутрь поля:** `.line-badge` → `position:absolute; top:0;left:0` в `.views` (stand.css). Проверено: угол плашки = угол поля.

НЕ сделано — НУЖНЫ РЕШЕНИЯ (фиксы не фабриковать):
- **Баг 3 «номер на спине уменьшается от длины фамилии» — НЕ ВОСПРОИЗВОДИТСЯ.** Прогон через applyOption и renderAll: кегль/ширина номера идентичны с фамилией и без (fs=92, rw=91.6). В коде номер независим от фамилии. Заказчик видел на СТАРОМ боевом (был fa5871f); боевой обновлён — ждём перепроверку + видео если повторится.
- **Баг 1 «лого и цифра не двигаются» — это дизайн-модель, не баг.** Элементы приколоты к зонам через `clipPath` (absolutePositioned); перемещение не залочено, но clipPath обрезает по зоне → элемент «пропадает» за границей. Свободный драг = продуктовое решение (риск ухода за печатную зону). Ждём выбор заказчика: свободноタскать или привязка к зонам. Убирать clipPath без решения НЕЛЬЗЯ (это гарантия печат-зоны).
- **Баг 2 «номер не прилипает к стенкам» — подтверждён частично.** Заполняет высоту точно, по ширине зазор ~20% (упор в `NUMBER_MAX_STRETCH=1.15` + зона back_number в моке широкая). На боевом зоны придут из U3 (своя геометрия). Ждём выбор: заполнять ширину (искажает цифру) или центр с отступом.

## Открытые хвосты (ждём заказчика)
1. Три вопроса из бага 1/2/3 выше (отправлены клиенту 24.07 в отклике).
2. Слаги категорий `config.catalog.lineSlugs` — ПРЕДПОЛОЖЕНИЕ (`/product-category/champion/`...). Ждём реальные URL → обновить конфиг → перезалить оба таргета.
3. «Без категории» в каталоге WooCommerce боевого — заказчику отправлена инструкция назначить товару категорию в админке.
4. Качество части мокапов (спины перекраской, оверсайз) — дорабатывает дизайнер заказчика.

## Грабли
- Edit/Write иногда падают `Not logged in` на файлах проекта → обход: node-скрипт точечных замен через Bash (однострочные якоря + `includes`-проверка, `process.exit(1)` если не найдено).
- Кириллица Whisper в консоли ломается → `PYTHONIOENCODING=utf-8` или вывод в файл.
- tdd-guard: stub-first (пустой export → красный тест → реализация); слеп к голому `node --test`.
- Windows autocrlf: рабочая копия CRLF — сверять деплой с HEAD-блобами, не с рабочим деревом.
- `serve` роняет query на /index.html → цеплять `?zones=edit` к корню `/`.
