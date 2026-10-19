import type { Transfer } from '../profit-sharing/model.js';
import type { Row } from '../hyl/schema.js';
import { buildFilter } from '@nocobase/repository-input';
import type { DatabaseConnection } from '@nocobase/db';
import type { Access } from '../hyl/service.js';
import { fail } from '../hyl/service.js';
import type { Receipt, ReceiptEntry } from '../billing/model.js';
import type { Entry } from '../leases/model.js';
import type { DayQuery, ReconcileInput, CashierRecord } from './model.js';
import type { CashierService } from './service.js';
import { hash } from './service.js';
import { cents } from '../hyl/calculation.js';
export interface CashEvent {
  id: string;
  contractId: string;
  receiptId?: string;
  reference?: string;
  number: string;
  at: string;
  date: string;
  actor: string;
  method: string;
  kind: string;
  category: string;
  amountCents: string;
}
const text = (value: unknown) => (typeof value === 'string' ? value : '');
export const dayOf = (at: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
/** Original cash ledger shared by daily reconciliation and financial reports. */
export async function collectCashEvents(c: DatabaseConnection, ids: string[]) {
  const events: CashEvent[] = [];
  const receipts = await c.repository<Receipt>('hylReceipts').findMany({
      filter: buildFilter((f) =>
        ids.length
          ? f.or(ids.map((id) => f.string('contractId').eq(id)))
          : f.string('id').eq('__none__'),
      ),
    }),
    entries = await c.repository<ReceiptEntry>('hylReceiptEntries').findMany({
      filter: buildFilter((f) =>
        ids.length
          ? f.or(ids.map((id) => f.string('contractId').eq(id)))
          : f.string('id').eq('__none__'),
      ),
    });
  const add = (event: CashEvent) => {
    events.push(event);
  };
  for (const r of receipts) {
    add({
      id: `receipt:${r.id}`,
      receiptId: r.id,
      contractId: r.contractId,
      number: r.number,
      reference: text(r.payload.originalReference) || r.reference,
      at: r.createdAt,
      date: r.date,
      actor: String(r.payload.actor),
      method: String(r.payload.method ?? 'unclassified'),
      kind: 'receive',
      category: 'bill',
      amountCents: r.amountCents,
    });
    for (const e of entries.filter((e) => e.receiptId === r.id)) {
      let amount: bigint;
      if (e.kind === 'refund') amount = -BigInt(e.amountCents);
      else if (e.kind === 'reverseRefund') amount = BigInt(e.amountCents);
      else if (e.kind === 'void') amount = -BigInt(r.amountCents);
      else continue;
      add({
        id: `receiptEntry:${e.id}`,
        receiptId: r.id,
        contractId: r.contractId,
        number: r.number,
        reference: e.reference ?? '',
        at: e.createdAt,
        date: text(e.payload.date) || dayOf(e.createdAt),
        actor: String(e.payload.actor),
        method: String(r.payload.method ?? 'unclassified'),
        kind: e.kind,
        category: 'bill',
        amountCents: String(amount),
      });
    }
  }
  const leaseEntries = await c.repository<Entry>('hylLeaseEntries').findMany({
    filter: buildFilter((f) =>
      ids.length
        ? f.or(ids.map((id) => f.string('contractId').eq(id)))
        : f.string('id').eq('__none__'),
    ),
  });
  for (const e of leaseEntries) {
    const target = e.reverseOf
      ? leaseEntries.find((t) => t.id === e.reverseOf)
      : undefined;
    const original = target ?? e;
    if (!['receive', 'refund', 'collect'].includes(original.kind)) continue;
    let amount =
      BigInt(original.amountCents) * (original.kind === 'refund' ? -1n : 1n);
    if (target) amount = -amount;
    add({
      id: `leaseEntry:${e.id}`,
      contractId: e.contractId,
      number: String(e.reference ?? e.id),
      reference: e.reference ?? '',
      at: e.createdAt,
      date: text(e.payload.date) || dayOf(e.createdAt),
      actor: String(e.payload.actor),
      method: text(original.payload.method) || 'unclassified',
      kind: target ? `reverse:${original.kind}` : e.kind,
      category: original.kind === 'collect' ? 'leaseCollection' : 'deposit',
      amountCents: String(amount),
    });
  }
  const transfers = await c
    .repository<Transfer>('hylSplitTransfers')
    .findMany();
  for (const e of transfers.filter((e) => ids.includes(e.contractId))) {
    const original =
      e.kind === 'reverse'
        ? transfers.find((t) => t.id === e.sourceTransferId)
        : e;
    if (!original) continue;
    const sign =
      (original.kind === 'partnerPay' ? -1n : 1n) *
      (e.kind === 'reverse' ? -1n : 1n);
    add({
      id: `splitTransfer:${e.id}`,
      contractId: e.contractId,
      number: e.reference ?? e.id,
      reference: e.reference ?? '',
      at: e.createdAt,
      date: text(e.payload.date) || dayOf(e.createdAt),
      actor: String(e.payload.actor),
      method: text(e.payload.method) || 'unclassified',
      kind: e.kind === 'reverse' ? 'splitReverse' : e.kind,
      category: 'profitSharing',
      amountCents: String(sign * BigInt(e.amountCents)),
    });
  }
  events.sort((a, b) => a.id.localeCompare(b.id));
  return events;
}
export async function reportPreview(
  this: CashierService,
  access: Access,
  input: DayQuery,
  prepared?: { connection: DatabaseConnection; ids: string[] },
) {
  let ids: string[];
  const c = prepared?.connection ?? this.hyl.db.connection();
  if (prepared) ids = prepared.ids;
  else {
    const policy = await this.hyl.policy(
      access,
      'contracts',
      'cashierReconcileRead',
    );
    if (input.scope === 'authorized')
      await this.hyl.policy(access, 'contracts', 'cashierReconcileAll');
    ids = (
      await c.repository<Row>('hylContracts').withPolicy(policy).findMany()
    ).map((r) => String(r.id));
  }
  const events = (await collectCashEvents(c, ids)).filter(
    (event) =>
      dayOf(event.at) === input.day &&
      (input.scope === 'authorized' || event.actor === access.actor),
  );
  const channels: Record<
    string,
    {
      receivedCents: string;
      outCents: string;
      correctionCents: string;
      netCents: string;
    }
  > = {};
  for (const e of events) {
    const r = channels[e.method] ?? {
      receivedCents: '0',
      outCents: '0',
      correctionCents: '0',
      netCents: '0',
    };
    const n = BigInt(e.amountCents);
    if (e.kind === 'receive' || e.kind === 'collect' || e.kind === 'recover')
      r.receivedCents = String(BigInt(r.receivedCents) + n);
    else if (e.kind === 'refund' || e.kind === 'partnerPay')
      r.outCents = String(BigInt(r.outCents) - n);
    else r.correctionCents = String(BigInt(r.correctionCents) + n);
    r.netCents = String(BigInt(r.netCents) + n);
    channels[e.method] = r;
  }
  return {
    day: input.day,
    scope: input.scope,
    cutOff: new Date().toISOString(),
    sourceHash: hash({
      day: input.day,
      scope: input.scope,
      actor: input.scope === 'own' ? access.actor : '',
      // Reference metadata enriches finance drilldowns; preserve the existing daily snapshot fingerprint.
      events: events.map(({ reference: _reference, ...event }) => event),
    }),
    events,
    channels,
    receivedCents: String(
      Object.values(channels).reduce((n, r) => n + BigInt(r.receivedCents), 0n),
    ),
    refundedCents: String(
      Object.values(channels).reduce((n, r) => n + BigInt(r.outCents), 0n),
    ),
    netCents: String(events.reduce((n, e) => n + BigInt(e.amountCents), 0n)),
    cashCents: channels.cash?.netCents ?? '0',
    unclassified: events.some((e) => e.method === 'unclassified'),
  };
}
export async function confirmReport(
  this: CashierService,
  access: Access,
  input: ReconcileInput,
) {
  await this.hyl.policy(access, 'contracts', 'cashierReconcile');
  const preview = await this.reportPreview(access, input);
  const all = await this.hyl.db
    .repository<Row>('hylContracts')
    .withPolicy(await this.hyl.policy(access, 'contracts', 'cashierReconcile'))
    .findMany();
  if (!all.length) fail('ACCESS_DENIED', 'PERMISSION_DENIED');
  for (const e of preview.events)
    if (!all.some((c) => c.id === e.contractId))
      fail('ACCESS_DENIED', 'PERMISSION_DENIED');
  const merchantIds = [...new Set(all.map((r) => String(r.merchantId)))].sort();
  const merchantId = merchantIds[0];
  const readable = await this.visible(access, 'cashierReconcileRead');
  const ids = all.map((r) => String(r.id)).filter((id) => readable.has(id));
  return this.atomic(
    access,
    input.requestId,
    { reconcile: input },
    merchantId,
    async (c) => {
      // Compare committed membership again before freezing. Later events are explicitly tracked by replacement revisions.
      for (const id of merchantIds.slice(1)) await this.hyl.lockMerchant(c, id);
      const current = await this.reportPreview(access, input, {
        connection: c,
        ids,
      });
      if (current.sourceHash !== input.sourceHash)
        fail('VERSION_CONFLICT', 'ABORTED');
      const difference = cents(input.countedCash) - BigInt(current.cashCents);
      if (difference !== 0n && !input.differenceReason)
        fail('CASHIER_DIFFERENCE');
      const previous = (
        await c
          .repository<CashierRecord>('hylCashierReconciliations')
          .findMany({ filter: { day: input.day, actor: access.actor } })
      )
        .filter((r) => r.payload.scope === input.scope)
        .sort((a, b) => b.revision - a.revision)[0];
      const row = this.base(
        access,
        'HZ',
        merchantId,
        input.day,
        {
          ...current,
          countedCash: input.countedCash,
          evidence: input.evidence,
          differenceReason: input.differenceReason,
          notes: input.notes,
          previousId: previous?.id ?? '',
        },
        access.actor,
      );
      row.receivedCents = current.receivedCents;
      row.refundedCents = current.refundedCents;
      row.netCents = current.netCents;
      row.differenceCents = String(difference);
      row.revision = (previous?.revision ?? 0) + 1;
      await this.hyl.runtime.create(
        'hylCashierReconciliations',
        this.lifecycleValues(row),
        { actor: { id: access.actor }, transaction: c },
      );
      for (const contractId of new Set(current.events.map((e) => e.contractId)))
        await this.member(c, row.id, contractId, 'contract', contractId);
      if (!current.events.length)
        await this.member(
          c,
          row.id,
          String(all[0].id),
          'contract',
          String(all[0].id),
        );
      return row;
    },
  );
}
export async function reportDetail(
  this: CashierService,
  access: Access,
  id: string,
) {
  const row = await this.guard(
    access,
    'reconciliations',
    id,
    'cashierReconcileRead',
  );
  const current = await this.reportPreview(access, {
    day: row.day,
    scope: row.payload.scope as DayQuery['scope'],
  });
  const frozen = new Set((row.payload.events as CashEvent[]).map((e) => e.id));
  let can = false;
  try {
    can = (await this.visible(access, 'cashierReconcile')).size > 0;
  } catch {
    /* Missing action means read-only snapshot. */
  }
  return {
    ...row,
    laterEvents: current.events.filter((e) => !frozen.has(e.id)).length,
    allowedActions: [
      'cashierReconcileRead',
      ...(can ? ['cashierReconcile'] : []),
    ],
  };
}
