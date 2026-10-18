import { z } from 'zod';
import { defineLifecycle, type LifecycleTypes } from '@nocobase/lifecycle';
import { date } from '../hyl/schema.js';
export const kinds = ['plans', 'tasks', 'issues'] as const;
export type Kind = (typeof kinds)[number];
export const tables = {
  plans: 'hylInspectionPlans',
  tasks: 'hylInspectionTasks',
  issues: 'hylInspectionIssues',
} as const;
export const types = ['inspection', 'security', 'cleaning'] as const;
export const frequencies = ['once', 'daily', 'weekly', 'monthly'] as const;
const text = (n: number) => z.string().trim().min(1).max(n),
  optional = (n: number) => z.string().trim().max(n).default('');
export const planValues = z
  .object({
    title: text(100),
    type: z.enum(types),
    assetIds: z
      .array(z.uuid())
      .min(1)
      .max(20)
      .refine((a) => new Set(a).size === a.length),
    items: z
      .array(z.object({ name: text(100), standard: text(500) }).strict())
      .min(1)
      .max(20),
    frequency: z.enum(frequencies),
    start: date,
    end: date,
    assigneeId: text(100),
    notes: optional(2000),
  })
  .strict()
  .refine((v) => v.end >= v.start, {
    path: ['end'],
    message: 'INVALID_PERIOD',
  });
export const results = z
  .array(
    z
      .object({
        itemId: text(100),
        result: z.enum(['normal', 'notApplicable', 'abnormal']),
        note: optional(1000),
      })
      .strict(),
  )
  .max(20)
  .refine((a) => new Set(a.map((x) => x.itemId)).size === a.length);
const op = { requestId: z.uuid(), expectedVersion: z.number().int().min(0) };
export const planAction = z.discriminatedUnion('action', [
  z.object({ ...op, action: z.literal('edit'), values: planValues }).strict(),
  ...(['activate', 'pause', 'archive'] as const).map((action) =>
    z.object({ ...op, action: z.literal(action), note: text(2000) }).strict(),
  ),
  z.object({ ...op, action: z.literal('generate'), day: date }).strict(),
]);
export const taskAction = z.discriminatedUnion('action', [
  z.object({ ...op, action: z.literal('save'), results }).strict(),
  z
    .object({
      ...op,
      action: z.enum(['start', 'submit', 'pass', 'return', 'cancel']),
      note: text(2000),
    })
    .strict(),
  z
    .object({
      ...op,
      action: z.literal('assign'),
      assigneeId: text(100),
      dueOn: date,
      note: text(2000),
    })
    .strict(),
  z
    .object({
      ...op,
      action: z.literal('report'),
      itemId: text(100),
      severity: z.enum(['low', 'normal', 'high', 'urgent']),
      description: text(4000),
      evidence: text(2000),
      assigneeId: text(100),
      dueOn: date,
    })
    .strict(),
]);
export const issueAction = z.discriminatedUnion('action', [
  z
    .object({
      ...op,
      action: z.enum(['pass', 'return', 'toRepair']),
      note: text(2000),
    })
    .strict(),
  z
    .object({
      ...op,
      action: z.literal('assign'),
      assigneeId: text(100),
      dueOn: date,
      note: text(2000),
    })
    .strict(),
  z
    .object({
      ...op,
      action: z.literal('rectify'),
      note: text(4000),
      evidence: text(2000),
    })
    .strict(),
]);
export type PlanValues = z.infer<typeof planValues>;
export type Input =
  | z.infer<typeof planAction>
  | z.infer<typeof taskAction>
  | z.infer<typeof issueAction>;
