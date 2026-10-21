import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { billValuesSchema, receiptSchema } from '../../server/billing/model.js';
import { checkoutSchema } from '../../server/cashier/model.js';
it('accepts an omitted source number for a manual bill fee', () => {
  const value = billValuesSchema.parse({
    month: '2026-08',
    part: 'month',
    dueDate: '2026-08-31',
    fees: [],
    readings: [],
    others: [
      { title: '维修费', amount: '100', reason: '维修', evidence: '工单确认' },
    ],
  });
  expect(value.others[0].reference).toBe('');
});
it('requires bank payment references but allows cash and other receipts without one', () => {
  const value = {
    requestId: randomUUID(),
    contractId: randomUUID(),
    expectedLeaseVersion: 0,
    date: '2026-08-31',
    amount: '100',
    evidence: '收款登记',
  };
  for (const method of ['cash', 'other'])
    expect(receiptSchema.safeParse({ ...value, method }).success).toBe(true);
  expect(receiptSchema.safeParse({ ...value, method: 'bank' }).success).toBe(
    false,
  );
  expect(
    receiptSchema.safeParse({ ...value, method: 'bank', reference: 'BANK-001' })
      .success,
  ).toBe(true);
});
it('gives cashier cash payments stable internal numbers while retaining bank validation', () => {
  const contractId = randomUUID(),
    key = randomUUID();
  const value = {
    merchantId: randomUUID(),
    date: '2026-08-31',
    targets: [
      {
        billId: randomUUID(),
        contractId,
        expectedBillVersion: 0,
        expectedLeaseVersion: 0,
        amount: '100',
      },
    ],
    payments: [
      {
        key,
        method: 'cash',
        amount: '100',
        evidence: '现金收讫',
        splits: [{ contractId, amount: '100' }],
      },
    ],
  };
  const first = checkoutSchema.parse(value);
  expect(first.payments[0].reference).toBe('SK-' + key);
  expect(checkoutSchema.parse(value).payments[0].reference).toBe(
    first.payments[0].reference,
  );
  expect(
    checkoutSchema.safeParse({
      ...value,
      payments: [{ ...value.payments[0], method: 'bank' }],
    }).success,
  ).toBe(false);
});
