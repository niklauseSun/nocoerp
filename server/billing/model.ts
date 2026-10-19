import { z } from 'zod';
import { defineLifecycle, type LifecycleTypes } from '@nocobase/lifecycle';
import { amount, date } from '../hyl/schema.js';

export const billingActions = [
  'billingRead',
  'billingConfigure',
  'billWrite',
  'billIssue',
  'billVoid',
  'receiptRead',
  'receiptReceive',
  'receiptAllocate',
  'receiptReverse',
  'receiptRefund',
] as const;
export type BillingAction = (typeof billingActions)[number];
export const decimal = z
  .string()
  .trim()
  .regex(/^(?:\d{1,12}(?:\.\d{1,4})?|\.\d{1,4})$/);
export const utilityTypes = ['water', 'electricity', 'gas'] as const;
export const feeTypes = ['rent', 'property', ...utilityTypes, 'other'] as const;
const text = (max: number) => z.string().trim().max(max).default('');
export const meterSchema = z
  .object({
    assetId: z.string().uuid(),
    meterCode: z.string().trim().min(1).max(100),
    feeType: z.enum(utilityTypes),
    activeFrom: date,
    activeTo: date.optional(),
    openingReading: decimal,
    openingEvidence: z.string().trim().min(1).max(500),
    stopReading: decimal.optional(),
    stopEvidence: text(500),
  })
  .strict();
export const configValuesSchema = z
  .object({
    effectiveFrom: date,
    rentChannel: z.enum(['settlement', 'bill']),
    property: z
      .object({
        enabled: z.boolean(),
        method: z.enum(['fixed', 'area']),
        price: decimal,
      })
      .strict(),
    utilities: z
      .object({
        water: decimal.optional(),
        electricity: decimal.optional(),
        gas: decimal.optional(),
      })
      .strict(),
    meters: z.array(meterSchema).max(50),
    notes: text(1000),
  })
  .strict();
export const configSchema = configValuesSchema
  .extend({
    requestId: z.string().uuid(),
    expectedVersion: z.number().int().min(0),
  })
  .strict();
export type ConfigValues = z.infer<typeof configValuesSchema>;
export interface BillingConfig {
  id: string;
  contractId: string;
  merchantId: string;
  version: number;
  effectiveFrom: string;
  payload: ConfigValues;
  createdAt: string;
}
export const readingSchema = z
  .object({
    assetId: z.string().uuid(),
    meterCode: z.string().trim().min(1).max(100),
    feeType: z.enum(utilityTypes),
    start: date,
    end: date,
    previous: decimal,
    current: decimal,
    multiplier: decimal.default('1'),
    evidence: z.string().trim().min(1).max(500),
    notes: text(1000),
  })
  .strict();
export const billValuesSchema = z
  .object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    part: z.enum(['month', 'first', 'second']),
    dueDate: date,
    fees: z
      .array(z.enum(feeTypes))
      .max(6)
      .refine((v) => new Set(v).size === v.length),
    readings: z.array(readingSchema).max(50),
    readingIds: z.array(z.uuid()).max(50).optional(),
    others: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(100),
            amount,
            reference: z.string().trim().min(1).max(100),
            reason: z.string().trim().min(1).max(500),
            evidence: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .max(30),
    acknowledgeGaps: z.boolean().default(false),
    zeroReason: text(500),
    zeroEvidence: text(500),
    notes: text(1000),
  })
  .strict();
export type BillValues = z.infer<typeof billValuesSchema>;
export const billCreateSchema = billValuesSchema
  .extend({
    requestId: z.string().uuid(),
    contractId: z.string().uuid(),
    expectedContractVersion: z.number().int().min(0),
    configVersion: z.number().int().min(1),
  })
  .strict();
export const billEditSchema = billValuesSchema
  .extend({
    requestId: z.string().uuid(),
    expectedVersion: z.number().int().min(0),
    configVersion: z.number().int().min(1),
  })
  .strict();
