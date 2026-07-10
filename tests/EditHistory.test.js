import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createState, setPlacement, removePlacement, movePlacement, undo, canUndo
} from '../src/js/core/EditHistory.js';

test('set добавляет размещение и делает историю отменяемой', () => {
  let s = createState();
  assert.equal(canUndo(s), false);
  s = setPlacement(s, 'back:name', { type: 'text', value: 'ИВАНОВ' });
  assert.deepEqual(s.placements, { 'back:name': { type: 'text', value: 'ИВАНОВ' } });
  assert.equal(canUndo(s), true);
});

test('undo возвращает предыдущее состояние размещений', () => {
  let s = createState();
  s = setPlacement(s, 'back:name', { type: 'text', value: 'ИВАНОВ' });
  s = setPlacement(s, 'back:back_number', { type: 'text', value: '10' });
  s = undo(s);
  assert.deepEqual(Object.keys(s.placements), ['back:name']);
  assert.equal(canUndo(s), true);
  s = undo(s);
  assert.deepEqual(s.placements, {});
  assert.equal(canUndo(s), false);
});

test('remove удаляет размещение и тоже отменяемо', () => {
  let s = createState();
  s = setPlacement(s, 'back:name', { type: 'text', value: 'ИВАНОВ' });
  s = removePlacement(s, 'back:name');
  assert.deepEqual(s.placements, {});
  s = undo(s);
  assert.deepEqual(s.placements, { 'back:name': { type: 'text', value: 'ИВАНОВ' } });
});

test('move переносит размещение из одной зоны в другую', () => {
  let s = createState();
  s = setPlacement(s, 'front:chest_number', { type: 'text', value: '7' });
  s = movePlacement(s, 'front:chest_number', 'back:back_number');
  assert.deepEqual(s.placements, { 'back:back_number': { type: 'text', value: '7' } });
  s = undo(s);
  assert.deepEqual(s.placements, { 'front:chest_number': { type: 'text', value: '7' } });
});

test('move из пустой зоны — no-op', () => {
  const s = setPlacement(createState(), 'front:chest_number', { type: 'text', value: '7' });
  assert.equal(movePlacement(s, 'front:name', 'back:back_number'), s);
});

test('исходное состояние не мутируется (чистые функции)', () => {
  const s0 = createState();
  const s1 = setPlacement(s0, 'front:chest_number', { type: 'text', value: '7' });
  assert.deepEqual(s0.placements, {});
  assert.notEqual(s0, s1);
});