export const lists = z.object({
  q: z.string().max(200).default(''),
  type: z.enum(['', ...types]).default(''),
  status: z.string().max(50).default(''),
  mine: z.enum(['', 'true']).default(''),
  assetId: z.string().max(100).default(''),
  planId: z.string().max(100).default(''),
  taskId: z.string().max(100).default(''),
  repairId: z.string().max(100).default(''),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  order: z
    .enum([
      'updatedAt',
      '-updatedAt',
      'day',
      '-day',
      'dueOn',
      '-dueOn',
      'number',
      '-number',
    ])
    .default('-updatedAt'),
});
export type ListInput = z.infer<typeof lists>;
export type RecordRow = {
  id: string;
  number: string;
  assetId: string;
  projectId: string;
  planId: string;
  taskId: string;
  repairId: string;
  type: string;
  title: string;
  day: string;
  dueOn: string;
  assigneeId: string;
  actor: string;
  status: string;
  version: number;
  lifecycleVersion: number;
  statusChangedAt: string;
  generationKey: string | null;
  activeItemKey: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
export type Event = {
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
};
export const stageActions = {
  plans: {
    edit: ['draft', 'paused'],
    activate: ['draft', 'paused'],
    pause: ['active'],
    archive: ['draft', 'paused'],
    generate: ['active'],
  },
  tasks: {
    start: ['assigned'],
    assign: ['assigned', 'running'],
    save: ['running'],
    report: ['running'],
    submit: ['running'],
    pass: ['pendingReview'],
    return: ['pendingReview'],
    cancel: ['assigned', 'running'],
  },
  issues: {
    assign: ['open', 'returned'],
    toRepair: ['open', 'returned'],
    rectify: ['open', 'returned'],
    pass: ['pendingReview'],
    return: ['pendingReview'],
  },
} as const;
export function permission(kind: Kind, action: string) {
  if (kind === 'plans' || action === 'assign' || action === 'toRepair')
    return 'manage';
  if (action === 'pass' || action === 'return') return 'review';
  return kind === 'tasks' ? 'execute' : 'rectify';
}
export const planLifecycle = defineLifecycle<LifecycleTypes>({
  name: tables.plans,
  initial: 'draft',
  states: ['draft', 'active', 'paused', { name: 'archived', final: true }],
  transitions: {
    edit: {
      from: ['draft', 'paused'],
      to: ['draft', 'paused'],
      route: ({ record }) =>
        typeof record.status === 'string' ? record.status : 'draft',
    },
    activate: { from: ['draft', 'paused'], to: 'active' },
    pause: { from: 'active', to: 'paused' },
    archive: { from: ['draft', 'paused'], to: 'archived' },
    generate: { from: 'active', to: 'active' },
  },
});
export const taskLifecycle = defineLifecycle<LifecycleTypes>({
  name: tables.tasks,
  initial: 'assigned',
  states: [
    'assigned',
    'running',
    'pendingReview',
    { name: 'completed', final: true },
    { name: 'cancelled', final: true },
  ],
  transitions: {
    assign: { from: ['assigned', 'running'], to: 'assigned' },
    start: { from: 'assigned', to: 'running' },
    save: { from: 'running', to: 'running' },
    report: { from: 'running', to: 'running' },
    submit: { from: 'running', to: 'pendingReview' },
    pass: { from: 'pendingReview', to: 'completed' },
    return: { from: 'pendingReview', to: 'running' },
    cancel: { from: ['assigned', 'running'], to: 'cancelled' },
  },
});
export const issueLifecycle = defineLifecycle<LifecycleTypes>({
  name: tables.issues,
  initial: 'open',
  states: [
    'open',
    'returned',
    'pendingReview',
    { name: 'closed', final: true },
  ],
  transitions: {
    assign: { from: ['open', 'returned'], to: 'open' },
    toRepair: {
      from: ['open', 'returned'],
      to: ['open', 'returned'],
      route: ({ record }) =>
        typeof record.status === 'string' ? record.status : 'draft',
    },
    rectify: { from: ['open', 'returned'], to: 'pendingReview' },
    pass: { from: 'pendingReview', to: 'closed' },
    return: { from: 'pendingReview', to: 'returned' },
  },
});
