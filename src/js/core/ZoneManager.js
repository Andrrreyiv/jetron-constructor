// Авто-фит текста в зону (ТЗ): одна цифра занимает высоту зоны;
// при 2+ символах шрифт ужимается, чтобы строка влезла по ширине.
// charWidthRatio 0.75: заглавные кириллические буквы (ИВАНОВ, СИДОРОВ) в среднем ~0.71em
// ширины — при 0.6 фамилия сползала за рамку (клиент 2026-07-17: «кажется, вылезает по бокам»).
export function fitFontSize({ text, rect, charWidthRatio = 0.75 }) {
  const n = [...String(text)].length;
  const byHeight = rect.height;
  if (n <= 1) return byHeight;
  const byWidth = rect.width / (n * charWidthRatio);
  return Math.min(byHeight, byWidth);
}

export function zoneToRect(box, canvas) {
  return {
    left: box.x * canvas.width,
    top: box.y * canvas.height,
    width: box.w * canvas.width,
    height: box.h * canvas.height
  };
}
