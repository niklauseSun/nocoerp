import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Access } from '../hyl/service.js';
import { fail } from '../hyl/service.js';
import { cents } from '../hyl/calculation.js';
import { getLease } from '../leases/model.js';
import {
  assertCashReference,
  liveCash,
  recalculateBill,
  recalculateReceipt,
} from './accounting.js';
import type { BillingService } from './service.js';
import type {
  BillingAction,
  BillingOperation,
  Receipt,
  ReceiptEntry,
  receiptSchema,
} from './model.js';

export async function recordReceipt(
  this: BillingService,
  access: Access,
  body: z.infer<typeof receiptSchema>,
) {
  return this.mutate(
    access,
    body.contractId,
    'receiptReceive',
    body,
    async (c, contract) => {
      this.version(await getLease(c, contract), body.expectedLeaseVersion);
      if (cents(body.amount) <= 0n)
        fail('PAYMENT_REQUIRED', 'INVALID_ARGUMENT');
      const reference = body.reference || `SK-${body.requestId}`;
      await assertCashReference(c, contract.merchantId, reference);
      const id = randomUUID(),
        now = new Date().toISOString();
      const created = await this.hyl.runtime.create(
        'hylReceipts',
        {
          id,
          number: `SK-${body.date.replaceAll('-', '')}-${id.slice(0, 8)}`,
          contractId: contract.id,
          merchantId: contract.merchantId,
          version: 0,
          date: body.date,
          reference,
          amountCents: cents(body.amount).toString(),
          allocatedCents: '0',
          refundedCents: '0',
          unusedCents: cents(body.amount).toString(),
          payload: {
            method: body.method,
            evidence: body.evidence,
            notes: body.notes,
            actor: access.actor,
          },
          createdAt: now,
          updatedAt: now,
        },
        { actor: { id: access.actor }, transaction: c },
      );
      await this.audit(c, contract.id, access, 'receive', {
        receiptId: id,
        reference,
      });
      return created.record as unknown as Receipt;
    },
  );
}
export async function operateReceipt(
  this: BillingService,
  access: Access,
  id: string,
  action: string,
  body: BillingOperation,
) {
  const original = await this.findReceipt(id);
  const permission: BillingAction =
    action === 'allocate'
      ? 'receiptAllocate'
      : action === 'refund'
        ? 'receiptRefund'
        : 'receiptReverse';
  if (['allocate', 'reverseAllocation'].includes(action))
    await this.parent(access, original.contractId, 'billingRead');
  return this.mutate(
    access,
    original.contractId,
    permission,
    Object.assign({}, body, { receiptId: id, operation: action }),
    async (c, contract) => {
      let receipt = await this.findReceipt(id, c);
      this.version(receipt, body.expectedVersion);
      if (receipt.status === 'voided') fail('BILLING_RECEIPT_VOIDED');
      const entries = await c
        .repository<ReceiptEntry>('hylReceiptEntries')
        .findMany({ filter: { receiptId: id } });
      const affected = new Set<string>();
      const append = async (
        kind: string,
        amount: string,
        billId = '',
        reverseOf: string | null = null,
        reference: string | null = null,
      ) => {
        const entry: ReceiptEntry = {
          id: randomUUID(),
          receiptId: id,
          contractId: contract.id,
          merchantId: contract.merchantId,
          kind,
          amountCents: amount,
          billId,
          reverseOf,
          reference,
          payload: { ...body, actor: access.actor },
          createdAt: new Date().toISOString(),
        };
        await c
          .repository<ReceiptEntry>('hylReceiptEntries')
          .createOne({ values: entry });
      };
      if (action === 'allocate') {
        const ids = body.allocations.map((a) => a.billId);
        if (!ids.length || new Set(ids).size !== ids.length)
          fail('BILLING_ALLOCATION_REQUIRED', 'INVALID_ARGUMENT');
        const sum = body.allocations.reduce((n, a) => n + cents(a.amount), 0n);
        if (sum > BigInt(receipt.unusedCents)) fail('BILLING_INSUFFICIENT');
        for (const allocation of body.allocations) {
          const bill = await this.findBill(allocation.billId, c);
          if (bill.contractId !== contract.id)
            fail('RECORD_NOT_FOUND', 'NOT_FOUND');
          this.version(bill, allocation.expectedBillVersion);
          if (bill.status !== 'issued') fail('BILLING_NOT_ISSUED');
          if (cents(allocation.amount) <= 0n)
            fail('PAYMENT_REQUIRED', 'INVALID_ARGUMENT');
          if (cents(allocation.amount) > BigInt(bill.remainingCents))
            fail('OVERPAYMENT');
          await append(
            'allocate',
            cents(allocation.amount).toString(),
            bill.id,
          );
          affected.add(bill.id);
        }
      } else if (action === 'refund') {
        this.reason(body);
        if (!body.date || !body.reference || cents(body.amount) <= 0n)
          fail('PAYMENT_REQUIRED', 'INVALID_ARGUMENT');
        if (cents(body.amount) > BigInt(receipt.unusedCents))
          fail('BILLING_INSUFFICIENT');
        await assertCashReference(c, contract.merchantId, body.reference);
        await append(
          'refund',
          cents(body.amount).toString(),
          '',
          null,
          body.reference,
        );
      } else if (['reverseAllocation', 'reverseRefund'].includes(action)) {
        this.reason(body);
        const target = liveCash(entries).find(
          (e) =>
            e.id === body.sourceId &&
            e.kind === (action === 'reverseAllocation' ? 'allocate' : 'refund'),
        );
        if (!target) fail('BILLING_REVERSAL_SOURCE');
        if (target.billId) {
          const bill = await this.findBill(target.billId, c);
          if (bill.contractId !== contract.id || bill.status !== 'issued')
            fail('BILLING_REVERSAL_SOURCE');
          affected.add(target.billId);
        }
        await append(action, target.amountCents, target.billId, target.id);
      } else if (action === 'void') {
        this.reason(body);
        if (
          liveCash(entries).some((e) => ['allocate', 'refund'].includes(e.kind))
        )
          fail('BILLING_HAS_ALLOCATIONS');
        await this.hyl.runtime.fire('hylReceipts', id, 'void', {
          actor: { id: access.actor },
          transaction: c,
          expect: { version: receipt.lifecycleVersion },
        });
        await append('void', '0');
      } else fail('INVALID_ACTION', 'INVALID_ARGUMENT');
      for (const billId of affected) await recalculateBill(c, billId);
      receipt = await recalculateReceipt(c, id);
      await this.audit(c, contract.id, access, action, {
        receiptId: id,
        ...body,
      });
      return receipt;
    },
  );
}