export const operationSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedVersion: z.number().int().min(0),
    amount: amount.default('0'),
    date: date.optional(),
    reference: text(100),
    reason: text(500),
    evidence: text(500),
    expectedLeaseVersion: z.number().int().min(0).optional(),
    sourceId: z.string().uuid().optional(),
    allocations: z
      .array(
        z
          .object({
            billId: z.string().uuid(),
            expectedBillVersion: z.number().int().min(0),
            amount,
          })
          .strict(),
      )
      .max(50)
      .default([]),
  })
  .strict();
export type BillingOperation = z.infer<typeof operationSchema>;
export const receiptSchema = z
  .object({
    requestId: z.string().uuid(),
    contractId: z.string().uuid(),
    expectedLeaseVersion: z.number().int().min(0),
    date,
    amount,
    method: z.enum(['bank', 'cash', 'other']),
    reference: z.string().trim().min(1).max(100),
    evidence: z.string().trim().min(1).max(500),
    notes: text(1000),
  })
  .strict();
export const listSchema = z
  .object({
    q: z.string().trim().max(100).default(''),
    contractId: z.string().uuid().optional(),
    merchantId: z.string().uuid().optional(),
    status: z.string().max(30).default(''),
    feeType: z.enum(feeTypes).optional(),
    overdue: z.enum(['true', 'false']).optional(),
    from: date.optional(),
    to: date.optional(),
    orderBy: z.string().max(50).default('updatedAt:desc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type BillingList = z.infer<typeof listSchema>;
export interface Bill {
  id: string;
  number: string;
  contractId: string;
  merchantId: string;
  version: number;
  status: string;
  lifecycleVersion: number;
  statusChangedAt: string;
  cycleStart: string;
  cycleEnd: string;
  start: string;
  end: string;
  date: string;
  dueDate: string;
  amountCents: string;
  depositCents: string;
  allocatedCents: string;
  remainingCents: string;
  payload: {
    input: BillValues;
    configVersion: number;
    contract: Record<string, unknown>;
    config: ConfigValues;
    actor: string;
    notes: string;
  };
  createdAt: string;
  updatedAt: string;
}
export interface BillLine {
  id: string;
  billId: string;
  contractId: string;
  feeType: string;
  assetId: string;
  meterCode: string;
  start: string;
  end: string;
  sourceKey: string;
  amountCents: string;
  payload: Record<string, unknown>;
}
export interface Receipt {
  id: string;
  number: string;
  contractId: string;
  merchantId: string;
  version: number;
  status: string;
  date: string;
  reference: string;
  amountCents: string;
  allocatedCents: string;
  refundedCents: string;
  unusedCents: string;
  lifecycleVersion: number;
  statusChangedAt: string;
  payload: {
    method: string;
    evidence: string;
    notes: string;
    actor: string;
    originalReference?: string;
    cashierOrderId?: string;
  };
  createdAt: string;
  updatedAt: string;
}
export interface ReceiptEntry {
  id: string;
  receiptId: string;
  contractId: string;
  merchantId: string;
  kind: string;
  amountCents: string;
  billId: string;
  reverseOf: string | null;
  reference: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}
export const billLifecycle = defineLifecycle<LifecycleTypes>({
  name: 'hylBills',
  initial: 'draft',
  states: ['draft', 'issued', { name: 'voided', final: true }],
  transitions: {
    issue: { from: 'draft', to: 'issued' },
    void: { from: ['draft', 'issued'], to: 'voided' },
  },
});
export const receiptLifecycle = defineLifecycle<LifecycleTypes>({
  name: 'hylReceipts',
  initial: 'received',
  states: ['received', { name: 'voided', final: true }],
  transitions: { void: { from: 'received', to: 'voided' } },
});
export function billStatus(row: Bill) {
  return row.status !== 'issued'
    ? row.status
    : BigInt(row.remainingCents) === 0n
      ? 'paid'
      : BigInt(row.remainingCents) === BigInt(row.amountCents)
        ? 'unpaid'
        : 'partial';
}
export function receiptStatus(row: Receipt) {
  return row.status === 'voided'
    ? 'voided'
    : BigInt(row.refundedCents) === BigInt(row.amountCents)
      ? 'refunded'
      : BigInt(row.unusedCents) === 0n
        ? 'allocated'
        : BigInt(row.allocatedCents) > 0n || BigInt(row.refundedCents) > 0n
          ? 'partial'
          : 'unallocated';
}
