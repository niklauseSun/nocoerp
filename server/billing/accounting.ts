import { energyClosingBlockers, managedAt } from '../energy/registry.js';
import { markInvoiceBill } from '../invoicing/queue.js';
import { refreshOrders, refreshRefunds } from '../cashier/projection.js';
import type { DatabaseConnection } from '@nocobase/db';
import { cents } from '../hyl/calculation.js';
import { fail } from '../hyl/service.js';
import type { Row } from '../hyl/schema.js';
import { effectiveEntries, type Entry } from '../leases/model.js';
import { covered, nextDay } from './calculation.js';
import type {
  Bill,
  BillLine,
  BillingConfig,
  Receipt,
  ReceiptEntry,
} from './model.js';

export async function configs(c: DatabaseConnection, id: string) {
  return c.repository<BillingConfig>('hylBillingConfigs').findMany({
    filter: { contractId: id },
    sort: (s) => [s.field('effectiveFrom').asc()],
  });
}
export async function configAt(c: DatabaseConnection, id: string, day: string) {
  return (await configs(c, id)).filter((v) => v.effectiveFrom <= day).at(-1);
}
export async function activeLines(
  c: DatabaseConnection,
  id: string,
  except = '',
) {
  const bills = await c
    .repository<Bill>('hylBills')
    .findMany({ filter: { contractId: id } });
  const ids = new Set(
    bills
      .filter((b) => b.status !== 'voided' && b.id !== except)
      .map((b) => b.id),
  );
  return (
    await c
      .repository<BillLine>('hylBillLines')
      .findMany({ filter: { contractId: id } })
  ).filter((l) => ids.has(l.billId));
}
export function liveCash(entries: ReceiptEntry[]) {
  const reversed = new Set(entries.map((e) => e.reverseOf).filter(Boolean));
  return entries.filter((e) => !e.reverseOf && !reversed.has(e.id));
}
/** Ledger events are the authority. Cached balances are refreshed under the same merchant lock for SQL paging/sorting. */
export async function recalculateBill(c: DatabaseConnection, id: string) {
  const bill = await c.repository<Bill>('hylBills').findOne({ filter: { id } });
  if (!bill) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
  const deposit = effectiveEntries(
    await c
      .repository<Entry>('hylLeaseEntries')
      .findMany({ filter: { contractId: bill.contractId } }),
  )
    .filter(
      (e) =>
        e.kind === 'deduct' &&
        e.sourceId === id &&
        e.payload.sourceType === 'bill',
    )
    .reduce((sum, e) => sum + BigInt(e.amountCents), 0n);
  const allocated = liveCash(
    await c
      .repository<ReceiptEntry>('hylReceiptEntries')
      .findMany({ filter: { billId: id } }),
  )
    .filter((e) => e.kind === 'allocate')
    .reduce((sum, e) => sum + BigInt(e.amountCents), 0n);
  const remaining =
    bill.status === 'voided'
      ? 0n
      : BigInt(bill.amountCents) - deposit - allocated;
  if (remaining < 0n) fail('OVERPAYMENT');
  const values = {
    depositCents: deposit.toString(),
    allocatedCents: allocated.toString(),
    remainingCents: remaining.toString(),
    version: bill.version + 1,
    updatedAt: new Date().toISOString(),
  };
  const changed = await c
    .repository<Bill>('hylBills')
    .updateMany({ filter: { id, version: bill.version }, values });
  if (changed.updatedCount !== 1) fail('VERSION_CONFLICT', 'ABORTED');
  markInvoiceBill(c, id);
  return { ...bill, ...values };
}
export async function recalculateReceipt(c: DatabaseConnection, id: string) {
  const receipt = await c
    .repository<Receipt>('hylReceipts')
    .findOne({ filter: { id } });
  if (!receipt) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
  const entries = liveCash(
    await c
      .repository<ReceiptEntry>('hylReceiptEntries')
      .findMany({ filter: { receiptId: id } }),
  );
  const allocated = entries
    .filter((e) => e.kind === 'allocate')
    .reduce((s, e) => s + BigInt(e.amountCents), 0n);
  const refunded = entries
    .filter((e) => e.kind === 'refund')
    .reduce((s, e) => s + BigInt(e.amountCents), 0n);
  const unused =
    receipt.status === 'voided'
      ? 0n
      : BigInt(receipt.amountCents) - allocated - refunded;
  if (unused < 0n) fail('BILLING_INSUFFICIENT');
  const values = {
    allocatedCents: allocated.toString(),
    refundedCents: refunded.toString(),
    unusedCents: unused.toString(),
    version: receipt.version + 1,
    updatedAt: new Date().toISOString(),
  };
  const result = await c
    .repository<Receipt>('hylReceipts')
    .updateMany({ filter: { id, version: receipt.version }, values });
  if (result.updatedCount !== 1) fail('VERSION_CONFLICT', 'ABORTED');
  await refreshOrders(c, id);
  await refreshRefunds(c, id);
  return { ...receipt, ...values };
}
export async function assertCashReference(
  c: DatabaseConnection,
  merchantId: string,
  reference: string,
) {
  if (
    await c
      .repository('hylCashierReferences')
      .exists({ filter: { merchantId, reference } })
  )
    fail('DUPLICATE_REFERENCE', 'ALREADY_EXISTS');
  if (!reference) fail('PAYMENT_REQUIRED', 'INVALID_ARGUMENT');
  if (
    (await c
      .repository('hylSplitTransfers')
      .exists({ filter: { merchantId, reference } })) ||
    (await c.repository('hylPayments').exists({ filter: { reference } }))
  )
    fail('SPLIT_DUPLICATE_REFERENCE', 'ALREADY_EXISTS');
  if (
    (await c
      .repository('hylReceipts')
      .exists({ filter: { merchantId, reference } })) ||
    (await c
      .repository('hylReceiptEntries')
      .exists({ filter: { merchantId, reference } })) ||
    (await c
      .repository('hylLeaseEntries')
      .exists({ filter: { merchantId, reference } }))
  )
    fail('DUPLICATE_REFERENCE', 'ALREADY_EXISTS');
}
export function ownsFee(config: BillingConfig | undefined, category: string) {
  if (!config) return false;
  return category === 'property'
    ? config.payload.property.enabled
    : Object.hasOwn(config.payload.utilities, category);
}
export async function checkExpense(
  c: DatabaseConnection,
  merchantId: string,
  day: string,
  category: string,
) {
  const contracts = await c
    .repository<Row>('hylContracts')
    .findMany({ filter: { merchantId } });
  for (const row of contracts) {
    if (
      String(row.payload.start) <= day &&
      String(row.payload.end) >= day &&
      ownsFee(await configAt(c, row.id, day), category)
    )
      fail('BILLING_FEE_CONFLICT');
  }
}
export interface BillingBlocker {
  kind: string;
  id: string;
  number: string;
  date: string;
  status: string;
  contractId: string;
  feeType?: string;
  assetId?: string;
  meterCode?: string;
  end?: string;
}
export async function closingBlockers(
  c: DatabaseConnection,
  row: Row,
  end: string,
  closing: boolean,
): Promise<BillingBlocker[]> {
  const bills = await c
    .repository<Bill>('hylBills')
    .findMany({ filter: { contractId: row.id } });
  const receipts = await c
    .repository<Receipt>('hylReceipts')
    .findMany({ filter: { contractId: row.id } });
  const blockers: BillingBlocker[] = [];
  for (const bill of bills.filter((b) => b.status !== 'voided'))
    if (
      bill.end > end ||
      (closing && (bill.status === 'draft' || BigInt(bill.remainingCents) > 0n))
    )
      blockers.push({
        kind: 'bills',
        id: bill.id,
        number: bill.number,
        date: bill.start,
        status: bill.status,
        contractId: row.id,
      });
  if (!closing) return blockers;
  for (const receipt of receipts.filter(
    (r) => r.status !== 'voided' && BigInt(r.unusedCents) > 0n,
  ))
    blockers.push({
      kind: 'receipts',
      id: receipt.id,
      number: receipt.number,
      date: receipt.date,
      status: 'unallocated',
      contractId: row.id,
    });
  const versions = await configs(c, row.id);
  const issued = new Set(
    bills.filter((b) => b.status === 'issued').map((b) => b.id),
  );
  const lines = (await activeLines(c, row.id)).filter((l) =>
    issued.has(l.billId),
  );
  for (let i = 0; i < versions.length; i++) {
    const cfg = versions[i];
    const start =
      cfg.effectiveFrom > String(row.payload.start)
        ? cfg.effectiveFrom
        : String(row.payload.start);
    const next = versions[i + 1]?.effectiveFrom;
    const beforeNext = next
      ? new Date(new Date(`${next}T00:00:00Z`).valueOf() - 86400000)
          .toISOString()
          .slice(0, 10)
      : end;
    const stop = end < beforeNext ? end : beforeNext;
    if (start > stop) continue;
    const required = [
      ...(cfg.payload.rentChannel === 'bill' ? ['rent'] : []),
      ...(cfg.payload.property.enabled ? ['property'] : []),
    ];
    for (const type of required)
      if (
        !covered(
          start,
          stop,
          lines.filter((l) => l.feeType === type),
        )
      )
        blockers.push({
          kind: 'billingCoverage',
          id: row.id,
          number: row.number,
          date: start,
          end: stop,
          status: 'missing',
          contractId: row.id,
          feeType: type,
        });
    for (const meter of cfg.payload.meters) {
      if (!Object.hasOwn(cfg.payload.utilities, meter.feeType)) continue;
      const from = meter.activeFrom > start ? meter.activeFrom : start;
      const to =
        meter.activeTo && meter.activeTo < stop ? meter.activeTo : stop;
      if (from > to) continue;
      const managed = await managedAt(
        c,
        row.id,
        meter.assetId,
        meter.feeType,
        meter.meterCode,
        from,
        to,
      );
      const managedStart = managed.map((x) => x.a.start).sort()[0];
      const legacyTo = managedStart
        ? new Date(Date.parse(managedStart + 'T00:00:00Z') - 86400000)
            .toISOString()
            .slice(0, 10)
        : to;
      if (managedStart && legacyTo < from) continue;
      const meterLines = lines.filter(
        (l) =>
          l.feeType === meter.feeType &&
          l.assetId === meter.assetId &&
          l.meterCode === meter.meterCode,
      );
      if (!covered(from, legacyTo < to ? legacyTo : to, meterLines))
        blockers.push({
          kind: 'billingCoverage',
          id: row.id,
          number: row.number,
          date: from,
          end: to,
          status: 'missing',
          contractId: row.id,
          feeType: meter.feeType,
          assetId: meter.assetId,
          meterCode: meter.meterCode,
        });
    }
  }
  blockers.push(...(await energyClosingBlockers(c, row, end, lines)));
  return blockers;
}
export async function rentOnlyCovered(
  c: DatabaseConnection,
  row: Row,
  end: string,
) {
  if (
    row.payload.method !== 'fixed' ||
    cents(String(row.payload.fixedFee)) !== 0n
  )
    return false;
  const cfg = await configAt(c, row.id, String(row.payload.start));
  if (cfg?.payload.rentChannel !== 'bill') return false;
  for (const table of ['hylRevenueReports', 'hylExpenses']) {
    const rows = await c
      .repository<Row>(table)
      .findMany({ filter: { merchantId: row.merchantId } });
    if (rows.some((r) => r.date >= String(row.payload.start) && r.date <= end))
      return false;
  }
  return !(await closingBlockers(c, row, end, true)).length;
}
export { nextDay };
