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

// Точная подгонка текста под рамку по фактическим размерам глифов Fabric.
// fitFontSize даёт лишь грубую оценку по средней ширине символа (charWidthRatio):
// для цифр она завышала ширину, из-за чего между последним символом и краем рамки
// оставался большой фиксированный зазор (клиент 2026-07-22: «от цифры до правого
// поля огромное расстояние и оно всегда зафиксировано»). Здесь измеряем реальную
// ширину/высоту строки при опорном кегле и масштабируем так, чтобы текст вплотную
// заполнил рамку по ограничивающей стороне — без пустого отступа.
// obj — текстовый объект Fabric (fabric.IText); мутирует его fontSize, возвращает кегль.
export function fitTextToRect(obj, rect, { ref = 100 } = {}) {
  obj.set({ fontSize: ref });
  if (typeof obj.initDimensions === 'function') obj.initDimensions();
  const w = obj.width || 1;
  const h = obj.height || ref;
  const size = Math.max(1, ref * Math.min(rect.width / w, rect.height / h));
  obj.set({ fontSize: size });
  if (typeof obj.initDimensions === 'function') obj.initDimensions();
  return size;
}

export function zoneToRect(box, canvas) {
  return {
    left: box.x * canvas.width,
    top: box.y * canvas.height,
    width: box.w * canvas.width,
    height: box.h * canvas.height
  };
}
