import { randomUUID } from 'node:crypto';
import type { RepositoryPolicy } from '@nocobase/db';
import { fail, type Access } from '../hyl/service.js';
import { BillingService } from '../billing/service.js';
import { liveCash } from '../billing/accounting.js';
import type { ReceiptEntry } from '../billing/model.js';
import { cents, money } from '../hyl/calculation.js';
import type { RefundInput, Operation, CashierRecord } from './model.js';
import type { CashierService } from './service.js';
import { uid } from './service.js';
export const refundRights = (input: RefundInput) => [
  'cashierRefund',
  'receiptRead',
  'receiptRefund',
  ...(input.sources.some((s) => s.allocations.length)
    ? ['receiptReverse', 'receiptAllocate', 'billingRead']
    : []),
];
export async function refundPreview(
  this: CashierService,
  access: Access,
  input: RefundInput,
  c = this.hyl.db.connection(),
  prepared?: Map<string, RepositoryPolicy>,
) {
  const policies =
      prepared ?? (await this.policies(access, refundRights(input))),
    sources = [];
  let merchantId = '';
  if (
    new Set(input.sources.map((s) => s.receiptId)).size !== input.sources.length
  )
    fail('CASHIER_DUPLICATE');
  for (const s of input.sources) {
    const receipt = await this.billing.findReceipt(s.receiptId, c);
    await this.contracts(access, [receipt.contractId], policies, c);
    if (receipt.status === 'voided') fail('BILLING_RECEIPT_VOIDED');
    this.billing.version(receipt, s.expectedVersion);
    if (merchantId && merchantId !== receipt.merchantId)
      fail('CASHIER_MERCHANT');
    merchantId = receipt.merchantId;
    if (receipt.payload.method !== s.method) fail('CASHIER_METHOD');
    if (cents(s.amount) <= 0n) fail('PAYMENT_REQUIRED');
    const entries = liveCash(
      await c
        .repository<ReceiptEntry>('hylReceiptEntries')
        .findMany({ filter: { receiptId: receipt.id } }),
    );
    if (
      new Set(s.allocations.map((a) => a.entryId)).size !== s.allocations.length
    )
      fail('CASHIER_DUPLICATE');
    let restored = 0n;
    for (const a of s.allocations) {
      const e = entries.find(
        (e) => e.id === a.entryId && e.kind === 'allocate',
      );
      if (
        !e ||
        cents(a.amount) <= 0n ||
        cents(a.amount) > BigInt(e.amountCents)
      )
        fail('BILLING_REVERSAL_SOURCE');
      const bill = await this.billing.findBill(e.billId, c);
      this.billing.version(bill, a.expectedBillVersion);
      if (bill.contractId !== receipt.contractId || bill.status !== 'issued')
        fail('BILLING_REVERSAL_SOURCE');
      restored += cents(a.amount);
    }
    if (
      restored > cents(s.amount) ||
      cents(s.amount) > BigInt(receipt.unusedCents) + restored
    )
      fail('BILLING_INSUFFICIENT');
    sources.push({
      receiptId: receipt.id,
      number: receipt.number,
      contractId: receipt.contractId,
      method: s.method,
      amountCents: String(cents(s.amount)),
      restoredCents: String(restored),
      unusedAfterCents: String(
        BigInt(receipt.unusedCents) + restored - cents(s.amount),
      ),
    });
  }
  return {
    merchantId,
    sources,
    amountCents: String(
      sources.reduce((n, s) => n + BigInt(s.amountCents), 0n),
    ),
    restoredCents: String(
      sources.reduce((n, s) => n + BigInt(s.restoredCents), 0n),
    ),
  };
}
export async function createRefund(
  this: CashierService,
  access: Access,
  input: RefundInput,
) {
  const policies = await this.policies(access, refundRights(input));
  const receipts = await Promise.all(
    input.sources.map((s) => this.billing.findReceipt(s.receiptId)),
  );
  await this.contracts(
    access,
    receipts.map((r) => r.contractId),
    policies,
  );
  const merchantId = receipts[0].merchantId;
  if (receipts.some((r) => r.merchantId !== merchantId))
    fail('CASHIER_MERCHANT');
  return this.atomic(
    access,
    input.requestId,
    { refund: input },
    merchantId,
    async (c) => {
      const preview = await this.refundPreview(access, input, c, policies);
      const wrapper = this.base(
        access,
        'TF',
        preview.merchantId,
        input.date,
        { input, preview, effects: [] },
        input.reference,
      );
      await this.reserve(c, preview.merchantId, input.reference, wrapper.id);
      const tx = new BillingService(this.hyl, {
        connection: c,
        policies,
        actor: access.actor,
        merchantId: preview.merchantId,
      });
      const effects = [];
      for (const s of input.sources) {
        let receipt = await tx.findReceipt(s.receiptId, c);
        for (const a of s.allocations) {
          const entry = (await c
            .repository<ReceiptEntry>('hylReceiptEntries')
            .findOne({ filter: { id: a.entryId } }))!;
          receipt = await tx.operateReceipt(
            access,
            receipt.id,
            'reverseAllocation',
            {
              requestId: randomUUID(),
              expectedVersion: receipt.version,
              sourceId: entry.id,
              amount: '0',
              reference: '',
              date: input.date,
              reason: input.reason,
              evidence: input.evidence,
              allocations: [],
            },
          );
          const replacement = BigInt(entry.amountCents) - cents(a.amount);
          if (replacement > 0n)
            receipt = await tx.operateReceipt(access, receipt.id, 'allocate', {
              requestId: randomUUID(),
              expectedVersion: receipt.version,
              amount: '0',
              reference: '',
              reason: input.reason,
              evidence: input.evidence,
              allocations: [
                {
                  billId: entry.billId,
                  expectedBillVersion: (await tx.findBill(entry.billId, c))
                    .version,
                  amount: money(replacement),
                },
              ],
            });
          await this.member(
            c,
            wrapper.id,
            receipt.contractId,
            'bill',
            entry.billId,
          );
        }
        const internalRef = randomUUID();
        receipt = await tx.operateReceipt(access, receipt.id, 'refund', {
          requestId: uid(input.requestId, receipt.id),
          expectedVersion: receipt.version,
          amount: s.amount,
          date: input.date,
          reference: internalRef,
          reason: input.reason,
          evidence: input.evidence,
          allocations: [],
        });
        const entry = (await c
          .repository<ReceiptEntry>('hylReceiptEntries')
          .findOne({
            filter: { receiptId: receipt.id, reference: internalRef },
          }))!;
        effects.push({
          receiptId: receipt.id,
          entryId: entry.id,
          contractId: receipt.contractId,
          amountCents: entry.amountCents,
        });
        await this.member(
          c,
          wrapper.id,
          receipt.contractId,
          'receipt',
          receipt.id,
        );
      }
      wrapper.amountCents = preview.amountCents;
      wrapper.refundedCents = preview.amountCents;
      wrapper.payload = { ...wrapper.payload, effects };
      await c
        .repository<CashierRecord>('hylCashierRefunds')
        .createOne({ values: wrapper });
      await this.audit(c, wrapper.id, access, 'refund', {
        reference: input.reference,
      });
      return wrapper;
    },
  );
}
export async function reverseRefund(
  this: CashierService,
  access: Access,
  id: string,
  body: Operation,
) {
  const wrapper = await this.guard(access, 'refunds', id, 'cashierReverse');
  const effects = wrapper.payload.effects as {
    receiptId: string;
    entryId: string;
    contractId: string;
  }[];
  const policies = await this.policies(access, [
    'cashierReverse',
    'receiptRead',
    'receiptReverse',
  ]);
  await this.contracts(
    access,
    effects.map((e) => e.contractId),
    policies,
  );
  return this.atomic(
    access,
    body.requestId,
    { reverseRefund: id, body },
    wrapper.merchantId,
    async (c) => {
      const current = await this.record('refunds', id, c);
      this.billing.version(current, body.expectedVersion);
      if (!['posted', 'partiallyCorrected'].includes(current.status))
        fail('BILLING_REVERSAL_SOURCE');
      const tx = new BillingService(this.hyl, {
        connection: c,
        policies,
        actor: access.actor,
        merchantId: wrapper.merchantId,
      });
      for (const e of effects) {
        const r = await tx.findReceipt(e.receiptId, c);
        if (
          await c
            .repository<ReceiptEntry>('hylReceiptEntries')
            .exists({ filter: { receiptId: r.id, reverseOf: e.entryId } })
        )
          continue;
        await tx.operateReceipt(access, r.id, 'reverseRefund', {
          ...body,
          expectedVersion: r.version,
          sourceId: e.entryId,
          reference: '',
          amount: '0',
          allocations: [],
        });
      }
      await c.repository('hylCashierRefunds').updateOne({
        filter: { id },
        values: {
          status: 'corrected',
          version: (await this.record('refunds', id, c)).version + 1,
          refundedCents: '0',
          payload: {
            ...current.payload,
            correction: {
              ...body,
              actor: access.actor,
              at: new Date().toISOString(),
            },
          },
          updatedAt: new Date().toISOString(),
        },
      });
      await this.audit(c, id, access, 'reverse', {
        reason: body.reason,
        evidence: body.evidence,
      });
      return this.record('refunds', id, c);
    },
  );
}
