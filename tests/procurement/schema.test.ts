import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  receiptValues,
  requestValues,
  orderAction,
  supplierValues,
} from '../../server/procurement/schema.js';
describe('purchase input boundaries', () => {
  const id = randomUUID(),
    op = { requestId: randomUUID(), expectedVersion: 0 },
    day = '2026-10-19';
  it.each(['0', '-1', '1.001', '1e2'])(
    'rejects invalid positive price %s',
    (unitPrice) => {
      expect(
        requestValues.safeParse({
          title: 'Parts',
          assetId: id,
          neededOn: day,
          reason: 'Repair',
          items: [{ name: 'Lamp', unit: 'each', quantity: 1, unitPrice }],
        }).success,
      ).toBe(false);
    },
  );
  it('requires a reason for rejected goods', () => {
    const v = {
      orderId: id,
      day,
      evidence: 'Counted',
      lines: [{ itemId: 'item-1', delivered: 2, accepted: 1 }],
    };
    expect(receiptValues.safeParse(v).success).toBe(false);
    expect(receiptValues.safeParse({ ...v, notes: 'Broken' }).success).toBe(
      true,
    );
  });
  it('rejects duplicate item IDs and over-acceptance', () => {
    const line = { itemId: 'item-1', delivered: 1, accepted: 1 };
    expect(
      receiptValues.safeParse({
        orderId: id,
        day,
        evidence: 'Demo',
        lines: [line, line],
      }).success,
    ).toBe(false);
    expect(
      receiptValues.safeParse({
        orderId: id,
        day,
        evidence: 'Demo',
        lines: [{ ...line, accepted: 2 }],
      }).success,
    ).toBe(false);
  });
  it('rejects unknown action inputs and negative versions', () => {
    expect(
      orderAction.safeParse({
        ...op,
        action: 'pay',
        day,
        amount: '1',
        reference: 'P',
        channel: 'bank',
        evidence: 'Demo',
        realPayment: true,
      }).success,
    ).toBe(false);
    expect(
      orderAction.safeParse({
        ...op,
        expectedVersion: -1,
        action: 'settle',
        note: 'Done',
      }).success,
    ).toBe(false);
  });
  it('validates supplier tax identifier and trims names', () => {
    const v = {
      projectId: id,
      name: ' Supplier ',
      contact: 'A',
      phone: '0',
      supplyScope: 'Parts',
    };
    expect(supplierValues.parse(v).name).toBe('Supplier');
    expect(
      supplierValues.safeParse({ ...v, taxNumber: 'invalid' }).success,
    ).toBe(false);
  });
});
