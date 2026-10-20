import { z } from 'zod';
import { defineLifecycle, type LifecycleTypes } from '@nocobase/lifecycle';
import { date } from '../hyl/schema.js';
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const batchPreviewSchema = z
  .object({
    month,
    part: z.enum(['month', 'first', 'second']),
    projectId: z.uuid().optional(),
  })
  .strict();
export const batchCreateSchema = batchPreviewSchema
  .extend({
    requestId: z.uuid(),
    contractIds: z.array(z.uuid()).min(1).max(30),
  })
  .strict()
  .refine((v) => new Set(v.contractIds).size === v.contractIds.length);
export const batchRunSchema = z
  .object({
    action: z.enum(['generate', 'review', 'retry']),
    itemIds: z.array(z.uuid()).min(1).max(30),
  })
  .strict()
  .refine((v) => new Set(v.itemIds).size === v.itemIds.length);
export const deliveryQuery = z
  .object({
    q: z.string().trim().max(100).default(''),
    status: z.string().max(30).default(''),
    month: month.optional(),
    projectId: z.uuid().optional(),
    type: z.enum(['notice', 'policy', 'complaint', 'suggestion']).optional(),
    order: z
      .enum([
        '-updatedAt',
        'updatedAt',
        'name',
        '-name',
        'date',
        '-date',
        'amountCents',
        '-amountCents',
        'count',
        '-count',
      ])
      .default('-updatedAt'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type DeliveryQuery = z.infer<typeof deliveryQuery>;
export interface Batch {
  id: string;
  number: string;
  month: string;
  part: string;
  projectId: string;
  actor: string;
  leaseToken: string;
  leaseUntil: string;
  payload: { contractIds: string[]; fingerprint: string };
  createdAt: string;
  updatedAt: string;
}
export interface BatchItem {
  id: string;
  batchId: string;
  contractId: string;
  settlementId: string;
  version: number;
  payload: {
    attempts: {
      action: string;
      at: string;
      actor: string;
      outcome: string;
      reason: string;
    }[];
  };
  updatedAt: string;
}
export const serviceCreateSchema = z
  .object({
    requestId: z.uuid(),
    merchantId: z.uuid(),
    type: z.enum(['notice', 'policy', 'complaint', 'suggestion']),
    title: z.string().trim().min(1).max(100),
    body: z.string().trim().min(1).max(5000),
    start: date,
    dueDate: date,
    notes: z.string().trim().max(1000).default(''),
  })
  .strict()
  .refine((v) => v.start <= v.dueDate, {
    path: ['dueDate'],
    message: 'INVALID_PERIOD',
  });
export const serviceActionSchema = z
  .object({
    requestId: z.uuid(),
    expectedVersion: z.number().int().min(1),
    action: z.enum([
      'publish',
      'withdraw',
      'read',
      'accept',
      'reply',
      'close',
      'feedback',
    ]),
    text: z.string().trim().max(2000).default(''),
    dueDate: date.optional(),
    rating: z.number().int().min(1).max(5).optional(),
  })
  .strict();
export interface ServiceRecord {
  id: string;
  number: string;
  merchantId: string;
  type: string;
  title: string;
  body: string;
  start: string;
  dueDate: string;
  actor: string;
  status: string;
  version: number;
  lifecycleVersion: number;
  statusChangedAt: string;
  payload: {
    notes: string;
    fingerprint: string;
    assignee?: string;
    rating?: number;
  };
  createdAt: string;
  updatedAt: string;
}
export interface ServiceEvent {
  id: string;
  recordId: string;
  action: string;
  actor: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
export const tenantServiceLifecycle = defineLifecycle<LifecycleTypes>({
  name: 'hylTenantServiceRecords',
  initial: 'draft',
  states: [
    'draft',
    'published',
    { name: 'withdrawn', final: true },
    'submitted',
    'processing',
    'closed',
  ],
  transitions: {
    publish: { from: 'draft', to: 'published' },
    withdraw: { from: 'published', to: 'withdrawn' },
    read: { from: 'published', to: 'published' },
    submit: { from: 'draft', to: 'submitted' },
    accept: { from: 'submitted', to: 'processing' },
    reply: { from: 'processing', to: 'processing' },
    close: { from: 'processing', to: 'closed' },
    feedback: { from: 'closed', to: 'closed' },
  },
});
/** Stable IDs bind a successful generation to its batch item even after a process crash. */
export const batchStatus = (
  items: { settlementId: string; payload: BatchItem['payload'] }[],
) =>
  items.some((i) => i.payload.attempts.at(-1)?.outcome === 'failed')
    ? 'failed'
    : items.every((i) => !!i.settlementId)
      ? 'completed'
      : items.some((i) => !!i.settlementId)
        ? 'partial'
        : 'ready';
