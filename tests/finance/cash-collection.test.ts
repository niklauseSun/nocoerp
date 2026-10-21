// @vitest-environment node
import { expect, it } from 'vitest';
import {
  calculateReport,
  type Sources,
} from '../../server/finance/calculation.js';

it('TEST cash collection excludes deposits and unallocated advances, retaining only live cash allocations', () => {
  const source = {
    contracts: [],
    purchaseOrders: [],
    purchaseLedger: [],
    cash: [],
    projects: [],
    contractProjects: {},
    payments: [],
    bills: [
      {
        id: 'TEST-bill',
        number: 'TEST',
        status: 'issued',
        contractId: 'TEST-contract',
        amountCents: '10000',
        remainingCents: '4000',
        depositCents: '2000',
        allocatedCents: '4000',
        dueDate: '2026-10-31',
        createdAt: '2026-10-01T00:00:00Z',
      },
    ],
    receipts: [
      {
        id: 'TEST-advance',
        number: 'TEST-advance',
        status: 'received',
        amountCents: '90000',
        allocatedCents: '0',
        refundedCents: '0',
        unusedCents: '90000',
      },
    ],
    receiptEntries: [
      {
        id: 'TEST-a',
        billId: 'TEST-bill',
        kind: 'allocate',
        amountCents: '3000',
        reverseOf: null,
      },
      {
        id: 'TEST-extra',
        billId: 'TEST-bill',
        kind: 'allocate',
        amountCents: '1000',
        reverseOf: null,
      },
      {
        id: 'TEST-b',
        billId: 'TEST-bill',
        kind: 'allocate',
        amountCents: '1000',
        reverseOf: null,
      },
      {
        id: 'TEST-r',
        billId: 'TEST-bill',
        kind: 'reverseAllocation',
        amountCents: '1000',
        reverseOf: 'TEST-b',
      },
    ],
    settlements: [],
    leaseEntries: [
      {
        id: 'TEST-d',
        kind: 'deduct',
        sourceId: 'TEST-bill',
        amountCents: '2000',
        payload: { sourceType: 'bill' },
        reverseOf: null,
      },
    ],
  } as unknown as Sources;
  const report = calculateReport(source, {
    from: '2026-10-01',
    to: '2026-10-31',
  });
  expect(report.lines.receivables[0]).toMatchObject({
    appliedCents: '6000',
    cashAppliedCents: '4000',
  });
  expect(report.summary).toMatchObject({
    assessedCents: '10000',
    cashAppliedCents: '4000',
    collectionRateBps: '4000',
    appliedCents: '6000',
  });
  source.receiptEntries.push({
    id: 'TEST-reverse-extra',
    billId: 'TEST-bill',
    kind: 'reverseAllocation',
    amountCents: '1000',
    reverseOf: 'TEST-extra',
  } as never);
  expect(
    calculateReport(source, { from: '2026-10-01', to: '2026-10-31' }).summary,
  ).toMatchObject({
    cashAppliedCents: '3000',
    collectionRateBps: '3000',
    appliedCents: '5000',
  });
});

it('TEST zero denominator has no invented rate and confirmed lease collection excludes deposit coverage', () => {
  const source = {
    contracts: [],
    bills: [],
    receipts: [],
    receiptEntries: [],
    settlements: [],
    payments: [],
    purchaseOrders: [],
    purchaseLedger: [],
    cash: [],
    projects: [],
    contractProjects: {},
    leaseEntries: [],
  } as Sources;
  expect(
    calculateReport(source, { from: '2026-10-01', to: '2026-10-31' }).summary
      .collectionRateBps,
  ).toBe('0');
  source.leaseEntries = [
    {
      id: 'TEST-charge',
      kind: 'charge',
      amountCents: '10000',
      payload: {},
      reverseOf: null,
    },
    {
      id: 'TEST-confirm',
      kind: 'confirmCharge',
      sourceId: 'TEST-charge',
      amountCents: '0',
      payload: {},
      reverseOf: null,
    },
    {
      id: 'TEST-cash',
      kind: 'collect',
      sourceId: 'TEST-charge',
      amountCents: '1000',
      payload: {},
      reverseOf: null,
    },
    {
      id: 'TEST-deposit',
      kind: 'deduct',
      sourceId: 'TEST-charge',
      amountCents: '2000',
      payload: {},
      reverseOf: null,
    },
  ] as never;
  expect(
    calculateReport(source, { from: '2026-10-01', to: '2026-10-31' }).summary,
  ).toMatchObject({
    cashAppliedCents: '1000',
    appliedCents: '3000',
    collectionRateBps: '1000',
  });
});
