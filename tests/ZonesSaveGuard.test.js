// Защита разметки от затирания при сохранении.
//
// Механика опасна по устройству: `deploy/jetron-zones.php` пишет zones.json ЦЕЛИКОМ и старый файл
// НЕ читает (jetron_zones_write, строки 101-116) — весь мерж живёт на клиенте в mergedOverrides(),
// где `const base = this.app.config.zoneOverrides || {}`. А загрузчик (main.browser.js) кладёт
// туда значение только если файл и прочитался, и прошёл validateOverrides, причём ОДНА битая
// запись отвергает файл целиком.
//
// Сложение даёт потерю: файл на сервере есть, но не разобрался → base = {} → первое же
// «Сохранить» перезаписывает zones.json содержимым одной текущей сессии, и разметка остальных
// форм исчезает. К 12.09 клиент вложил в неё день работы на восьми донорах.
//
// Отличать надо три состояния: файл прочитан (сохранять можно), файла нет вовсе — первый запуск
// (можно, затирать нечего), файл есть, но не разобран (нельзя — это и есть потеря).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zonesSaveGuard } from '../src/js/core/ZoneOverrides.js';

test('файл прочитан — сохранять можно', () => {
  assert.equal(zonesSaveGuard('ok').ok, true);
});

test('файла на сервере нет — сохранять можно, затирать нечего', () => {
  assert.equal(zonesSaveGuard('missing').ok, true);
});

test('файл есть, но не разобрался — сохранение ЗАПРЕЩЕНО', () => {
  const res = zonesSaveGuard('failed');
  assert.equal(res.ok, false);
  assert.match(res.reason, /разметк/i, 'админ должен понять из текста, что на кону');
});

// Состояние неизвестно (старый кэш, сторонний вызов) — считаем опасным: пропустить сохранение
// дешевле, чем потерять разметку сорока с лишним форм.
test('неизвестное состояние трактуется как опасное', () => {
  assert.equal(zonesSaveGuard(undefined).ok, false);
  assert.equal(zonesSaveGuard(null).ok, false);
  assert.equal(zonesSaveGuard('что-то ещё').ok, false);
});
