// Куда ведёт кнопка на плашке над макетом.
// Клиент 28.08: кнопка называется «перейти в карточку» и открывает карточку ИМЕННО той
// расцветки, что сейчас на экране, а не раздел каталога по линейке.

export function productLink(form, catalog) {
  const card = String((form && form.productUrl) || '').trim();
  if (card) return { href: card, isCard: true, label: 'перейти в карточку →' };

  // Адресов карточек ещё нет ни у одной формы. До тех пор кнопка остаётся прежней ссылкой
  // на раздел линейки — и подписана прежним «в каталог», чтобы не обещать того, чего не делает.
  const c = catalog || {};
  const line = (form && form.line) || '';
  if (!line) return null;
  const slug = (c.lineSlugs && c.lineSlugs[line]) || line.toLowerCase();
  return { href: (c.base || '/shop/') + slug + (c.suffix || ''), isCard: false, label: 'в каталог →' };
}
