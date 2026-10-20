import { z } from 'zod';
import { date } from '../hyl/schema.js';
export const views = [
  'reporting',
  'statements',
  'arrears',
  'leases',
  'vacancy',
  'business',
  'reconciliation',
] as const;
export const querySchema = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
    view: z.enum(views).default('reporting'),
    group: z.enum(['daily', 'merchant', 'channel', 'project']).default('daily'),
    status: z.string().trim().max(30).default(''),
    q: z.string().trim().max(100).default(''),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    order: z
      .enum([
        'date',
        '-date',
        'amountCents',
        '-amountCents',
        'feeCents',
        '-feeCents',
        'name',
        '-name',
      ])
      .default('-date'),
  })
  .strict();
export type Query = z.infer<typeof querySchema>;
export interface Item {
  id: string;
  name: string;
  date: string;
  status: string;
  amountCents: string;
  feeCents?: string;
  detail: string;
  path: string;
  kind: string;
  sourceId: string;
}
export const itemSchema = z.object({
  id: z.string(),
  name: z.string(),
  date: z.string(),
  status: z.string(),
  amountCents: z.string(),
  feeCents: z.string().optional(),
  detail: z.string(),
  path: z.string(),
  kind: z.string(),
  sourceId: z.string(),
});
export const followupSchema = z
  .object({
    requestId: z.uuid(),
    kind: z.enum(['contracts', 'settlements', 'bill', 'bank']),
    sourceId: z.uuid(),
    note: z.string().trim().min(1).max(1000),
    nextDate: date,
  })
  .strict();
export interface Followup {
  id: string;
  kind: string;
  sourceId: string;
  note: string;
  nextDate: string;
  actor: string;
  createdAt: string;
}
export const bankInput = z
  .object({
    externalId: z.string().trim().min(1).max(100),
    date,
    reference: z.string().trim().min(1).max(100),
    amountCents: z.string().regex(/^-?[1-9]\d{0,15}$/),
    method: z.enum(['bank', 'cash', 'other', 'unclassified']),
  })
  .strict();
export const importSchema = z
  .object({
    requestId: z.uuid(),
    account: z.string().trim().min(1).max(100),
    rows: z.array(bankInput).min(1).max(500),
  })
  .strict()
  .refine(
    (v) => new Set(v.rows.map((r) => r.externalId)).size === v.rows.length,
    { message: 'DUPLICATE_REFERENCE' },
  );
export interface BankRow extends z.infer<typeof bankInput> {
  id: string;
  account: string;
  batchId: string;
  actor: string;
  createdAt: string;
}
export interface Match {
  id: string;
  rowId: string;
  eventId: string;
  reason: string;
  actor: string;
  createdAt: string;
}
export const matchSchema = z
  .object({
    requestId: z.uuid(),
    rowId: z.uuid(),
    eventId: z.string().min(1).max(150),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
export const matchBatchSchema = z
  .object({
    requestId: z.uuid(),
    reason: z.string().trim().min(1).max(1000),
    items: z
      .array(matchSchema.pick({ rowId: true, eventId: true }))
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.items.map((x) => x.rowId)).size === v.items.length &&
      new Set(v.items.map((x) => x.eventId)).size === v.items.length,
    { message: 'MATCH_INVALID' },
  );
export const resolutionSchema = z
  .object({
    requestId: z.uuid(),
    rowId: z.uuid(),
    conclusion: z.enum([
      'investigating',
      'externalError',
      'ledgerCorrection',
      'unexplained',
    ]),
    note: z.string().trim().min(1).max(1000),
    nextDate: date,
  })
  .strict();
export type BankResolution = Omit<
  z.infer<typeof resolutionSchema>,
  'requestId'
> & { id: string; actor: string; createdAt: string };

export const pageSchema = z.object({
  data: z.object({
    month: z.string(),
    today: z.string(),
    generatedAt: z.string(),
    items: z.array(itemSchema),
    summary: z.record(z.string(), z.string()),
  }),
  meta: z.object({ page: z.number(), pageSize: z.number(), total: z.number() }),
});
export const followupRecordSchema = followupSchema
  .omit({ requestId: true })
  .extend({ id: z.string(), actor: z.string(), createdAt: z.string() });
export const bankRecordSchema = bankInput.extend({
  id: z.string(),
  account: z.string(),
  batchId: z.string(),
  actor: z.string(),
  createdAt: z.string(),
});
export const matchRecordSchema = matchSchema
  .omit({ requestId: true })
  .extend({ id: z.string(), actor: z.string(), createdAt: z.string() });
