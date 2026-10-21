import { z } from 'zod';
import { defineLifecycle, type LifecycleTypes } from '@nocobase/lifecycle';
import { feeTypes } from '../billing/model.js';
const text = (n: number) => z.string().trim().max(n),
  amount = z.string().regex(/^\d{1,14}(\.\d{1,2})?$/);
export const party = z
  .object({
    type: z.enum(['company', 'individual']).default('company'),
    name: text(100).min(1),
    taxNo: text(30),
    address: text(200).default(''),
    phone: text(50).default(''),
    bank: text(100).default(''),
    account: text(100).default(''),
    email: z.union([z.literal(''), z.email()]).default(''),
  })
  .strict()
  .refine((v) => v.type !== 'company' || !!v.taxNo, {
    path: ['taxNo'],
    message: 'Required',
  });
export const configValues = z
  .object({
    enabled: z.boolean(),
    autoIssue: z.boolean(),
    buyer: party,
    seller: party,
    fees: z
      .array(
        z
          .object({
            feeType: z.enum(feeTypes),
            taxItemName: text(100).min(1),
            code: text(50).default(''),
            rate: amount.refine((v) => Number(v) <= 100),
          })
          .strict(),
      )
      .min(1)
      .max(6),
    notes: text(1000).default(''),
  })
  .strict()
  .refine((v) => new Set(v.fees.map((f) => f.feeType)).size === v.fees.length);
export const configInput = z
  .object({
    requestId: z.uuid(),
    expectedVersion: z.number().int().min(0),
    values: configValues,
  })
  .strict();
export const sourceInput = z.object({ billId: z.uuid() }).strict();
export const backfillInput = sourceInput
  .extend({
    requestId: z.uuid(),
    sourceHash: z.string().length(64),
    reason: text(500).min(1),
  })
  .strict();
export const selectedSource = z
  .object({
    sourceId: z.uuid(),
    amounts: z
      .array(z.object({ billLineId: z.uuid(), gross: amount }).strict())
      .min(1)
      .max(100),
  })
  .strict();
export const issueValues = z
  .object({
    sources: z.array(selectedSource).min(1).max(20),
    result: z.enum(['success', 'failed']).default('success'),
    failureReason: text(500).default(''),
    notes: text(1000).default(''),
  })
  .strict();
export const expectedSource = z
  .object({
    id: z.uuid(),
    version: z.number().int(),
    sourceHash: z.string(),
    configVersion: z.number().int(),
  })
  .strict();
export const issueInput = issueValues
  .extend({
    requestId: z.uuid(),
    expectedSources: z.array(expectedSource).max(20),
    previewHash: z.string().length(64),
  })
  .strict();
export const redValues = z
  .object({
    reasonCode: z.enum(['refund', 'correction']),
    reason: text(500).min(1),
    evidence: text(500).min(1),
    lines: z
      .array(z.object({ originalLineId: z.uuid(), gross: amount }).strict())
      .min(1)
      .max(2000),
    result: z.enum(['success', 'failed']).default('success'),
    failureReason: text(500).default(''),
    notes: text(1000).default(''),
  })
  .strict();
export const redInput = redValues
  .extend({
    requestId: z.uuid(),
    expectedVersion: z.number().int(),
    expectedSources: z.array(expectedSource).max(20),
    previewHash: z.string().length(64),
  })
  .strict();
export const listInput = z.object({
  q: text(200).default(''),
  status: text(30).default(''),
  kind: z.enum(['', 'blue', 'red']).default(''),
  enabled: z.enum(['', 'true', 'false']).default(''),
  merchantId: z.string().default(''),
  contractId: z.string().default(''),
  billId: z.string().default(''),
  sourceId: z.string().default(''),
  receiptId: z.string().default(''),
  cashierOrderId: z.string().default(''),
  cashierRefundId: z.string().default(''),
  from: z.string().default(''),
  to: z.string().default(''),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  orderBy: z.string().default('-updatedAt'),
});
export type ConfigValues = z.infer<typeof configValues>;
export type IssueValues = z.infer<typeof issueValues>;
export type RedValues = z.infer<typeof redValues>;
export type Expected = z.infer<typeof expectedSource>;
export type ListInput = z.infer<typeof listInput>;
export interface Config {
  id: string;
  contractId: string;
  merchantId: string;
  version: number;
  enabled: boolean;
  autoIssue: boolean;
  payload: ConfigValues;
  actor: string;
  createdAt: string;
  updatedAt: string;
  searchText: string;
}
export interface SourceLine {
  id: string;
  feeType: string;
  amountCents: string;
  included?: boolean;
  paidCents: string;
  netIssuedCents: string;
  availableCents: string;
  requiredRedCents: string;
}
export interface Source {
  id: string;
  number: string;
  billId: string;
  contractId: string;
  merchantId: string;
  status: string;
  version: number;
  lifecycleVersion: number;
  statusChangedAt: string;
  sourceHash: string;
  paidCents: string;
  selectedPaidCents: string;
  netIssuedCents: string;
  availableCents: string;
  requiredRedCents: string;
  payload: {
    billNumber: string;
    contractNumber: string;
    merchantName: string;
    configVersion: number;
    lines: SourceLine[];
  };
  createdAt: string;
  updatedAt: string;
  searchText: string;
}
export interface Invoice {
  id: string;
  number: string;
  merchantId: string;
  kind: 'blue' | 'red';
  originalInvoiceId: string | null;
  status: string;
  version: number;
  lifecycleVersion: number;
  statusChangedAt: string;
  grossCents: string;
  netCents: string;
  taxCents: string;
  redGrossCents: string;
  remainingRedCents: string;
  buyerName: string;
  sellerName: string;
  payload: {
    buyer: ConfigValues['buyer'];
    seller: ConfigValues['seller'];
    notes: string;
    reason?: string;
    evidence?: string;
    reasonCode?: string;
    mode: string;
    actor: string;
    configAuthorizers: string[];
  };
  issuedAt: string;
  createdAt: string;
  updatedAt: string;
  searchText: string;
}
export interface InvoiceLine {
  id: string;
  invoiceId: string;
  originalLineId: string | null;
  sourceId: string;
  billId: string;
  contractId: string;
  billLineId: string;
  feeType: string;
  grossCents: string;
  netCents: string;
  taxCents: string;
  rateBps: number;
  payload: {
    taxItemName: string;
    code: string;
    configVersion?: number;
    configAuthorizer?: string;
  };
}
export const actions = [
  'invoiceRead',
  'invoiceConfigure',
  'invoiceIssue',
  'invoiceRed',
  'invoiceBackfill',
] as const;
export const sourceStates = [
  'awaitingInfo',
  'ready',
  'partiallyInvoiced',
  'invoiced',
  'redRequired',
  'excluded',
  'inactive',
] as const;
export const invoiceStates = ['issued', 'partiallyRed', 'fullyRed'] as const;
const lifecycle = (name: string, states: readonly string[], initial: string) =>
  defineLifecycle<LifecycleTypes>({
    name,
    initial,
    states: [...states],
    transitions: {
      refresh: {
        from: [...states],
        to: [...states],
        route: ({ input }) =>
          typeof input.state === 'string' ? input.state : initial,
      },
    },
  });
export const sourceLifecycle = lifecycle(
  'hylInvoiceSources',
  sourceStates,
  'awaitingInfo',
);
export const invoiceLifecycle = lifecycle(
  'hylInvoices',
  invoiceStates,
  'issued',
);
