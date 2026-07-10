// Чистая модель истории размещений: undo + перенос между зонами (C6).
// Состояние сериализуемо: { placements: {key: value}, past: [snapshot, ...] }.
// Ключ = `${view}:${zoneKey}`. Все функции возвращают новое состояние, не мутируя вход.

export function createState(placements = {}) {
  return { placements: { ...placements }, past: [] };
}

export function canUndo(state) {
  return state.past.length > 0;
}

export function setPlacement(state, key, value) {
  return {
    placements: { ...state.placements, [key]: value },
    past: [...state.past, state.placements]
  };
}

export function removePlacement(state, key) {
  if (!(key in state.placements)) return state;
  const placements = { ...state.placements };
  delete placements[key];
  return { placements, past: [...state.past, state.placements] };
}

export function movePlacement(state, fromKey, toKey) {
  const value = state.placements[fromKey];
  if (value === undefined) return state;
  const placements = { ...state.placements, [toKey]: value };
  delete placements[fromKey];
  return { placements, past: [...state.past, state.placements] };
}

export function undo(state) {
  if (!state.past.length) return state;
  const past = [...state.past];
  const placements = past.pop();
  return { placements: { ...placements }, past };
}
