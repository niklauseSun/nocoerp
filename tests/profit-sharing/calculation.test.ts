// @vitest-environment node
import { expect, it } from 'vitest';
import {
  apportion,
  balances,
} from '../../server/profit-sharing/calculation.js';
it('allocates integer cents by largest remainder with stable keys, without losing refund pennies', () => {
  const shares = [
    { key: 'a', weight: 8000n },
    { key: 'b', weight: 2000n },
  ];
  expect(apportion(60000n, shares)).toEqual({ a: 48000n, b: 12000n });
  expect(apportion(100000n, shares)).toEqual({ a: 80000n, b: 20000n });
  expect(apportion(90000n, shares)).toEqual({ a: 72000n, b: 18000n });
  expect(
    apportion(1n, [
      { key: 'b', weight: 1n },
      { key: 'a', weight: 1n },
    ]),
  ).toEqual({ b: 0n, a: 1n });
  expect(
    apportion(99999999999999n, shares).a + apportion(99999999999999n, shares).b,
  ).toBe(99999999999999n);
  expect(() => apportion(1n, [{ key: 'a', weight: 0n }])).toThrow();
});
it('keeps gross distributions, recovered money, outstanding and recovery balances separate', () => {
  expect(balances(18000n, 20000n, 500n)).toEqual({
    netPaidCents: '19500',
    remainingCents: '0',
    recoveryCents: '1500',
  });
  expect(balances(18000n, 20000n, 2000n)).toEqual({
    netPaidCents: '18000',
    remainingCents: '0',
    recoveryCents: '0',
  });
  expect(balances(85000n, 50000n, 0n).remainingCents).toBe('35000');
});
