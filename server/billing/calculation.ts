import { money } from '../hyl/calculation.js';

const scale = 10000n;
export function fixedDecimal(value: string): bigint {
  if (!/^(?:\d{1,12}(?:\.\d{1,4})?|\.\d{1,4})$/.test(value))
    throw new Error('INVALID_DECIMAL');
  const [whole = '', fraction = ''] = value.split('.');
  return BigInt(whole || '0') * scale + BigInt(fraction.padEnd(4, '0'));
}
export function roundRatio(value: bigint, denominator: bigint) {
  if (denominator <= 0n || value < 0n) throw new Error('INVALID_DECIMAL');
  return (value + denominator / 2n) / denominator;
}
export function decimalText(value: bigint, places = 4) {
  const unit = 10n ** BigInt(places);
  const fraction = String(value % unit)
    .padStart(places, '0')
    .replace(/0+$/, '');
  return `${value / unit}${fraction ? `.${fraction}` : ''}`;
}
/** Monthly prices use actual inclusive days; area and price are multiplied before rounding. */
export function prorated(
  monthly: string,
  start: string,
  end: string,
  area = '1',
) {
  if (start > end || start.slice(0, 7) !== end.slice(0, 7))
    throw new Error('INVALID_PERIOD');
  const days = BigInt(Number(end.slice(8)) - Number(start.slice(8)) + 1);
  const monthDays = BigInt(
    new Date(
      Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)), 0),
    ).getUTCDate(),
  );
  return money(
    roundRatio(
      fixedDecimal(monthly) * fixedDecimal(area) * days,
      1000000n * monthDays,
    ),
  );
}
export function utilityAmount(
  previous: string,
  current: string,
  multiplier: string,
  price: string,
) {
  const delta = fixedDecimal(current) - fixedDecimal(previous),
    factor = fixedDecimal(multiplier);
  if (delta < 0n || factor <= 0n) throw new Error('INVALID_READING');
  return {
    usage: decimalText(delta * factor, 8),
    amount: money(
      roundRatio(delta * factor * fixedDecimal(price), 10000000000n),
    ),
  };
}
export const nextDay = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
export function covered(
  start: string,
  end: string,
  intervals: { start: string; end: string }[],
) {
  let cursor = start;
  for (const interval of [...intervals].sort((a, b) =>
    a.start.localeCompare(b.start),
  )) {
    if (interval.end < cursor) continue;
    if (interval.start > cursor) return false;
    cursor = nextDay(interval.end);
    if (cursor > end) return true;
  }
  return cursor > end;
}
export function businessDay() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
