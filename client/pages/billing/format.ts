/** Aggregates may exceed Number's cent precision even when each bill is within its limit. */
export function formatMoney(value: string, locale: string, inCents = false) {
  let raw = value;
  if (inCents) {
    const n = BigInt(value),
      absolute = n < 0n ? -n : n;
    raw = `${n < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
  }
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) return '—';
  const integer = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  }).format(BigInt(match[2]));
  const fraction = (match[3] ?? '').padEnd(2, '0');
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .formatToParts(match[1] ? -1n : 0n)
    .map((p) =>
      p.type === 'integer'
        ? integer
        : p.type === 'fraction'
          ? fraction
          : p.value,
    )
    .join('');
}
