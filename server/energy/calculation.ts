import { utilityAmount, fixedDecimal } from '../billing/calculation.js';
import { cents } from '../hyl/calculation.js';
export function calculateUsage(
  previous: string,
  current: string,
  multiplier: string,
  price: string,
) {
  if (fixedDecimal(price) < 0n) throw Error('INVALID_PRICE');
  const result = utilityAmount(previous, current, multiplier, price),
    amountCents = cents(result.amount);
  if (amountCents > 99999999999999n) throw Error('BILLING_AMOUNT_LIMIT');
  return { ...result, amountCents: String(amountCents) };
}
export function usageSortKey(usage: string) {
  if (!/^\d{1,24}(\.\d{1,8})?$/.test(usage)) throw Error('INVALID_USAGE');
  const [whole, fraction = ''] = usage.split('.');
  return whole.padStart(24, '0') + fraction.padEnd(8, '0');
}
