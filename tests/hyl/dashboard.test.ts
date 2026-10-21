import { expect, it } from 'vitest';
import {
  businessMonth,
  loadDashboard,
  turnover,
} from '../../server/hyl/dashboard.js';
import type { DatabaseManager, RepositoryPolicy } from '@nocobase/db';

it('releases the settlement cursor before reading payments and includes more than 100 balances', async () => {
  let settlementCursorOpen = false;
  const database = {
    repository: (name: string) => {
      if (name === 'hylSettlements') {
        return {
          withPolicy: () => ({
            async *findMany() {
              settlementCursorOpen = true;
              try {
                for (let i = 0; i < 125; i++)
                  yield { id: String(i), amountCents: '10000' };
              } finally {
                settlementCursorOpen = false;
              }
            },
          }),
        };
      }
      expect(name).toBe('hylPayments');
      return {
        async *findMany() {
          // A streaming cursor owns SQLite's sole connection until exhausted.
          expect(settlementCursorOpen).toBe(false);
          yield { payload: { amount: '25.00' } };
        },
      };
    },
  } as unknown as DatabaseManager;
  const result = await loadDashboard(database, async (kind) =>
    kind === 'settlements' ? ({} as RepositoryPolicy) : null,
  );
  expect(result.unpaid).toBe('9375.00');
});
it('uses Shanghai calendar month at the UTC boundary and net turnover including vouchers', () => {
  expect(businessMonth(new Date('2026-09-30T15:59:59Z'))).toBe('2026-09');
  expect(businessMonth(new Date('2026-09-30T16:00:00Z'))).toBe('2026-10');
  expect(
    turnover({
      receipts: '10.10',
      refunds: '0.10',
      activity: '2.00',
      cash: '3.00',
      hospitality: '4.00',
    }),
  ).toBe(1900n);
});

import {
  previousBusinessMonth,
  revenueComparison,
} from '../../server/hyl/comparison.js';
it('compares adjacent calendar months across years and leap years', () => {
  expect(previousBusinessMonth('2026-01')).toBe('2025-12');
  expect(previousBusinessMonth('2024-03')).toBe('2024-02');
});
it('calculates signed exact change and half-up percentage with zero baselines', () => {
  expect(revenueComparison(15000n, 10000n, 1)).toEqual({
    previousAmount: '100.00',
    changeAmount: '50.00',
    changePercent: '50.00',
    previousReportCount: 1,
  });
  expect(revenueComparison(1n, 2n, 1).changePercent).toBe('-50.00');
  expect(revenueComparison(0n, 100n, 1).changePercent).toBe('-100.00');
  expect(revenueComparison(100n, 100n, 1).changePercent).toBe('0.00');
  expect(revenueComparison(4n, 3n, 1).changePercent).toBe('33.33');
  expect(revenueComparison(20001n, 20000n, 1).changePercent).toBe('0.01');
  expect(revenueComparison(19999n, 20000n, 1).changePercent).toBe('-0.01');
  expect(revenueComparison(100n, 0n, 0).changePercent).toBeNull();
  expect(revenueComparison(0n, 0n, 1).changePercent).toBeNull();
  expect(revenueComparison(900719925474099327n, 1n, 1)).toMatchObject({
    changeAmount: '9007199254740993.26',
    changePercent: '90071992547409932600.00',
  });
});
