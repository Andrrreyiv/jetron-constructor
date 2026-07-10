import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateConfig } from '../src/js/core/ConfigLoader.js';

// Валидация на границе системы (CLAUDE.md): битый конфиг должен падать явно, а не молча.
test('конфиг без цен отклоняется с понятной ошибкой', () => {
  const res = validateConfig({ forms: [] });
  assert.equal(res.ok, false);
  assert.match(res.errors.join(' '), /prices/);
});

// Зона без box{x,y,w,h} не может быть отрисована — конфиг обязан это ловить.
test('зона без геометрии box отклоняется с указанием формы и зоны', () => {
  const res = validateConfig({
    prices: { form: { adult: 1, child: 1 } },
    forms: [{ id: 'champion-blue', zones: [{ key: 'name' }] }]
  });
  assert.equal(res.ok, false);
  assert.match(res.errors.join(' '), /champion-blue.*name|name.*champion-blue/);
});

// Реальный mock-config.json должен быть внутренне согласован.
test('реальный mock-config.json проходит валидацию', () => {
  const url = new URL('../src/config/mock-config.json', import.meta.url);
  const config = JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
  const res = validateConfig(config);
  assert.deepEqual(res.errors, []);
  assert.equal(res.ok, true);
});
