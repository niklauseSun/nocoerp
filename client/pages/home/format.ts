/** Preserve cents even when the sum exceeds Number's safe integer range. */
export function dashboardAmount(value: string, locale: string) {
  const [whole, fraction = '00'] = value.split('.');
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'CNY' })
    .formatToParts(whole === '-0' ? -0 : BigInt(whole))
    .map((p) => (p.type === 'fraction' ? fraction.padEnd(2, '0') : p.value))
    .join('');
}

/** Keep the server's rounded decimal percentage exact, including large values. */
export function dashboardDecimal(value: string, locale: string) {
  const [whole, fraction = '00'] = value.split('.');
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .formatToParts(whole === '-0' ? -0 : BigInt(whole))
    .map((part) =>
      part.type === 'fraction' ? fraction.padEnd(2, '0') : part.value,
    )
    .join('');
}
