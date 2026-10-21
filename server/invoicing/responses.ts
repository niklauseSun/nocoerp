import { z } from 'zod';
import { configValues, expectedSource, party } from './model.js';
const money = z.string().regex(/^-?\d+$/),
  id = z.string(),
  times = { createdAt: z.string(), updatedAt: z.string() },
  lifecycle = {
    status: z.string(),
    version: z.number(),
    lifecycleVersion: z.number(),
    statusChangedAt: z.string(),
  },
  totals = { grossCents: money, netCents: money, taxCents: money },
  sourceTotals = {
    paidCents: money,
    selectedPaidCents: money,
    netIssuedCents: money,
    availableCents: money,
    requiredRedCents: money,
  };
export const sourceLineResponse = z.object({
  id,
  feeType: z.string(),
  amountCents: money,
  included: z.boolean().optional(),
  paidCents: money,
  netIssuedCents: money,
  availableCents: money,
  requiredRedCents: money,
});
export const configResponse = z
  .object({
    id,
    contractId: id,
    merchantId: id,
    version: z.number(),
    enabled: z.boolean(),
    autoIssue: z.boolean(),
    payload: configValues,
    actor: id,
    ...times,
    searchText: z.string(),
  })
  .meta({ ref: 'InvoiceConfiguration' });
export const sourceResponse = z
  .object({
    id,
    number: z.string(),
    billId: id,
    contractId: id,
    merchantId: id,
    ...lifecycle,
    sourceHash: z.string(),
    ...sourceTotals,
    payload: z.object({
      billNumber: z.string(),
      contractNumber: z.string(),
      merchantName: z.string(),
      configVersion: z.number(),
      lines: z.array(sourceLineResponse).optional(),
    }),
    ...times,
    searchText: z.string(),
  })
  .meta({ ref: 'InvoiceSource' });
export const invoiceResponse = z
  .object({
    id,
    number: z.string(),
    merchantId: id,
    kind: z.enum(['blue', 'red']),
    originalInvoiceId: id.nullable(),
    ...lifecycle,
    ...totals,
    redGrossCents: money,
    remainingRedCents: money,
    buyerName: z.string(),
    sellerName: z.string(),
    payload: z.object({
      buyer: party,
      seller: party,
      notes: z.string(),
      reason: z.string().optional(),
      evidence: z.string().optional(),
      reasonCode: z.string().optional(),
      mode: z.string(),
      actor: id,
      configAuthorizers: z.array(id),
    }),
    issuedAt: z.string(),
    ...times,
    searchText: z.string(),
  })
  .meta({ ref: 'SimulatedInvoice' });
const taxSnapshot = z.object({
  taxItemName: z.string(),
  code: z.string(),
  configVersion: z.number().optional(),
  configAuthorizer: id.optional(),
});
export const draftLineResponse = z.object({
  originalLineId: id.nullable(),
  sourceId: id,
  billId: id,
  contractId: id,
  billLineId: id,
  feeType: z.string(),
  ...totals,
  rateBps: z.number(),
  payload: taxSnapshot,
});
const lineResponse = draftLineResponse.extend({
  id,
  invoiceId: id,
  billNumber: z.string(),
  sourceNumber: z.string(),
  remainingCents: money,
  requiredRedCents: money,
  taxItemName: z.string(),
  code: z.string(),
  rate: z.string(),
  configVersion: z.number().optional(),
  configAuthorizer: id.optional(),
});
export const metaResponse = z.object({
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});
const page = (schema: z.ZodType) =>
  z.object({
    data: z.array(schema),
    meta: metaResponse,
    restricted: z.boolean().optional(),
  });
const actions = { allowedActions: z.array(z.string()) };
const history = z.object({
  id,
  revision: z.number(),
  createdAt: z.string(),
  paidCents: money,
  netIssuedCents: money,
  requiredRedCents: money,
});
const attempt = z.object({
  id,
  requestId: id,
  kind: z.string(),
  merchantId: id,
  parentInvoiceId: id.nullable(),
  sourceId: id.nullable(),
  grossCents: money,
  status: z.string(),
  actor: id,
  createdAt: z.string(),
  payload: z.record(z.string(), z.json()),
});
const member = z.object({
  id,
  invoiceId: id,
  sourceId: id,
  contractId: id,
  billId: id,
  billNumber: z.string(),
});
const cash = z.object({
  id,
  receiptId: id,
  number: z.string(),
  amountCents: money,
  createdAt: z.string(),
});
const deposit = z.object({ id, amountCents: money, createdAt: z.string() });
const sample = z.array(z.object({ feeType: z.string(), ...totals }));
export const listItems = {
  sources: sourceResponse.extend(actions),
  configs: configResponse.extend({
    ...actions,
    contractNumber: z.string(),
    merchantName: z.string(),
  }),
  invoices: invoiceResponse.extend({ ...actions, merchantName: z.string() }),
};
export const detailItems = {
  sources: sourceResponse.extend({
    ...actions,
    config: configResponse.optional(),
    lines: page(sourceLineResponse),
    cash: page(cash),
    deposits: page(deposit),
    invoices: page(invoiceResponse),
    history: page(history),
    attempts: page(attempt),
  }),
  configs: configResponse.extend({
    ...actions,
    sample,
    history: page(configResponse),
  }),
  invoices: invoiceResponse.extend({
    ...actions,
    lines: page(lineResponse),
    members: page(member),
    credits: page(invoiceResponse),
    attempts: page(attempt),
  }),
};
export const previewResponse = z.object({
  merchantId: id.optional(),
  buyer: party.optional(),
  seller: party.optional(),
  original: invoiceResponse.optional(),
  lines: z.array(draftLineResponse),
  expectedSources: z.array(expectedSource),
  authorizers: z.array(id).optional(),
  ...totals,
  previewHash: z.string(),
});
export const operationResponse = z.object({
  outcome: z.enum(['success', 'failed']),
  invoice: invoiceResponse.nullable(),
});
export const backfillPreviewResponse = z.object({
  billId: id,
  sourceHash: z.string(),
  status: z.string(),
  ...sourceTotals,
});
export const configPreviewResponse = z.object({
  expectedConfigVersion: z.number(),
  sample,
});
// The contract is owned by Hyl; declare the fields consumed by invoice configuration.
export const configurationResponse = z.object({
  config: configResponse.optional(),
  contract: z.object({ id, number: z.string(), merchantId: id }).loose(),
  merchant: z.object({ name: z.string().optional(), creditCode: z.string() }),
  ...actions,
});
