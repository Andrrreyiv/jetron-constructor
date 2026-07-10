export function calculatePrice({ prices, ageCategory = 'adult', usedZones = [], gaiters = false, jetron = {}, quantity = 1 }) {
  const formPrice = prices.form[ageCategory];
  const d = prices.discounts || {};
  const bulkFreeFrom = d.bulk_free_chest_logo_from || Infinity;
  const placementTable = prices.placement || {};
  // Каждая ценовая группа тарифицируется один раз (ТЗ §5): фамилия+номер = одна
  // группа 600, поэтому даже только номер (цена зоны 0) стоит 600. Цена группы —
  // из прайса placement[group], иначе максимум цен зон этой группы.
  const groups = new Map();
  for (const z of usedZones) {
    const group = z.priceGroup || z.key;
    const groupPrice = group in placementTable ? placementTable[group] : (z.price || 0);
    groups.set(group, Math.max(groups.get(group) || 0, groupPrice));
  }
  let placementTotal = 0;
  for (const [group, groupPrice] of groups) {
    const free = quantity >= bulkFreeFrom && group === 'chest_logo_small';
    placementTotal += free ? 0 : groupPrice;
  }
  const gaitersPrice = gaiters ? prices.gaiters : 0;
  const baseFee = prices.baseFee || 0;
  const subtotal = formPrice + placementTotal + gaitersPrice + baseFee;

  let discountPct = 0;
  if (jetron.chest) discountPct += d.jetron_chest || 0;
  if (jetron.back) discountPct += d.jetron_back || 0;

  return {
    formPrice,
    placementTotal,
    gaitersPrice,
    baseFee,
    discountPct,
    total: Math.round(subtotal * (1 - discountPct))
  };
}
