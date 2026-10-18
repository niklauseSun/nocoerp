// @vitest-environment node
import { expect, it } from 'vitest';
import { checkoutTotals } from '../../server/cashier/calculation.js';
it('keeps contract splits, deposit and actual cash separate with exact cents', () => {
  const input = {
    targets: [
      { contractId: 'a', amount: '500', deposit: '100' },
      { contractId: 'b', amount: '200', deposit: '0' },
    ],
    payments: [
      {
        amount: '500',
        splits: [
          { contractId: 'a', amount: '300' },
          { contractId: 'b', amount: '200' },
        ],
      },
      { amount: '200', splits: [{ contractId: 'a', amount: '200' }] },
    ],
  };
  expect(checkoutTotals(input)).toEqual({
    receivedCents: '70000',
    allocatedCents: '70000',
    depositCents: '10000',
    unusedCents: '0',
    contracts: [
      {
        contractId: 'a',
        receivedCents: '50000',
        allocatedCents: '50000',
        depositCents: '10000',
        unusedCents: '0',
      },
      {
        contractId: 'b',
        receivedCents: '20000',
        allocatedCents: '20000',
        depositCents: '0',
        unusedCents: '0',
      },
    ],
  });
  expect(() =>
    checkoutTotals({
      ...input,
      payments: [{ amount: '1', splits: [{ contractId: 'a', amount: '2' }] }],
    }),
  ).toThrow();
  expect(() =>
    checkoutTotals({
      ...input,
      payments: [{ amount: '1', splits: [{ contractId: 'a', amount: '1' }] }],
    }),
  ).toThrow();
});
