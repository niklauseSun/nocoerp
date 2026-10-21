import { describe, it, expect } from 'vitest';
import { allocate, tax, redTax } from '../../server/invoicing/calculation.js';
describe('invoice integer accounting', () => {
  it('preserves monotone paid quotas, full weights and exact totals for every cent', () => {
    const weights = [
      { id: 'a', amountCents: '5' },
      { id: 'b', amountCents: '3' },
      { id: 'c', amountCents: '1' },
    ];
    let previous = [0n, 0n, 0n];
    for (let paid = 0n; paid <= 9n; paid++) {
      const values = allocate(paid, weights).map((v) => BigInt(v.paidCents));
      expect(values.reduce((a, b) => a + b, 0n)).toBe(paid);
      values.forEach((v, i) =>
        expect(v >= previous[i] && v <= BigInt(weights[i].amountCents)).toBe(
          true,
        ),
      );
      previous = values;
    }
    expect(allocate(4n, weights).map((v) => v.paidCents)).toEqual([
      '2',
      '1',
      '1',
    ]);
    expect(allocate(5n, weights).map((v) => v.paidCents)).toEqual([
      '2',
      '2',
      '1',
    ]);
  });
  it('handles large integers without floating point and cumulative partial credits exactly', () => {
    const original = tax(10000000000000001n, 1333);
    const previous = { gross: 0n, net: 0n };
    for (const gross of [1n, 123456n, 9999999999876544n]) {
      const red = redTax(gross, original, previous);
      expect(BigInt(red.netCents) + BigInt(red.taxCents)).toBe(gross);
      previous.gross += gross;
      previous.net += BigInt(red.netCents);
    }
    expect(previous.gross).toBe(BigInt(original.grossCents));
    expect(previous.net).toBe(BigInt(original.netCents));
  });
});
