import { describe, it, expect } from 'vitest';
import {
  calculateReport,
  type Sources,
} from '../../server/finance/calculation.js';
const base = (): Sources => ({
  contracts: [],
  bills: [],
  receipts: [],
  receiptEntries: [],
  leaseEntries: [],
  settlements: [],
  payments: [],
  purchaseOrders: [],
  purchaseLedger: [],
  cash: [],
  projects: [],
  contractProjects: {},
});
const query = { from: '2026-10-01', to: '2026-10-31' };
describe('financial report accounting', () => {
  it('keeps later cash reversals in their registration period and never sums orchestration', () => {
    const s = base();
    s.cash = [
      {
        id: 'a',
        contractId: 'c',
        number: 'R',
        at: '2026-09-30T15:59:59Z',
        date: '2026-09-01',
        actor: 'a',
        method: 'bank',
        kind: 'receive',
        category: 'bill',
        amountCents: '10000',
      },
      {
        id: 'b',
        contractId: 'c',
        number: 'R',
        at: '2026-09-30T16:00:00Z',
        date: '2026-09-01',
        actor: 'a',
        method: 'bank',
        kind: 'refund',
        category: 'bill',
        amountCents: '-2000',
      },
      {
        id: 'c',
        contractId: 'c',
        number: 'R',
        at: '2026-11-01T00:00:00Z',
        date: '2026-09-01',
        actor: 'a',
        method: 'bank',
        kind: 'reverseRefund',
        category: 'bill',
        amountCents: '2000',
      },
    ];
    const r = calculateReport(s, query);
    expect(r.summary).toMatchObject({
      openingCashCents: '10000',
      receivedCents: '0',
      paidCents: '2000',
      netCents: '-2000',
      closingCashCents: '8000',
    });
    expect(r.lines.cash).toHaveLength(1);
  });
  it('reconstructs bill receivables from active allocations/deposit and reports corrupted cache', () => {
    const s = base();
    s.bills = [
      {
        id: 'b',
        number: 'B',
        status: 'issued',
        contractId: 'c',
        amountCents: '10000',
        remainingCents: '7000',
        depositCents: '1000',
        allocatedCents: '2000',
        dueDate: '2026-10-31',
        createdAt: '2026-10-01T00:00:00Z',
      } as never,
    ];
    s.receiptEntries = [
      {
        id: 'a',
        kind: 'allocate',
        billId: 'b',
        amountCents: '2000',
        reverseOf: null,
      },
      {
        id: 'rev',
        kind: 'reverseAllocation',
        billId: 'b',
        amountCents: '2000',
        reverseOf: 'a',
      },
    ] as never;
    s.leaseEntries = [
      {
        id: 'd',
        contractId: 'c',
        kind: 'deduct',
        sourceId: 'b',
        amountCents: '1000',
        payload: { sourceType: 'bill' },
        reverseOf: null,
        createdAt: '2026-10-01T00:00:00Z',
      },
    ] as never;
    const r = calculateReport(s, query);
    expect(r.summary.receivableCents).toBe('9000');
    expect(
      r.checks.find((x) => x.id === 'bill:b:remaining')?.differenceCents,
    ).toBe('2000');
  });
  it('separates deposit transfers and reversal movements from cash with exact cents', () => {
    const s = base();
    s.contracts = [{ id: 'c', number: 'C' }] as never;
    s.leaseEntries = [
      {
        id: 'a',
        contractId: 'c',
        kind: 'receive',
        amountCents: '9007199254740993',
        reverseOf: null,
        payload: {},
        createdAt: '2026-09-01T00:00:00Z',
      },
      {
        id: 'b',
        contractId: 'c',
        kind: 'transferOut',
        amountCents: '100',
        reverseOf: null,
        payload: {},
        createdAt: '2026-10-01T00:00:00Z',
      },
      {
        id: 'r',
        contractId: 'c',
        kind: 'reverse',
        amountCents: '100',
        reverseOf: 'b',
        payload: {},
        createdAt: '2026-11-01T00:00:00Z',
      },
    ] as never;
    const r = calculateReport(s, query);
    expect(r.summary.depositCents).toBe('9007199254740993');
    expect(r.lines.deposits[0]).toMatchObject({
      openingCents: '9007199254740993',
      movementCents: '-100',
      closingCents: '9007199254740893',
    });
    expect(r.summary.netCents).toBe('0');
  });
  it('counts accepted procurement accrual and payment reversal once, excluding draft order totals', () => {
    const s = base();
    s.purchaseOrders = [
      {
        id: 'o',
        number: 'O',
        title: 'PO',
        amountCents: '10000',
        acceptedCents: '6000',
        paidCents: '1000',
        createdAt: '2026-10-01T00:00:00Z',
      },
    ] as never;
    s.purchaseLedger = [
      { id: 'a', orderId: 'o', type: 'accrual', amountCents: '6000' },
      { id: 'p', orderId: 'o', type: 'payment', amountCents: '2000' },
      { id: 'r', orderId: 'o', type: 'paymentReversal', amountCents: '1000' },
    ] as never;
    const r = calculateReport(s, query);
    expect(r.summary.supplierPayableCents).toBe('5000');
    expect(r.lines.payables[0].amountCents).toBe('6000');
    expect(r.checks.every((x) => x.differenceCents === '0')).toBe(true);
  });
});

