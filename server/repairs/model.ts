import { z } from 'zod';
import { defineLifecycle, type LifecycleTypes } from '@nocobase/lifecycle';
import { date, amount } from '../hyl/schema.js';
const images = z
  .array(z.uuid())
  .max(9)
  .refine((ids) => new Set(ids).size === ids.length);
const text = (n: number) => z.string().trim().min(1).max(n);
export const states = [
  'reported',
  'assigned',
  'processing',
  'pendingAcceptance',
  'accepted',
  'closed',
  'cancelled',
] as const;
export const categories = [
  'plumbing',
  'electrical',
  'airConditioning',
  'facility',
  'other',
] as const;
export const priorities = ['low', 'normal', 'high', 'urgent'] as const;
export const fields = z
  .object({
    reportPhotoIds: images.optional(),
    title: text(100),
    description: text(4000),
    category: z.enum(categories),
    priority: z.enum(priorities),
    reporterName: text(100),
    reporterPhone: text(50),
    location: z.string().trim().max(300).default(''),
    evidence: z.string().trim().max(2000).default(''),
  })
  .strict();
export const createValues = fields
  .extend({
    assetId: z.uuid(),
    merchantId: z.string().max(100).default(''),
    contractId: z.string().max(100).default(''),
    occurredOn: date,
  })
  .strict();
const op = {
  requestId: z.uuid(),
  expectedVersion: z.number().int().nonnegative(),
};
const assign = { assigneeId: text(100), dueOn: date, note: text(2000) };
export const actionValues = z.discriminatedUnion('action', [
  z.object({ ...op, action: z.literal('edit'), values: fields }).strict(),
  z.object({ ...op, action: z.literal('assign'), ...assign }).strict(),
  z.object({ ...op, action: z.literal('reassign'), ...assign }).strict(),
  ...(
    ['start', 'progress', 'accept', 'reject', 'close', 'cancel'] as const
  ).map((action) =>
    z
      .object({
        ...op,
        action: z.literal(action),
        note: text(2000),
        ...(['progress', 'accept', 'reject'].includes(action)
          ? { photoIds: images.optional() }
          : {}),
      })
      .strict(),
  ),
  z
    .object({
      ...op,
      action: z.literal('complete'),
      note: text(4000),
      evidence: text(2000),
      cost: amount,
      photoIds: images.optional(),
    })
    .strict(),
]);
export const listInput = z.object({
  q: z.string().max(200).default(''),
  status: z.enum(['', ...states]).default(''),
  category: z.enum(['', ...categories]).default(''),
  priority: z.enum(['', ...priorities]).default(''),
  mine: z.enum(['', 'true']).default(''),
  assetId: z.string().max(100).default(''),
  merchantId: z.string().max(100).default(''),
  contractId: z.string().max(100).default(''),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  order: z
    .enum([
      'updatedAt',
      '-updatedAt',
      'createdAt',
      '-createdAt',
      'dueOn',
      '-dueOn',
      'costCents',
      '-costCents',
      'number',
      '-number',
    ])
    .default('-updatedAt'),
});
export const actionPermission = {
  edit: 'report',
  assign: 'dispatch',
  reassign: 'dispatch',
  start: 'process',
  progress: 'process',
  complete: 'process',
  accept: 'accept',
  reject: 'accept',
  close: 'close',
  cancel: 'cancel',
} as const;
export const transitions = {
  edit: ['reported'],
  assign: ['reported'],
  reassign: ['assigned', 'processing'],
  start: ['assigned'],
  progress: ['processing'],
  complete: ['processing'],
  accept: ['pendingAcceptance'],
  reject: ['pendingAcceptance'],
  close: ['accepted'],
  cancel: ['reported', 'assigned', 'processing'],
} as const;
export const repairLifecycle = defineLifecycle<LifecycleTypes>({
  name: 'hylRepairOrders',
  initial: 'reported',
  states: [
    'reported',
    'assigned',
    'processing',
    'pendingAcceptance',
    'accepted',
    { name: 'closed', final: true },
    { name: 'cancelled', final: true },
  ],
  transitions: {
    edit: { from: 'reported', to: 'reported' },
    assign: { from: 'reported', to: 'assigned' },
    reassign: { from: ['assigned', 'processing'], to: 'assigned' },
    start: { from: 'assigned', to: 'processing' },
    progress: { from: 'processing', to: 'processing' },
    complete: { from: 'processing', to: 'pendingAcceptance' },
    accept: { from: 'pendingAcceptance', to: 'accepted' },
    reject: { from: 'pendingAcceptance', to: 'processing' },
    close: { from: 'accepted', to: 'closed' },
    cancel: { from: ['reported', 'assigned', 'processing'], to: 'cancelled' },
  },
});
export type RepairOrder = {
  id: string;
  number: string;
  assetId: string;
  projectId: string;
  merchantId: string;
  contractId: string;
  title: string;
  category: string;
  priority: string;
  occurredOn: string;
  dueOn: string;
  assigneeId: string;
  status: string;
  costCents: string;
  actor: string;
  version: number;
  lifecycleVersion: number;
  statusChangedAt: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
export type RepairEvent = {
  id: string;
  orderId: string;
  actor: string;
  action: string;
  fromState: string;
  toState: string;
  payload: Record<string, unknown>;
  createdAt: string;
};
export type Action = z.infer<typeof actionValues>;
export type CreateValues = z.infer<typeof createValues>;
export type ListInput = z.infer<typeof listInput>;
