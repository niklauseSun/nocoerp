import { z } from 'zod';
import { defineLifecycle, type LifecycleTypes } from '@nocobase/lifecycle';
import { amount, date } from '../hyl/schema.js';
export const splitActions = [
  'splitRead',
  'splitConfigure',
  'splitReview',
  'splitExecute',
  'splitRecover',
] as const;
const id = z.string().uuid(),
  text = z.string().trim().min(1).max(500);
export const recipientSchema = z
  .object({
    key: id,
    kind: z.enum(['project', 'partner']),
    name: z.string().trim().min(1).max(100),
    accountLabel: z.string().trim().min(1).max(100),
    rate: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/),
  })
  .strict();
export const ruleValues = z
  .object({
    copyFromRuleId: id.optional(),
    enabled: z.boolean(),
    effectiveFrom: date,
    billFeeTypes: z
      .array(
        z.enum(['rent', 'property', 'water', 'electricity', 'gas', 'other']),
      )
      .max(6),
    recipients: z.array(recipientSchema).min(1).max(11),
    notes: z.string().trim().max(1000).default(''),
  })
  .strict();
export const ruleInput = ruleValues
  .extend({ requestId: id, expectedVersion: z.number().int().min(0) })
  .strict();
export const sourceInput = z
  .object({ sourceKind: z.enum(['bill', 'settlement']), sourceId: id })
  .strict();
export const backfillInput = sourceInput
  .extend({ requestId: id, sourceHash: z.string().length(64), reason: text })
  .strict();
export const actionInput = z
  .object({
    requestId: id,
    expectedVersion: z.number().int().min(0),
    sourceHash: z.string().length(64).optional(),
    recipientKey: z.string().max(100).optional(),
    amount: amount.default('0'),
    date: date.optional(),
    method: z.enum(['bank', 'cash', 'other']).default('bank'),
    reference: z.string().trim().max(100).default(''),
    evidence: z.string().trim().max(500).default(''),
    reason: z.string().trim().max(500).default(''),
    notes: z.string().trim().max(1000).default(''),
    result: z.enum(['success', 'failed']).optional(),
    failureReason: z.string().trim().max(500).default(''),
    transferId: id.optional(),
    expectedSettlementVersion: z.number().int().min(0).optional(),
  })
  .strict();
export const listInput = z.object({
  q: z.string().trim().max(100).default(''),
  contractId: id.optional(),
  sourceId: id.optional(),
  cashierOrderId: id.optional(),
  sourceKind: z.enum(['bill', 'settlement']).optional(),
  status: z.string().max(30).default(''),
  enabled: z.enum(['true', 'false']).optional(),
  from: date.optional(),
  to: date.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  orderBy: z
    .enum([
      'updatedAt',
      '-updatedAt',
      'createdAt',
      '-createdAt',
      'sourceFundsCents',
      '-sourceFundsCents',
      'netPaidCents',
      '-netPaidCents',
      'remainingCents',
      '-remainingCents',
      'recoveryCents',
      '-recoveryCents',
      'effectiveFrom',
      '-effectiveFrom',
      'version',
      '-version',
    ])
    .default('-updatedAt'),
});
export type RuleValues = z.infer<typeof ruleValues>;
export type RuleInput = z.infer<typeof ruleInput>;
export type ActionInput = z.infer<typeof actionInput>;
export type SourceInput = z.infer<typeof sourceInput>;
export type ListInput = z.infer<typeof listInput>;
export interface Rule {
  id: string;
  contractId: string;
  merchantId: string;
  version: number;
  effectiveFrom: string;
  enabled: boolean;
  payload: RuleValues;
  actor: string;
  createdAt: string;
  updatedAt: string;
  searchText: string;
}
export interface Line {
  key: string;
  kind: string;
  name: string;
  accountLabel: string;
  rate: string;
  targetCents: string;
  grossPaidCents: string;
  recoveredCents: string;
  netPaidCents: string;
  remainingCents: string;
  recoveryCents: string;
}
export interface Snapshot {
  sourceKind: 'bill' | 'settlement';
  sourceId: string;
  sourceNumber: string;
  sourceStart: string;
  contractId: string;
  contractNumber: string;
  merchantId: string;
  merchantName: string;
  rule: Rule;
  sourceFundsCents: string;
  shareBaseCents: string;
  retainedTargetCents: string;
  costTargetCents: string;
  fundingGapCents: string;
  grossPaidCents: string;
  recoveredCents: string;
  netPaidCents: string;
  remainingCents: string;
  recoveryCents: string;
  lines: Line[];
  sources: {
    id: string;
    kind: string;
    number: string;
    amountCents: string;
    allocationId?: string;
  }[];
  operatingComposition?: Record<string, string>;
  feeComposition?: {
    id: string;
    feeType: string;
    amountCents: string;
    cashCents: string;
    included: boolean;
  }[];
  excludedDepositCents?: string;
  sourceHash: string;
  sourceVersion: number;
}
export interface Order {
  id: string;
  number: string;
  contractId: string;
  merchantId: string;
  sourceKind: 'bill' | 'settlement';
  sourceId: string;
  activeRevision: number;
  status: string;
  version: number;
  lifecycleVersion: number;
  statusChangedAt: string;
  sourceHash: string;
  sourceFundsCents: string;
  netPaidCents: string;
  remainingCents: string;
  recoveryCents: string;
  payload: { snapshot: Snapshot; reviewedHash: string; history?: unknown[] };
  searchText: string;
  createdAt: string;
  updatedAt: string;
}
export interface Transfer {
  id: string;
  orderId: string;
  contractId: string;
  merchantId: string;
  recipientKey: string;
  kind: string;
  amountCents: string;
  reference: string | null;
  sourceTransferId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}
export const splitStates = [
  'pendingReview',
  'ready',
  'partiallyExecuted',
  'completed',
  'adjustmentPending',
  'cancelled',
] as const;
export const splitLifecycle = defineLifecycle<LifecycleTypes>({
  name: 'hylSplitOrders',
  initial: 'pendingReview',
  states: [...splitStates],
  transitions: {
    refresh: {
      from: [...splitStates],
      to: [...splitStates],
      route: ({ input }) =>
        typeof input.state === 'string' ? input.state : 'pendingReview',
    },
  },
});
