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
export function fitTextToRect(obj, rect, { ref = 100, maxStretch = 1 } = {}) {
  obj.set({ fontSize: ref });
  if (typeof obj.initDimensions === 'function') obj.initDimensions();
  const w = obj.width || 1;
  const h = obj.height || ref;
  const size = Math.max(1, ref * Math.min(rect.width / w, rect.height / h));
  obj.set({ fontSize: size });
  if (typeof obj.initDimensions === 'function') obj.initDimensions();
  // Клиент 2026-07-23: номер должен прилипать к рамке край-в-край. Равномерная подгонка выше
  // заполняет лишь узкую сторону рамки — у высокого-узкого номерного шрифта по бокам остаётся
  // зазор. maxStretch>1 добивает недостающую сторону масштабом до края рамки, но не более лимита
  // (≈1.15), чтобы цифра не искажалась заметно. Заполненную сторону не трогаем (её ratio ≈ 1).
  if (maxStretch > 1) {
    const tw = obj.width || 1;
    const th = obj.height || 1;
    obj.set({
      scaleX: Math.min(rect.width / tw, maxStretch),
      scaleY: Math.min(rect.height / th, maxStretch)
    });
  }
  return size;
}

// Номерные зоны (back_number/chest_number/shorts_number): для них номер прилипает к рамке
// край-в-край через стретч с лимитом (клиент 2026-07-23). Прочий текст (фамилия/надписи) — нет.
export const NUMBER_MAX_STRETCH = 1.15;
export function isNumberZone(key) { return /(^|_)number$/.test(String(key || '')); }

export function zoneToRect(box, canvas) {
  return {
    left: box.x * canvas.width,
    top: box.y * canvas.height,
    width: box.w * canvas.width,
    height: box.h * canvas.height
  };
}
