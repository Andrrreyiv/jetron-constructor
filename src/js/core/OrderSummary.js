// Сборка заказа из состояния конструктора в тестируемый, сериализуемый объект.
// Это контракт передачи в корзину/WooCommerce (U1): цена считается той же чистой
// calculatePrice, что и в UI, поэтому сервер сможет её независимо пересчитать.
import { calculatePrice } from './PriceCalculator.js';

export function buildOrder({ config, formId, ageCategory = 'adult', gaiters = false, jetron = {}, quantity = 1, placements = [] }) {
  const form = config.forms.find((f) => f.id === formId);
  const zonesByKey = new Map((form.zones || []).map((z) => [z.key, z]));

  const usedZones = placements
    .map((p) => zonesByKey.get(p.zoneKey))
    .filter(Boolean)
    .map((z) => ({ key: z.key, priceGroup: z.priceGroup || z.key, price: z.price || 0 }));

  const p = calculatePrice({ prices: config.prices, ageCategory, usedZones, gaiters, jetron, quantity });

  const items = placements
    .map((pl) => {
      const z = zonesByKey.get(pl.zoneKey);
      if (!z) return null;
      // type зоны может быть 'any' (текст ИЛИ логотип) — в позиции пишем то, что человек реально нанёс.
      const item = { view: pl.view, zoneKey: z.key, label: z.label, type: pl.type || z.type, price: z.price || 0 };
      if (pl.type === 'text') item.text = pl.value;
      return item;
    })
    .filter(Boolean);

  return {
    formId,
    formName: form.name,
    color: form.color,
    colorHex: form.colorHex,
    ageCategory,
    gaiters,
    jetron: { chest: !!jetron.chest, back: !!jetron.back },
    quantity,
    items,
    price: {
      formPrice: p.formPrice,
      placementTotal: p.placementTotal,
      gaitersPrice: p.gaitersPrice,
      discountPct: p.discountPct,
      perKit: p.total,
      grandTotal: p.total * quantity
    }
  };
}
