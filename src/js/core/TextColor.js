// Цвет надписей: кто у кого его берёт.
//
// Клиент 30.08: «привяжи пожалуйста цвет номера на груди к цвету надписей на спине,
// чтобы они одинакового цвета были». У номера на груди своего выбора цвета нет и не
// появится — он ведомый: своей палитры в карточке груди клиенту не показывают.

// Клиент 31.08 письменно: «Шрифт номера на груди, привязать к шрифту на спине».
// Тот же дефект и то же лечение, что было с цветом 30.08.

// Спина — единственная опция вида `name_number`: фамилия и номер рисуются одним цветом.
export function linkedNumberColor(options, optCache, fallback) {
  const спина = (options || []).find(o => o && o.kind === 'name_number');
  const c = спина && optCache && optCache[спина.id];
  return (c && c.color) || fallback;
}

// Шрифт ведомый по той же причине: своего выбора шрифта у номера на груди нет.
export function linkedNumberFont(options, optCache, fallback) {
  const спина = (options || []).find(o => o && o.kind === 'name_number');
  const c = спина && optCache && optCache[спина.id];
  return (c && c.fontId) || fallback;
}
