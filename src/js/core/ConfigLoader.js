const BOX_KEYS = ['x', 'y', 'w', 'h'];

export function validateConfig(config = {}) {
  const errors = [];
  if (!config.prices) errors.push('prices: раздел цен отсутствует');

  for (const form of config.forms || []) {
    for (const zone of form.zones || []) {
      const box = zone.box || {};
      const missing = BOX_KEYS.filter(k => typeof box[k] !== 'number');
      if (missing.length) {
        errors.push(`форма ${form.id}, зона ${zone.key}: нет box[${missing.join(',')}]`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
