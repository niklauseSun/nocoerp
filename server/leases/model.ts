import type { DatabaseConnection } from '@nocobase/db';
import { defineLifecycle, type LifecycleTypes } from '@nocobase/lifecycle';
import { z } from 'zod';
import { amount, date, contractSchema, type Row } from '../hyl/schema.js';
import { cents } from '../hyl/calculation.js';

export const leaseLifecycle = defineLifecycle<LifecycleTypes>({
  name: 'hylLeases',
  initial: 'active',
  states: ['active', 'terminated', 'closed'],
  transitions: {
    terminate: { from: 'active', to: 'terminated' },
    closeLease: { from: 'terminated', to: 'closed' },
    reopenLease: { from: 'closed', to: 'terminated' },
  },
});
export interface Lease {
  id: string;
  merchantId: string;
  status: string;
  version: number;
  actualEnd: string;
  lifecycleVersion: number;
  statusChangedAt: string;
  payload: Record<string, unknown>;
}
export interface Entry {
  id: string;
  contractId: string;
  merchantId: string;
  requestId: string;
  reference: string | null;
  kind: string;
  amountCents: string;
  sourceId: string;
  reverseOf: string | null;
  pairId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
export const actions = [
  'depositRead',
  'depositReceive',
  'depositDeduct',
  'depositRefund',
  'depositTransfer',
  'depositReverse',
  'renew',
  'terminate',
  'closeLease',
  'reopenLease',
  'collectionReceive',
  'collectionReverse',
  'chargeWrite',
  'chargeConfirm',
] as const;
export type LeaseAction = (typeof actions)[number];
export const operationSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedVersion: z.number().int().min(0),
    amount: amount.default('0'),
    date: date.optional(),
    reference: z.string().trim().max(100).default(''),
    method: z.enum(['bank', 'cash', 'other']).default('bank'),
    evidence: z.string().trim().max(500).default(''),
    notes: z.string().trim().max(1000).default(''),
    reason: z.string().trim().max(500).default(''),
    title: z.string().trim().max(100).default(''),
    sourceId: z.string().uuid().optional(),
    actualEnd: date.optional(),
    handover: z.string().trim().max(1000).default(''),
    values: contractSchema.optional(),
  })
  .strict();
export type Operation = z.infer<typeof operationSchema>;
export async function getLease(
  c: DatabaseConnection,
  contract: Row,
): Promise<Lease> {
  return (
    (await c
      .repository<Lease>('hylLeases')
      .findOne({ filter: { id: contract.id } })) ?? {
      id: contract.id,
      merchantId: contract.merchantId,
      status: 'active',
      version: 0,
      actualEnd: '',
      lifecycleVersion: 0,
      statusChangedAt: contract.createdAt,
      payload: {},
    }
  );
}
export async function effectiveEnd(
  c: DatabaseConnection,
  contract: Row,
): Promise<string> {
  const lease = await getLease(c, contract);
  return lease.actualEnd && lease.actualEnd < String(contract.payload.end)
    ? lease.actualEnd
    : String(contract.payload.end);
}
export function effectiveEntries(entries: Entry[]) {
  const reversed = new Set(
    entries.filter((e) => e.reverseOf).map((e) => e.reverseOf),
  );
  return entries.filter((e) => !e.reverseOf && !reversed.has(e.id));
}
export function depositBalance(entries: Entry[]): bigint {
  return effectiveEntries(entries).reduce(
    (sum, e) =>
      ['receive', 'transferIn'].includes(e.kind)
        ? sum + BigInt(e.amountCents)
        : ['deduct', 'refund', 'transferOut'].includes(e.kind)
          ? sum - BigInt(e.amountCents)
          : sum,
    0n,
  );
}
export const money = (n: bigint) =>
  `${n < 0n ? '-' : ''}${(n < 0n ? -n : n) / 100n}.${String((n < 0n ? -n : n) % 100n).padStart(2, '0')}`;
export const positive = (v: string) => cents(v) > 0n;

export function displayLeaseState(lease: Lease, contract: Row, today: string) {
  return lease.status === 'active'
    ? String(contract.payload.start) > today
      ? 'future'
      : String(contract.payload.end) < today
        ? 'expired'
        : 'active'
    : lease.status;
}
