import { buildFilter } from '@nocobase/repository-input';
import type { DatabaseConnection } from '@nocobase/db';
import type { Receipt } from '../billing/model.js';
import type { CashierRecord, Member } from './model.js';
/** No second cash ledger: SQL list balances are projections of the original receipts, in the same writer transaction. */
export async function refreshOrders(c: DatabaseConnection, receiptId: string) {
  const members = await c
    .repository<Member>('hylCashierMembers')
    .findMany({ filter: { kind: 'receipt', sourceId: receiptId } });
  for (const m of members) {
    const order = await c
      .repository<CashierRecord>('hylCashierOrders')
      .findOne({ filter: { id: m.recordId } });
    if (!order) continue;
    const refs = await c
      .repository<Member>('hylCashierMembers')
      .findMany({ filter: { recordId: m.recordId, kind: 'receipt' } });
    const rows = await c.repository<Receipt>('hylReceipts').findMany({
      filter: buildFilter((f) =>
        f.or(refs.map((r) => f.string('id').eq(r.sourceId))),
      ),
    });
    const sum = (
      key: 'amountCents' | 'allocatedCents' | 'refundedCents' | 'unusedCents',
    ) =>
      String(
        rows
          .filter((r) => r.status !== 'voided')
          .reduce((n, r) => n + BigInt(r[key]), 0n),
      );
    await c.repository('hylCashierOrders').updateOne({
      filter: { id: order.id },
      values: {
        receivedCents: sum('amountCents'),
        allocatedCents: sum('allocatedCents'),
        refundedCents: sum('refundedCents'),
        unusedCents: sum('unusedCents'),
        netCents: String(
          BigInt(sum('amountCents')) - BigInt(sum('refundedCents')),
        ),
        version: order.version + 1,
        updatedAt: new Date().toISOString(),
      },
    });
  }
}
export async function refreshRefunds(c: DatabaseConnection, receiptId: string) {
  const memberships = await c
    .repository<Member>('hylCashierMembers')
    .findMany({ filter: { sourceId: receiptId, kind: 'receipt' } });
  for (const m of memberships) {
    const row = await c
      .repository<CashierRecord>('hylCashierRefunds')
      .findOne({ filter: { id: m.recordId } });
    if (!row) continue;
    const effects = row.payload.effects as {
      receiptId: string;
      entryId: string;
      amountCents: string;
    }[];
    let total = 0n;
    for (const effect of effects) {
      const entries = await c
        .repository<{
          id: string;
          receiptId: string;
          reverseOf: string | null;
        }>('hylReceiptEntries')
        .findMany({ filter: { receiptId: effect.receiptId } });
      if (!entries.some((e) => e.reverseOf === effect.entryId))
        total += BigInt(effect.amountCents);
    }
    await c.repository('hylCashierRefunds').updateOne({
      filter: { id: row.id },
      values: {
        refundedCents: String(total),
        status:
          total === 0n
            ? 'corrected'
            : total === BigInt(row.amountCents)
              ? 'posted'
              : 'partiallyCorrected',
        version: row.version + 1,
        updatedAt: new Date().toISOString(),
      },
    });
  }
}
