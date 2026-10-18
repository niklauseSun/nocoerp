import { z } from 'zod';
import { date, amount } from '../hyl/schema.js';
import { cents } from '../hyl/calculation.js';
const text = (n: number) => z.string().trim().min(1).max(n),
  opt = (n: number) => z.string().trim().max(n).default('');
const optionalDate = z.union([date, z.literal('')]).default('');
export const supplierValues = z
  .object({
    projectId: z.uuid(),
    name: text(100),
    contact: text(100),
    phone: text(50),
    address: opt(300),
    supplyScope: text(500),
    taxNumber: z
      .string()
      .regex(/^$|^[A-Z0-9]{18}$/)
      .default(''),
    qualificationUntil: optionalDate,
    notes: opt(2000),
  })
  .strict();
export const item = z
  .object({
    name: text(100),
    spec: opt(300),
    unit: text(20),
    quantity: z.number().int().min(1).max(1000000),
    unitPrice: amount.refine(
      (v) => /^\d{1,12}(\.\d{1,2})?$/.test(v) && cents(v) > 0n,
    ),
  })
  .strict();
export const requestValues = z
  .object({
    title: text(100),
    assetId: z.uuid(),
    repairId: z.union([z.uuid(), z.literal('')]).default(''),
    neededOn: date,
    reason: text(2000),
    notes: opt(2000),
    items: z.array(item).min(1).max(20),
  })
  .strict();
export const receiptLine = z
  .object({
    itemId: text(100),
    delivered: z.number().int().min(1).max(1000000),
    accepted: z.number().int().min(0).max(1000000),
  })
  .strict()
  .refine((v) => v.accepted <= v.delivered, {
    path: ['accepted'],
    message: 'INVALID_QUANTITY',
  });
const receiptBase = z
  .object({
    orderId: z.uuid(),
    day: date,
    evidence: text(2000),
    notes: opt(2000),
    lines: z
      .array(receiptLine)
      .min(1)
      .max(20)
      .refine((v) => new Set(v.map((l) => l.itemId)).size === v.length),
  })
  .strict();
const rejected = (v: {
  lines: { delivered: number; accepted: number }[];
  notes: string;
}) => v.lines.every((l) => l.delivered === l.accepted) || !!v.notes;
export const receiptValues = receiptBase.refine(rejected, {
  path: ['notes'],
  message: 'REJECTED_GOODS_NOTE_REQUIRED',
});
const op = { requestId: z.uuid(), expectedVersion: z.number().int().min(0) };
export const supplierAction = z.discriminatedUnion('action', [
  z
    .object({
      ...op,
      action: z.literal('edit'),
      values: supplierValues.omit({ projectId: true }),
    })
    .strict(),
  z
    .object({
      ...op,
      action: z.enum(['activate', 'suspend']),
      note: text(2000),
    })
    .strict(),
]);
export const requestAction = z.discriminatedUnion('action', [
  z
    .object({
      ...op,
      action: z.literal('edit'),
      values: requestValues.omit({ assetId: true, repairId: true }),
    })
    .strict(),
  z
    .object({
      ...op,
      action: z.enum(['submit', 'approve', 'return', 'cancel']),
      note: text(2000),
    })
    .strict(),
  z
    .object({
      ...op,
      action: z.literal('convert'),
      supplierId: z.uuid(),
      note: text(2000),
    })
    .strict(),
]);
export const orderAction = z.discriminatedUnion('action', [
  z
    .object({
      ...op,
      action: z.literal('edit'),
      prices: z
        .array(
          z
            .object({
              itemId: text(100),
              unitPrice: amount.refine(
                (v) => /^\d{1,12}(\.\d{1,2})?$/.test(v) && cents(v) > 0n,
              ),
            })
            .strict(),
        )
        .min(1)
        .max(20),
    })
    .strict(),
  z
    .object({
      ...op,
      action: z.enum(['issue', 'settle', 'cancel']),
      note: text(2000),
    })
    .strict(),
  z
    .object({
      ...op,
      action: z.literal('pay'),
      amount: amount.refine(
        (v) => /^\d{1,12}(\.\d{1,2})?$/.test(v) && cents(v) > 0n,
      ),
      day: date,
      reference: text(100),
      channel: z.enum(['bank', 'cash', 'other']),
      evidence: text(2000),
      note: opt(2000),
    })
    .strict(),
]);
export const receiptAction = z.discriminatedUnion('action', [
  z
    .object({
      ...op,
      action: z.literal('edit'),
      values: receiptBase.omit({ orderId: true }).refine(rejected, {
        path: ['notes'],
        message: 'REJECTED_GOODS_NOTE_REQUIRED',
      }),
    })
    .strict(),
  z
    .object({
      ...op,
      action: z.enum(['submit', 'accept', 'return', 'cancel']),
      note: text(2000),
    })
    .strict(),
]);
export const paymentAction = z
  .object({ ...op, action: z.literal('reverse'), day: date, note: text(2000) })
  .strict();
