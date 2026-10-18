import { z } from 'zod';
import { defineLifecycle, type LifecycleTypes } from '@nocobase/lifecycle';
import { amount, date } from '../hyl/schema.js';
export const actions = [
  'cashierRead',
  'cashierCheckout',
  'cashierRefund',
  'cashierReverse',
  'cashierReconcileRead',
  'cashierReconcile',
  'cashierReconcileAll',
] as const;
const id = z.string().uuid(),
  text = z.string().trim().min(1).max(500),
  version = z.number().int().min(0);
export const checkoutSchema = z
  .object({
    merchantId: id,
    date,
    notes: z.string().trim().max(1000).default(''),
    targets: z
      .array(
        z
          .object({
            billId: id,
            contractId: id,
            expectedBillVersion: version,
            expectedLeaseVersion: version,
            amount,
            deposit: amount.default('0'),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    payments: z
      .array(
        z
          .object({
            key: id,
            method: z.enum(['bank', 'cash', 'other']),
            amount,
            reference: z.string().trim().min(1).max(100),
            evidence: text,
            splits: z
              .array(z.object({ contractId: id, amount }).strict())
              .min(1)
              .max(50),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();
export const writeOrderSchema = checkoutSchema
  .extend({ requestId: id, expectedVersion: version.optional() })
  .strict();
export const operationSchema = z
  .object({
    requestId: id,
    expectedVersion: version,
    reason: text,
    evidence: text,
  })
  .strict();
export const refundSchema = z
  .object({
    requestId: id,
    date,
    reference: z.string().trim().min(1).max(100),
    reason: text,
    evidence: text,
    notes: z.string().trim().max(1000).default(''),
    sources: z
      .array(
        z
          .object({
            receiptId: id,
            expectedVersion: version,
            amount,
            method: z.enum(['bank', 'cash', 'other']),
            allocations: z
              .array(
                z
                  .object({ entryId: id, amount, expectedBillVersion: version })
                  .strict(),
              )
              .max(50)
              .default([]),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
export const dayQuery = z.object({
  day: date,
  scope: z.enum(['own', 'authorized']).default('own'),
});
export const reconcileSchema = dayQuery
  .extend({
    requestId: id,
    sourceHash: z.string().length(64),
    countedCash: amount,
    evidence: text,
    differenceReason: z.string().trim().max(500).default(''),
    notes: z.string().trim().max(1000).default(''),
  })
  .strict();
export const listSchema = z.object({
  q: z.string().trim().max(100).default(''),
  merchantId: id.optional(),
  status: z.string().max(30).default(''),
  method: z.enum(['bank', 'cash', 'other']).optional(),
  from: date.optional(),
  to: date.optional(),
  scope: z.enum(['own', 'authorized']).default('own'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .enum([
      'updatedAt',
      'createdAt',
      'receivedCents',
      'allocatedCents',
      'refundedCents',
      'unusedCents',
      'amountCents',
      'netCents',
      'differenceCents',
      'day',
      'revision',
    ])
    .default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type Checkout = z.infer<typeof checkoutSchema>;
export type OrderInput = z.infer<typeof writeOrderSchema>;
export type RefundInput = z.infer<typeof refundSchema>;
export type DayQuery = z.infer<typeof dayQuery>;
export type ReconcileInput = z.infer<typeof reconcileSchema>;
export type ListInput = z.infer<typeof listSchema>;
export type Operation = z.infer<typeof operationSchema>;
export interface CashierRecord {
  id: string;
  number: string;
  merchantId: string;
  status: string;
  version: number;
  lifecycleVersion: number;
  statusChangedAt: string;
  day: string;
  actor: string;
  receivedCents: string;
  allocatedCents: string;
  refundedCents: string;
  unusedCents: string;
  amountCents: string;
  netCents: string;
  differenceCents: string;
  revision: number;
  searchText: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
export interface Member {
  id: string;
  recordId: string;
  contractId: string;
  kind: string;
  sourceId: string;
}
export interface Reference {
  id: string;
  merchantId: string;
  reference: string;
  recordId: string;
  createdAt: string;
}
export const orderLifecycle = defineLifecycle<LifecycleTypes>({
  name: 'hylCashierOrders',
  initial: 'draft',
  states: ['draft', 'posted', { name: 'voided', final: true }],
  transitions: {
    post: { from: 'draft', to: 'posted' },
    void: { from: ['draft', 'posted'], to: 'voided' },
  },
});
export const reconciliationLifecycle = defineLifecycle<LifecycleTypes>({
  name: 'hylCashierReconciliations',
  initial: 'confirmed',
  states: [{ name: 'confirmed', final: true }],
  transitions: {},
});