it('includes only confirmed lease debts and settlements and keeps advances separate', () => {
  const s = base();
  s.settlements = [
    {
      id: 'due',
      status: 'due',
      amountCents: '-100000',
      number: 'D',
      payload: { contractId: 'c' },
    },
    {
      id: 'unconfirmed',
      status: 'confirmation',
      amountCents: '90000',
      number: 'PENDING',
      payload: { contractId: 'c' },
    },
    {
      id: 'ap',
      status: 'partial',
      amountCents: '100000',
      number: 'AP',
      payload: { contractId: 'c' },
    },
  ] as never;
  s.payments = [
    {
      id: 'p',
      settlementId: 'ap',
      reference: 'P',
      payload: { amount: '400.00' },
    },
  ];
  s.leaseEntries = [
    {
      id: 'charge',
      contractId: 'c',
      kind: 'charge',
      amountCents: '50000',
      payload: {},
      reverseOf: null,
    },
    {
      id: 'confirm',
      contractId: 'c',
      kind: 'confirmCharge',
      sourceId: 'charge',
      amountCents: '0',
      payload: {},
      reverseOf: null,
    },
    {
      id: 'collect',
      contractId: 'c',
      kind: 'collect',
      sourceId: 'charge',
      amountCents: '10000',
      payload: {},
      reverseOf: null,
    },
    {
      id: 'deduct',
      contractId: 'c',
      kind: 'deduct',
      sourceId: 'charge',
      amountCents: '5000',
      payload: {},
      reverseOf: null,
    },
    {
      id: 'duecol',
      contractId: 'c',
      kind: 'collect',
      sourceId: 'due',
      amountCents: '30000',
      payload: {},
      reverseOf: null,
    },
    {
      id: 'draft',
      contractId: 'c',
      kind: 'charge',
      amountCents: '999999',
      payload: {},
      reverseOf: null,
    },
  ] as never;
  s.receipts = [
    {
      id: 'r',
      number: 'R',
      amountCents: '5000',
      status: 'received',
      unusedCents: '5000',
      allocatedCents: '0',
      refundedCents: '0',
    },
  ] as never;
  const r = calculateReport(s, query);
  expect(r.summary).toMatchObject({
    receivableCents: '105000',
    merchantPayableCents: '60000',
    advanceCents: '5000',
  });
  expect(r.lines.receivables).toHaveLength(2);
  expect(r.lines.payables).toHaveLength(1);
});
it('sums every issued source beyond a list page instead of capping totals', () => {
  const s = base();
  s.bills = Array.from({ length: 121 }, (_, i) => ({
    id: String(i),
    number: 'B' + i,
    contractId: 'c',
    status: 'issued',
    amountCents: '100',
    depositCents: '0',
    allocatedCents: '0',
    remainingCents: '100',
    createdAt: '2026-10-01T00:00:00Z',
    dueDate: '2026-10-31',
  })) as never;
  expect(calculateReport(s, query).summary.receivableCents).toBe('12100');
});
