import { z } from 'zod';
import { cents } from './calculation.js';
const text = (max: number) => z.string().trim().max(max);
const required = (max: number) => text(max).min(1);
export const amount = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/);
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === s;
  });
const optionalText = (max: number) => text(max).default('');
export const merchantSchema = z
  .object({
    // Accepted for older clients; the service owns generation and preserves it on edit.
    code: optionalText(30),
    creationId: z.string().uuid().optional(),
    licenseFileId: z.string().uuid().optional(),
    name: required(100),
    unit: optionalText(100),
    assetId: z.union([z.string().uuid(), z.literal('')]).default(''),
    bindingStart: z.union([date, z.literal('')]).default(''),
    bindingEnd: z.union([date, z.literal('')]).default(''),
    category: optionalText(50),
    categoryName: optionalText(50),
    legalRepresentative: optionalText(100),
    creditCode: text(18)
      .regex(/^$|^[0-9A-Z]{18}$/)
      .default(''),
    businessHours: optionalText(500),
    contact: required(50),
    phone: required(30),
    accountName: required(100),
    bank: required(100),
    account: required(64),
    userId: optionalText(100),
    // Accepted when an existing snapshot is resubmitted; canonicalized by the service.
    userName: optionalText(100),
    notes: optionalText(1000),
    active: z.boolean().default(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.assetId &&
      (!value.bindingStart ||
        (value.bindingEnd && value.bindingEnd < value.bindingStart))
    )
      ctx.addIssue({
        code: 'custom',
        path: ['bindingStart'],
        message: 'INVALID_PERIOD',
      });
    if (value.licenseFileId && !value.creationId)
      ctx.addIssue({
        code: 'custom',
        path: ['creationId'],
        message: 'CREATION_ID_REQUIRED',
      });
    if (value.category === 'other' && !value.categoryName)
      ctx.addIssue({
        code: 'custom',
        path: ['categoryName'],
        message: 'CATEGORY_NAME_REQUIRED',
      });
  });
export const contractSchema = z
  .object({
    title: optionalText(100),
    depositTarget: amount.default('0'),
    // Older clients may send a number; identity is assigned by the service.
    number: optionalText(50),
    merchantId: required(100),
    assetIds: z
      .array(z.string().uuid())
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length)
      .optional(),
    start: date,
    end: date,
    cycle: z.enum(['half', 'month']),
    method: z.enum(['fixed', 'commission', 'minimum']),
    basis: z.enum(['receipts', 'turnover']),
    rate: amount.refine((v) => cents(v) <= 10000n),
    fixedFee: amount,
    minimum: amount,
    rent: amount,
    includeActivity: z.boolean(),
    includeCash: z.boolean(),
    includeHospitality: z.boolean(),
    notes: optionalText(1000),
  })
  .strict()
  .refine((v) => v.end >= v.start, {
    path: ['end'],
    message: 'INVALID_PERIOD',
  });
export const revenueSchema = z
  .object({
    merchantId: required(100),
    date,
    source: z.enum([
      'cash',
      'bank',
      'pos',
      'wechat',
      'alipay',
      'meituan',
      'douyin',
      'other',
    ]),
    reference: required(100),
    receipts: amount,
    refunds: amount,
    activity: amount,
    cash: amount,
    hospitality: amount,
    collected: amount,
    evidence: required(500),
    notes: optionalText(1000),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (cents(v.refunds) > cents(v.receipts))
      ctx.addIssue({
        code: 'custom',
        path: ['refunds'],
        message: 'REFUNDS_EXCEED_RECEIPTS',
      });
    else if (cents(v.collected) > cents(v.receipts) - cents(v.refunds))
      ctx.addIssue({
        code: 'custom',
        path: ['collected'],
        message: 'COLLECTED_EXCEEDS_RECEIPTS',
      });
  });
export const expenseSchema = z
  .object({
    merchantId: required(100),
    date,
    category: z.enum([
      'materials',
      'consumables',
      'water',
      'electricity',
      'gas',
      'property',
      'labor',
      'other',
    ]),
    amount: amount.refine((v) => cents(v) > 0n),
    responsibility: z.enum(['company', 'merchant']),
    reference: required(100),
    evidence: required(500),
    notes: optionalText(1000),
  })
  .strict();
export const settlementSchema = z
  .object({
    merchantId: required(100),
    contractId: required(100),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    part: z.enum(['month', 'first', 'second']),
  })
  .strict();
export const schemas = {
  merchants: merchantSchema,
  contracts: contractSchema,
  revenueReports: revenueSchema,
  expenses: expenseSchema,
  settlements: settlementSchema,
};
export type Kind = keyof typeof schemas;
export const kinds = Object.keys(schemas) as Kind[];
export const tables: Record<Kind, string> = {
  merchants: 'hylMerchants',
  contracts: 'hylContracts',
  revenueReports: 'hylRevenueReports',
  expenses: 'hylExpenses',
  settlements: 'hylSettlements',
};
export type Merchant = z.infer<typeof merchantSchema>;
export type Contract = z.infer<typeof contractSchema>;
export type Revenue = z.infer<typeof revenueSchema>;
export type Expense = z.infer<typeof expenseSchema>;
export interface Row {
  id: string;
  userId: string;
  statusChangedAt: string;
  number: string;
  name: string;
  merchantId: string;
  date: string;
  status: string;
  payload: Record<string, unknown>;
  version: number;
  lifecycleVersion: number;
  createdAt: string;
  updatedAt: string;
  amountCents: string;
  settlementId: string | null;
}
export const actionSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    reason: text(1000).default(''),
    confirmation: z.enum(['online', 'offline']).default('online'),
    confirmedBy: text(100).default(''),
    evidence: text(500).default(''),
    amount: amount.default('0'),
    date: date.optional(),
    reference: text(100).default(''),
    method: z.enum(['bank', 'cash', 'other']).default('bank'),
    notes: text(1000).default(''),
  })
  .strict();
export type ActionInput = z.infer<typeof actionSchema>;
