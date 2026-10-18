import { z } from 'zod';
import { defineLifecycle, type LifecycleTypes } from '@nocobase/lifecycle';
export const kinds = [
  'suppliers',
  'requests',
  'orders',
  'receipts',
  'payments',
  'ledger',
] as const;
export type Kind = (typeof kinds)[number];
export const tables: Record<Kind, string> = {
  suppliers: 'hylPurchaseSuppliers',
  requests: 'hylPurchaseRequests',
  orders: 'hylPurchaseOrders',
  receipts: 'hylPurchaseReceipts',
  payments: 'hylPurchasePayments',
  ledger: 'hylPurchaseLedger',
};
export {
  supplierValues,
  requestValues,
  receiptValues,
  supplierAction,
  requestAction,
  orderAction,
  receiptAction,
  paymentAction,
} from './schema.js';
import {
  supplierValues,
  requestValues,
  receiptValues,
  supplierAction,
  requestAction,
  orderAction,
  receiptAction,
  paymentAction,
  item,
} from './schema.js';
export type Input =
  | z.infer<typeof supplierAction>
  | z.infer<typeof requestAction>
  | z.infer<typeof orderAction>
  | z.infer<typeof receiptAction>
  | z.infer<typeof paymentAction>;
export type SupplierValues = z.infer<typeof supplierValues>;
export type RequestValues = z.infer<typeof requestValues>;
export type ReceiptValues = z.infer<typeof receiptValues>;
export type Item = z.infer<typeof item> & {
  id: string;
  unitPriceCents: string;
  lineCents: string;
};
export interface Row {
  id: string;
  number: string;
  title: string;
  status: string;
  projectId: string;
  assetId: string;
  repairId: string;
  supplierId: string;
  requestId: string;
  orderId: string;
  sourceId: string;
  day: string;
  actor: string;
  type: string;
  version: number;
  lifecycleVersion: number;
  statusChangedAt: string;
  amountCents: string;
  acceptedCents: string;
  paidCents: string;
  dedupeKey: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
export interface Event {
  id: string;
  recordId: string;
  kind: string;
  version: number;
  actor: string;
  action: string;
  fromState: string;
  toState: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
export const stages: Record<Kind, Record<string, readonly string[]>> = {
  suppliers: {
    edit: ['active', 'suspended'],
    suspend: ['active'],
    activate: ['suspended'],
  },
  requests: {
    edit: ['draft'],
    submit: ['draft'],
    approve: ['pending'],
    return: ['pending'],
    cancel: ['draft', 'pending', 'approved'],
    convert: ['approved'],
  },
  orders: {
    edit: ['draft'],
    issue: ['draft'],
    cancel: ['draft', 'issued'],
    pay: ['issued'],
    settle: ['issued'],
    receive: ['issued'],
    reverse: ['issued', 'settled'],
  },
  receipts: {
    edit: ['draft'],
    submit: ['draft'],
    cancel: ['draft'],
    accept: ['pending'],
    return: ['pending'],
  },
  payments: { reverse: ['posted'] },
  ledger: {},
};
export function permission(kind: Kind, action: string) {
  if (action === 'read')
    return kind === 'payments' || kind === 'ledger' ? 'financeRead' : 'read';
  if (kind === 'suppliers') return 'manage';
  if (kind === 'requests')
    return ['approve', 'return'].includes(action)
      ? 'review'
      : action === 'convert'
        ? 'purchase'
        : 'request';
  if (kind === 'orders')
    return action === 'pay' || action === 'settle'
      ? 'pay'
      : action === 'reverse'
        ? 'reverse'
        : 'purchase';
  if (kind === 'receipts')
    return ['accept', 'return'].includes(action) ? 'accept' : 'receive';
  return 'reverse';
}
const stay = ({ record }: { record: Record<string, unknown> }) =>
  String(record.status);
export const lifecycles = kinds.map((kind) =>
  defineLifecycle<LifecycleTypes>({
    name: tables[kind],
    initial:
      kind === 'suppliers'
        ? 'active'
        : kind === 'payments' || kind === 'ledger'
          ? 'posted'
          : 'draft',
    states:
      kind === 'suppliers'
        ? ['active', 'suspended']
        : kind === 'requests'
          ? [
              'draft',
              'pending',
              'approved',
              { name: 'ordered', final: true },
              { name: 'cancelled', final: true },
            ]
          : kind === 'orders'
            ? ['draft', 'issued', 'settled', { name: 'cancelled', final: true }]
            : kind === 'receipts'
              ? [
                  'draft',
                  'pending',
                  { name: 'accepted', final: true },
                  { name: 'cancelled', final: true },
                ]
              : kind === 'payments'
                ? ['posted', { name: 'reversed', final: true }]
                : [{ name: 'posted', final: true }],
    transitions:
      kind === 'suppliers'
        ? {
            edit: {
              from: ['active', 'suspended'],
              to: ['active', 'suspended'],
              route: stay,
            },
            suspend: { from: 'active', to: 'suspended' },
            activate: { from: 'suspended', to: 'active' },
          }
        : kind === 'requests'
          ? {
              edit: { from: 'draft', to: 'draft' },
              submit: { from: 'draft', to: 'pending' },
              approve: { from: 'pending', to: 'approved' },
              return: { from: 'pending', to: 'draft' },
              cancel: {
                from: ['draft', 'pending', 'approved'],
                to: 'cancelled',
              },
              convert: { from: 'approved', to: 'ordered' },
            }
          : kind === 'orders'
            ? {
                edit: { from: 'draft', to: 'draft' },
                issue: { from: 'draft', to: 'issued' },
                cancel: { from: ['draft', 'issued'], to: 'cancelled' },
                pay: { from: 'issued', to: 'issued' },
                receive: { from: 'issued', to: 'issued' },
                settle: { from: 'issued', to: 'settled' },
                reverse: { from: ['issued', 'settled'], to: 'issued' },
              }
            : kind === 'receipts'
              ? {
                  edit: { from: 'draft', to: 'draft' },
                  submit: { from: 'draft', to: 'pending' },
                  accept: { from: 'pending', to: 'accepted' },
                  return: { from: 'pending', to: 'draft' },
                  cancel: { from: 'draft', to: 'cancelled' },
                }
              : kind === 'payments'
                ? { reverse: { from: 'posted', to: 'reversed' } }
                : {},
  }),
);
export const lists = z.object({
  q: z.string().max(100).default(''),
  status: z.string().max(40).default(''),
  assetId: z.string().max(100).default(''),
  projectId: z.string().max(100).default(''),
  repairId: z.string().max(100).default(''),
  supplierId: z.string().max(100).default(''),
  requestId: z.string().max(100).default(''),
  orderId: z.string().max(100).default(''),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  order: z
    .enum([
      'number',
      '-number',
      'day',
      '-day',
      'amountCents',
      '-amountCents',
      'updatedAt',
      '-updatedAt',
    ])
    .default('-updatedAt'),
});
export type ListInput = z.infer<typeof lists>;
