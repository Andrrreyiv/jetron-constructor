// Замер на боевом 06.09, сразу после выкладки фронта. Файлы на сервере верные — sha256
// боевого `index.html` совпал с нашим побайтово, и `#modelpick` в нём есть. А вкладка при этом
// рисовала конструктор БЕЗ ЕДИНОГО свотча: 0 кнопок `.pcolor` вместо 15, `#colorpick` высотой
// 0 px. Ошибок в консоли ноль.
//
// Причина не в выкладке. `/constructor/` отдаётся вообще без `cache-control`, только с ETag,
// поэтому браузер держит HTML по эвристике (обычно ~10 % возраста файла, у нас это были дни).
// Вернувшийся покупатель получает СТАРУЮ разметку в паре со СВЕЖИМ скриптом — а в старой
// разметке `#modelpick` ещё нет, он появился 31.08, когда палитра и эскизы разъехались по
// разным узлам. `buildColorPicker()` начинался строкой `if (!palHost || !modHost) return;`,
// то есть отсутствие узла эскизов молча гасило и палитру тоже.
//
// Лечение — не требовать узел, а создавать его. Это чинит любой случай рассогласования
// «старый HTML + новый JS», а не только сегодняшний.

import test from 'node:test';
import assert from 'node:assert/strict';

import { обеспечитьУзелМоделей } from '../src/js/core/ModelHost.js';

// Минимальный документ вместо jsdom: его в проекте нет, а для проверки порядка вставки
// хватает узлов со списком детей. Меряем ровно то, что важно — что узел есть и где он стоит.
function фейковыйДокумент() {
  const создать = (id = '') => {
    const узел = {
      id, className: '', children: [], parentNode: null,
      get nextSibling() {
        const с = this.parentNode ? this.parentNode.children : [];
        return с[с.indexOf(this) + 1] || null;
      },
      insertBefore(новый, перед) {
        новый.parentNode = this;
        const i = перед ? this.children.indexOf(перед) : -1;
        i === -1 ? this.children.push(новый) : this.children.splice(i, 0, новый);
        return новый;
      },
    };
    return узел;
  };
  const сцена = создать('stage');
  const палитра = сцена.insertBefore(создать('colorpick'), null);
  return {
    сцена,
    палитра,
    createElement: () => создать(),
    getElementById: (id) => сцена.children.find((д) => д.id === id) || null,
  };
}

test('когда узла эскизов нет, он создаётся сразу после палитры', () => {
  const doc = фейковыйДокумент();
  assert.equal(doc.getElementById('modelpick'), null, 'подготовка: узла заведомо нет');

  const узел = обеспечитьУзелМоделей(doc.палитра, doc);

  assert.ok(узел, 'без узла эскизов buildColorPicker() выходит на первой строке и палитра пуста');
  assert.equal(узел.id, 'modelpick');
  assert.equal(узел.className, 'modelpick', 'класс нужен: раскладку узлу задаёт CSS');
  // Порядок не косметика: на раскладке ≤900 палитра и эскизы идут отдельными строками под
  // формой именно в этом порядке, а `_availHeight()` меряет высоту эскизов, обрезая холст на ПК.
  assert.deepEqual(doc.сцена.children.map((д) => д.id), ['colorpick', 'modelpick']);
});
