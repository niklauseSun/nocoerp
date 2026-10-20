import { z } from 'zod';
import { date } from '../hyl/schema.js';
export const querySchema = z
  .object({
    from: date.optional(),
    to: date.optional(),
    projectId: z.uuid().optional(),
    view: z
      .enum(['cash', 'receivables', 'payables', 'deposits', 'checks'])
      .default('cash'),
    q: z.string().trim().max(100).default(''),
    order: z
      .enum([
        'at',
        '-at',
        'amountCents',
        '-amountCents',
        'remainingCents',
        '-remainingCents',
        'openingCents',
        '-openingCents',
        'movementCents',
        '-movementCents',
        'closingCents',
        '-closingCents',
        'date',
        '-date',
        'appliedCents',
        '-appliedCents',
        'expectedCents',
        '-expectedCents',
        'actualCents',
        '-actualCents',
        'differenceCents',
        '-differenceCents',
      ])
      .default('-at'),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    path: ['to'],
    message: 'Invalid date range',
  });
export type Query = z.infer<typeof querySchema>;
export interface Line {
  id: string;
  kind: 'event' | 'receivable' | 'payable' | 'deposit';
  type: string;
  number: string;
  title: string;
  partyName: string;
  projectId: string;
  contractId: string;
  at: string;
  date: string;
  reference: string;
  method: string;
  amountCents: string;
  appliedCents: string;
  cashAppliedCents?: string;
  remainingCents: string;
  openingCents: string;
  movementCents: string;
  closingCents: string;
}
export interface Check {
  id: string;
  type: string;
  number: string;
  expectedCents: string;
  actualCents: string;
  differenceCents: string;
}
const integerCents = z.string().regex(/^-?\d+$/);
export const lineSchema = z.object({
  id: z.string(),
  kind: z.enum(['event', 'receivable', 'payable', 'deposit']),
  type: z.string(),
  number: z.string(),
  title: z.string(),
  partyName: z.string(),
  projectId: z.string(),
  contractId: z.string(),
  at: z.string(),
  date: z.string(),
  reference: z.string(),
  method: z.string(),
  amountCents: integerCents,
  appliedCents: integerCents,
  cashAppliedCents: integerCents.optional(),
  remainingCents: integerCents,
  openingCents: integerCents,
  movementCents: integerCents,
  closingCents: integerCents,
});
export const checkSchema = z.object({
  id: z.string(),
  type: z.string(),
  number: z.string(),
  expectedCents: integerCents,
  actualCents: integerCents,
  differenceCents: integerCents,
});
export const reportDataSchema = z.object({
  generatedAt: z.string(),
  from: z.string(),
  to: z.string(),
  currency: z.literal('CNY'),
  projects: z.array(z.object({ id: z.string(), name: z.string() })),
  summary: z.record(z.string(), integerCents),
  categories: z.array(
    z.object({
      type: z.string(),
      receivedCents: integerCents,
      paidCents: integerCents,
      netCents: integerCents,
    }),
  ),
  checks: z.array(checkSchema),
  items: z.array(z.union([lineSchema, checkSchema])),
});
