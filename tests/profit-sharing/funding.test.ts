// @vitest-environment node
import { expect, it } from 'vitest';
import type { DatabaseConnection } from '@nocobase/db';
import { snapshot } from '../../server/profit-sharing/projection.js';
it('blocks a negative-payable settlement until its own effective collections fill the gap', async () => {
  const funding: unknown[] = [];
  const rows: Record<string, unknown[]> = {
    hylSettlements: [
      {
        id: 's',
        merchantId: 'm',
        version: 1,
        status: 'due',
        amountCents: '-20000',
        number: 'S',
        payload: {
          contractId: 'c',
          start: '2026-09-01',
          amounts: { collected: '100', fee: '300', rent: '0', deductions: '0' },
        },
      },
    ],
    hylContracts: [{ id: 'c', merchantId: 'm', number: 'C', payload: {} }],
    hylMerchants: [{ id: 'm', name: 'M', payload: {} }],
    hylSplitRules: [
      {
        id: 'r',
        contractId: 'c',
        version: 1,
        enabled: true,
        effectiveFrom: '2026-09-01',
        payload: {
          recipients: [
            {
              key: 'p',
              kind: 'project',
              name: 'Project',
              rate: '80',
              accountLabel: 'P',
            },
            {
              key: 'q',
              kind: 'partner',
              name: 'Partner',
              rate: '20',
              accountLabel: 'Q',
            },
          ],
        },
      },
    ],
    hylLeaseEntries: funding,
    hylSplitTransfers: [],
    hylPayments: [],
  };
  const c = {
    repository: (table: string) => ({
      findOne: async () => rows[table]?.[0],
      findMany: async () => rows[table] ?? [],
    }),
  } as unknown as DatabaseConnection;
  const before = (await snapshot(c, {
    sourceKind: 'settlement',
    sourceId: 's',
  }))!;
  expect(before.fundingGapCents).toBe('20000');
  expect(before.lines.find((r) => r.key === 'q')?.targetCents).toBe('6000');
  funding.push({
    id: 'x',
    contractId: 'c',
    sourceId: 'different',
    kind: 'collect',
    amountCents: '20000',
    reverseOf: null,
  });
  expect(
    (await snapshot(c, { sourceKind: 'settlement', sourceId: 's' }))
      ?.fundingGapCents,
  ).toBe('20000');
  funding.push({
    id: 'y',
    contractId: 'c',
    sourceId: 's',
    kind: 'collect',
    amountCents: '20000',
    reverseOf: null,
  });
  const funded = (await snapshot(c, {
    sourceKind: 'settlement',
    sourceId: 's',
  }))!;
  expect(funded.fundingGapCents).toBe('0');
  expect(funded.sourceFundsCents).toBe('30000');
  expect(funded.sourceHash).not.toBe(before.sourceHash);
});
