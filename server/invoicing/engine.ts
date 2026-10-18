import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseConnection } from '@nocobase/db';
import type { HylService } from '../hyl/service.js';
import { fail } from '../hyl/service.js';
import type { Row } from '../hyl/schema.js';
import type { Bill, BillLine, ReceiptEntry } from '../billing/model.js';
import { effectiveEntries, type Entry } from '../leases/model.js';
import { allocate, tax } from './calculation.js';
import type {
  Config,
  Source,
  SourceLine,
  Invoice,
  InvoiceLine,
  ConfigValues,
} from './model.js';
export const fingerprint = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const latestConfig = (c: DatabaseConnection, contractId: string) =>
  c.repository<Config>('hylInvoiceConfigs').findOne({
    filter: { contractId },
    sort: (s) => [s.field('version').desc()],
  });
export async function compute(c: DatabaseConnection, billId: string) {
  const bill = await c
    .repository<Bill>('hylBills')
    .findOne({ filter: { id: billId } });
  if (!bill) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
  const contract = await c
    .repository<Row>('hylContracts')
    .findOne({ filter: { id: bill.contractId } });
  if (!contract) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
  const merchant = await c
      .repository<Row>('hylMerchants')
      .findOne({ filter: { id: bill.merchantId } }),
    config = await latestConfig(c, bill.contractId);
  const entries = await c
      .repository<ReceiptEntry>('hylReceiptEntries')
      .findMany({ filter: { billId } }),
    reversed = new Set(entries.map((e) => e.reverseOf));
  const cash = entries.filter(
    (e) => e.kind === 'allocate' && !e.reverseOf && !reversed.has(e.id),
  );
  const deposits = effectiveEntries(
    await c
      .repository<Entry>('hylLeaseEntries')
      .findMany({ filter: { contractId: bill.contractId } }),
  ).filter(
    (e) =>
      e.kind === 'deduct' &&
      e.sourceId === billId &&
      e.payload.sourceType === 'bill',
  );
  const paid =
    bill.status === 'issued'
      ? [...cash, ...deposits].reduce((n, e) => n + BigInt(e.amountCents), 0n)
      : 0n;
  const billLines = await c
      .repository<BillLine>('hylBillLines')
      .findMany({ filter: { billId } }),
    weights = billLines.filter((l) => BigInt(l.amountCents) > 0n),
    apportioned = allocate(paid, weights);
  const invoiceLines = await c
    .repository<InvoiceLine>('hylInvoiceLines')
    .findMany({ filter: { billId } });
  const lines: SourceLine[] = apportioned.map((a) => {
    const original = billLines.find((l) => l.id === a.id)!,
      net = invoiceLines
        .filter((l) => l.billLineId === a.id)
        .reduce(
          (n, l) => n + (l.originalLineId ? -1n : 1n) * BigInt(l.grossCents),
          0n,
        ),
      paid = BigInt(a.paidCents),
      selected =
        !!config?.enabled &&
        config.payload.fees.some((f) => f.feeType === original.feeType);
    return {
      id: a.id,
      feeType: original.feeType,
      amountCents: a.amountCents,
      included: selected,
      paidCents: a.paidCents,
      netIssuedCents: String(net),
      availableCents: String(selected && paid > net ? paid - net : 0n),
      requiredRedCents: String(net > paid ? net - paid : 0n),
    };
  });
  const sum = (
    key: 'paidCents' | 'netIssuedCents' | 'availableCents' | 'requiredRedCents',
  ) => String(lines.reduce((n, l) => n + BigInt(l[key]), 0n));
  const values = {
    paidCents: String(paid),
    selectedPaidCents: String(
      lines
        .filter(
          (l) =>
            config?.enabled &&
            config.payload.fees.some((f) => f.feeType === l.feeType),
        )
        .reduce((n, l) => n + BigInt(l.paidCents), 0n),
    ),
    netIssuedCents: sum('netIssuedCents'),
    availableCents: sum('availableCents'),
    requiredRedCents: sum('requiredRedCents'),
  };
  const sourceHash = fingerprint({
    billId,
    status: bill.status,
    lines: weights
      .map((l) => ({ id: l.id, fee: l.feeType, amount: l.amountCents }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    cash: cash.map((e) => [e.id, e.amountCents]).sort(),
    deposits: deposits.map((e) => [e.id, e.amountCents]).sort(),
    configVersion: config?.version ?? 0,
  });
  const status =
    BigInt(values.requiredRedCents) > 0n
      ? 'redRequired'
      : bill.status !== 'issued'
        ? 'inactive'
        : !config
          ? 'awaitingInfo'
          : !config.enabled
            ? 'excluded'
            : BigInt(values.availableCents) > 0n
              ? BigInt(values.netIssuedCents) > 0n
                ? 'partiallyInvoiced'
                : 'ready'
              : paid > 0n
                ? 'invoiced'
                : 'ready';
  return {
    bill,
    contract,
    merchant,
    config,
    lines,
    sourceHash,
    status,
    values,
    cash,
    deposits,
  };
}
export async function refresh(
  c: DatabaseConnection,
  hyl: HylService,
  billId: string,
  actor: string,
) {
  const s = await compute(c, billId),
    repo = c.repository<Source>('hylInvoiceSources'),
    old = await repo.findOne({ filter: { billId } }),
    now = new Date().toISOString();
  const payload = {
    billNumber: s.bill.number,
    contractNumber: s.contract.number,
    merchantName: String(s.merchant?.name ?? ''),
    configVersion: s.config?.version ?? 0,
    lines: s.lines,
  };
  if (
    old &&
    old.sourceHash === s.sourceHash &&
    Object.entries(s.values).every(([k, v]) => old[k as keyof Source] === v)
  )
    return old;
  const values = {
    ...s.values,
    sourceHash: s.sourceHash,
    payload,
    version: (old?.version ?? 0) + 1,
    searchText: [s.bill.number, s.contract.number, s.merchant?.name].join(' '),
    updatedAt: now,
  };
  const id = old?.id ?? randomUUID();
  if (!old)
    await repo.createOne({
      values: {
        id,
        number: 'SIM-T-' + id.slice(0, 8).toUpperCase(),
        billId,
        contractId: s.bill.contractId,
        merchantId: s.bill.merchantId,
        status: 'awaitingInfo',
        lifecycleVersion: 0,
        statusChangedAt: now,
        createdAt: now,
        ...values,
      },
    });
  else await repo.updateOne({ filter: { id }, values });
  if ((old?.status ?? 'awaitingInfo') !== s.status)
    await hyl.runtime.fire('hylInvoiceSources', id, 'refresh', {
      actor: { id: actor },
      transaction: c,
      expect: { version: old?.lifecycleVersion ?? 0 },
      input: { state: s.status },
    });
  await c.repository('hylInvoiceSourceRevisions').createOne({
    values: {
      id: randomUUID(),
      sourceId: id,
      revision: values.version,
      sourceHash: s.sourceHash,
      paidCents: s.values.paidCents,
      netIssuedCents: s.values.netIssuedCents,
      availableCents: s.values.availableCents,
      requiredRedCents: s.values.requiredRedCents,
      payload: {
        ...payload,
        cash: s.cash.map((e) => ({
          id: e.id,
          receiptId: e.receiptId,
          amountCents: e.amountCents,
        })),
        deposits: s.deposits.map((e) => ({
          id: e.id,
          amountCents: e.amountCents,
        })),
      },
      actor,
      createdAt: now,
    },
  });
  return (await repo.findOne({ filter: { id } }))!;
}
export type DraftLine = Omit<InvoiceLine, 'id' | 'invoiceId'>;
export async function writeInvoice(
  c: DatabaseConnection,
  hyl: HylService,
  input: {
    merchantId: string;
    kind: 'blue' | 'red';
    original?: Invoice;
    buyer: ConfigValues['buyer'];
    seller: ConfigValues['seller'];
    lines: DraftLine[];
    actor: string;
    mode: string;
    notes: string;
    reason?: string;
    evidence?: string;
    reasonCode?: string;
    authorizers: string[];
  },
) {
  const id = randomUUID(),
    now = new Date().toISOString(),
    gross = input.lines.reduce((n, l) => n + BigInt(l.grossCents), 0n),
    net = input.lines.reduce((n, l) => n + BigInt(l.netCents), 0n);
  const row: Invoice = {
    id,
    number: `SIM-${input.kind === 'blue' ? 'B' : 'R'}-${id.toUpperCase()}`,
    merchantId: input.merchantId,
    kind: input.kind,
    originalInvoiceId: input.original?.id ?? null,
    status: 'issued',
    version: 1,
    lifecycleVersion: 0,
    statusChangedAt: now,
    grossCents: String(gross),
    netCents: String(net),
    taxCents: String(gross - net),
    redGrossCents: '0',
    remainingRedCents: input.kind === 'blue' ? String(gross) : '0',
    buyerName: input.buyer.name,
    sellerName: input.seller.name,
    payload: {
      buyer: input.buyer,
      seller: input.seller,
      actor: input.actor,
      mode: input.mode,
      notes: input.notes,
      reason: input.reason,
      evidence: input.evidence,
      reasonCode: input.reasonCode,
      configAuthorizers: input.authorizers,
    },
    issuedAt: now,
    createdAt: now,
    updatedAt: now,
    searchText: [
      input.buyer.name,
      input.seller.name,
      ...input.lines.map((l) => l.billId),
    ].join(' '),
  };
  await c.repository<Invoice>('hylInvoices').createOne({ values: row });
  for (const l of input.lines)
    await c
      .repository<InvoiceLine>('hylInvoiceLines')
      .createOne({ values: { id: randomUUID(), invoiceId: id, ...l } });
  for (const sourceId of new Set(input.lines.map((l) => l.sourceId))) {
    const line = input.lines.find((l) => l.sourceId === sourceId)!;
    await c.repository('hylInvoiceMembers').createOne({
      values: {
        id: randomUUID(),
        invoiceId: id,
        sourceId,
        contractId: line.contractId,
        billId: line.billId,
      },
    });
  }
  if (input.original) {
    const old = input.original,
      red = BigInt(old.redGrossCents) + gross,
      remaining = BigInt(old.grossCents) - red;
    await c.repository<Invoice>('hylInvoices').updateOne({
      filter: { id: old.id },
      values: {
        redGrossCents: String(red),
        remainingRedCents: String(remaining),
        version: old.version + 1,
        updatedAt: now,
      },
    });
    await hyl.runtime.fire('hylInvoices', old.id, 'refresh', {
      actor: { id: input.actor },
      transaction: c,
      expect: { version: old.lifecycleVersion },
      input: { state: remaining === 0n ? 'fullyRed' : 'partiallyRed' },
    });
  }
  for (const billId of new Set(input.lines.map((l) => l.billId)))
    await refresh(c, hyl, billId, input.actor);
  return row;
}
export async function autoIssue(
  c: DatabaseConnection,
  hyl: HylService,
  source: Source,
  actor: string,
) {
  const config = await latestConfig(c, source.contractId);
  if (
    !config?.enabled ||
    !config.autoIssue ||
    BigInt(source.requiredRedCents) > 0n ||
    BigInt(source.availableCents) <= 0n
  )
    return;
  const lines: DraftLine[] = source.payload.lines
    .filter((l) => BigInt(l.availableCents) > 0n)
    .map((l) => {
      const fee = config.payload.fees.find((f) => f.feeType === l.feeType)!;
      return {
        originalLineId: null,
        sourceId: source.id,
        billId: source.billId,
        contractId: source.contractId,
        billLineId: l.id,
        feeType: l.feeType,
        ...tax(BigInt(l.availableCents), Math.round(Number(fee.rate) * 100)),
        rateBps: Math.round(Number(fee.rate) * 100),
        payload: {
          taxItemName: fee.taxItemName,
          code: fee.code,
          configVersion: config.version,
          configAuthorizer: config.actor,
        },
      };
    });
  await writeInvoice(c, hyl, {
    merchantId: source.merchantId,
    kind: 'blue',
    buyer: config.payload.buyer,
    seller: config.payload.seller,
    lines,
    actor,
    mode: 'systemSimulation',
    notes: '',
    authorizers: [config.actor],
  });
}
