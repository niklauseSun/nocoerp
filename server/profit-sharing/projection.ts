import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseConnection } from '@nocobase/db';
import type { HylService } from '../hyl/service.js';
import { fail } from '../hyl/service.js';
import type { Row } from '../hyl/schema.js';
import { cents } from '../hyl/calculation.js';
import { effectiveEntries, type Entry } from '../leases/model.js';
import { liveCash } from '../billing/accounting.js';
import type { Bill, BillLine, ReceiptEntry } from '../billing/model.js';
import { apportion, balances } from './calculation.js';
import type {
  Rule,
  Order,
  Snapshot,
  Line,
  SourceInput,
  Transfer,
} from './model.js';
export const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const zero = {
  grossPaidCents: '0',
  recoveredCents: '0',
  netPaidCents: '0',
  remainingCents: '0',
  recoveryCents: '0',
};
export async function snapshot(
  c: DatabaseConnection,
  input: SourceInput,
  existing?: Order,
): Promise<Snapshot | null> {
  const source = await c
    .repository<Bill | Row>(
      input.sourceKind === 'bill' ? 'hylBills' : 'hylSettlements',
    )
    .findOne({ filter: { id: input.sourceId } });
  if (!source) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
  const contractId =
    input.sourceKind === 'bill'
      ? (source as Bill).contractId
      : String((source as Row).payload.contractId);
  const contract = await c
    .repository<Row>('hylContracts')
    .findOne({ filter: { id: contractId } });
  if (!contract) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
  const merchant = await c
    .repository<Row>('hylMerchants')
    .findOne({ filter: { id: contract.merchantId } });
  const start =
    input.sourceKind === 'bill'
      ? (source as Bill).start
      : String((source as Row).payload.start);
  const rules = await c.repository<Rule>('hylSplitRules').findMany({
    filter: { contractId },
    sort: (s) => [s.field('effectiveFrom').asc()],
  });
  const rule =
    existing?.payload.snapshot.rule ??
    rules.filter((r) => r.effectiveFrom <= start).at(-1);
  if (!rule?.enabled) return null;
  let sourceFunds: bigint, cost: bigint;
  let shareBase = 0n,
    gap = 0n;
  const sources: Snapshot['sources'] = [];
  const lines: Line[] = [];
  const feeComposition: NonNullable<Snapshot['feeComposition']> = [];
  let excludedDepositCents = '0';
  let operatingComposition: Record<string, string> | undefined;
  let eligible: boolean;
  if (input.sourceKind === 'bill') {
    const b = source as Bill;
    eligible = b.status === 'issued';
    const entries = liveCash(
      await c
        .repository<ReceiptEntry>('hylReceiptEntries')
        .findMany({ filter: { billId: b.id } }),
    )
      .filter((e) => e.kind === 'allocate')
      .sort((a, b) => a.id.localeCompare(b.id));
    sourceFunds = entries.reduce((n, e) => n + BigInt(e.amountCents), 0n);
    for (const e of entries) {
      const receipt = await c
        .repository<{ id: string; number: string }>('hylReceipts')
        .findOne({ filter: { id: e.receiptId } });
      sources.push({
        id: e.receiptId,
        kind: 'receipt',
        number: receipt?.number ?? e.receiptId,
        amountCents: e.amountCents,
        allocationId: e.id,
      });
    }
    const feeLines = (
      await c
        .repository<BillLine>('hylBillLines')
        .findMany({ filter: { billId: b.id } })
    ).filter((l) => BigInt(l.amountCents) > 0n);
    if (sourceFunds > 0n) {
      const parts = apportion(
        sourceFunds,
        feeLines.map((l) => ({ key: l.id, weight: BigInt(l.amountCents) })),
      );
      shareBase = feeLines
        .filter((l) =>
          rule.payload.billFeeTypes.includes(
            l.feeType as Rule['payload']['billFeeTypes'][number],
          ),
        )
        .reduce((n, l) => n + parts[l.id], 0n);
    }
    excludedDepositCents = b.depositCents;
    const feeCash =
      sourceFunds > 0n
        ? apportion(
            sourceFunds,
            feeLines.map((l) => ({ key: l.id, weight: BigInt(l.amountCents) })),
          )
        : {};
    for (const l of feeLines)
      feeComposition.push({
        id: l.id,
        feeType: l.feeType,
        amountCents: l.amountCents,
        cashCents: String(feeCash[l.id] ?? 0n),
        included: rule.payload.billFeeTypes.includes(
          l.feeType as Rule['payload']['billFeeTypes'][number],
        ),
      });
    cost = sourceFunds - shareBase;
    if (!eligible) {
      sourceFunds = 0n;
      shareBase = 0n;
      cost = 0n;
    }
  } else {
    const s = source as Row,
      amounts = s.payload.amounts as Record<string, string>;
    eligible = ['payable', 'partial', 'paid', 'settled', 'due'].includes(
      s.status,
    );
    if (!eligible && !existing) return null;
    const funding = effectiveEntries(
      await c
        .repository<Entry>('hylLeaseEntries')
        .findMany({ filter: { contractId } }),
    )
      .filter(
        (e) => e.sourceId === s.id && ['collect', 'deduct'].includes(e.kind),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    sourceFunds =
      cents(amounts.collected) +
      funding.reduce((n, e) => n + BigInt(e.amountCents), 0n);
    shareBase = cents(amounts.fee) + cents(amounts.rent);
    cost = cents(amounts.deductions);
    const payable = BigInt(s.amountCents) > 0n ? BigInt(s.amountCents) : 0n;
    operatingComposition = {
      collectedCents: String(cents(amounts.collected)),
      feeCents: String(cents(amounts.fee)),
      rentCents: String(cents(amounts.rent)),
      deductionsCents: String(cents(amounts.deductions)),
      payableCents: String(payable),
    };
    gap = shareBase + cost + payable - sourceFunds;
    if (gap < 0n) gap = 0n;
    for (const e of funding)
      sources.push({
        id: e.id,
        kind: e.kind,
        number: e.reference ?? e.id,
        amountCents: e.amountCents,
      });
    lines.push({
      key: 'merchant',
      kind: 'merchant',
      name: merchant?.name ?? '',
      accountLabel:
        typeof merchant?.payload.accountName === 'string'
          ? merchant.payload.accountName
          : '',
      rate: '',
      targetCents: String(payable),
      ...zero,
    });
    if (!eligible) {
      sourceFunds = 0n;
      shareBase = 0n;
      cost = 0n;
      lines[0].targetCents = '0';
    }
  }
  if (!existing && sourceFunds === 0n && input.sourceKind === 'bill')
    return null;
  const parts = apportion(
    shareBase,
    rule.payload.recipients.map((r) => ({ key: r.key, weight: cents(r.rate) })),
  );
  for (const r of rule.payload.recipients)
    lines.push({ ...r, targetCents: String(parts[r.key]), ...zero });
  if (cost > 0n)
    lines.push({
      key: 'cost',
      kind: 'cost',
      name: '',
      accountLabel: '',
      rate: '',
      targetCents: String(cost),
      ...zero,
    });
  const transfers = existing
    ? await c
        .repository<Transfer>('hylSplitTransfers')
        .findMany({ filter: { orderId: existing.id } })
    : [];
  const reversed = new Set(
    transfers
      .filter((e) => e.kind === 'reverse')
      .map((e) => e.sourceTransferId),
  );
  const active = transfers.filter(
    (e) => e.kind !== 'reverse' && !reversed.has(e.id),
  );
  const payments =
    input.sourceKind === 'settlement'
      ? await c
          .repository<{
            id: string;
            settlementId: string;
            payload: Record<string, unknown>;
          }>('hylPayments')
          .findMany({ filter: { settlementId: source.id } })
      : [];
  for (const line of lines) {
    const paid =
      line.kind === 'merchant'
        ? payments.reduce((n, p) => n + cents(String(p.payload.amount)), 0n)
        : active
            .filter(
              (e) => e.recipientKey === line.key && e.kind === 'partnerPay',
            )
            .reduce((n, e) => n + BigInt(e.amountCents), 0n);
    const recovered = active
      .filter((e) => e.recipientKey === line.key && e.kind === 'recover')
      .reduce((n, e) => n + BigInt(e.amountCents), 0n);
    line.grossPaidCents = String(paid);
    line.recoveredCents = String(recovered);
    Object.assign(
      line,
      balances(
        ['project', 'cost'].includes(line.kind) ? 0n : BigInt(line.targetCents),
        paid,
        recovered,
      ),
    );
  }
  const sum = (key: keyof Line) =>
    String(lines.reduce((n, l) => n + BigInt(String(l[key])), 0n));
  const state = {
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    sourceNumber: source.number,
    sourceStart: start,
    contractId,
    contractNumber: contract.number,
    merchantId: contract.merchantId,
    merchantName: merchant?.name ?? '',
    rule,
    sourceFundsCents: String(sourceFunds),
    shareBaseCents: String(shareBase),
    retainedTargetCents: String(
      lines
        .filter((l) => l.kind === 'project')
        .reduce((n, l) => n + BigInt(l.targetCents), 0n),
    ),
    costTargetCents: String(cost),
    fundingGapCents: String(gap),
    lines,
    sources,
    operatingComposition,
    feeComposition,
    excludedDepositCents,
    sourceHash: '',
    sourceVersion: source.version,
    grossPaidCents: sum('grossPaidCents'),
    recoveredCents: sum('recoveredCents'),
    netPaidCents: sum('netPaidCents'),
    remainingCents: sum('remainingCents'),
    recoveryCents: sum('recoveryCents'),
  };
  state.sourceHash = fingerprint({
    eligible,
    ruleId: rule.id,
    sourceFunds: String(sourceFunds),
    shareBase: String(shareBase),
    cost: String(cost),
    gap: String(gap),
    targets: lines.map((l) => ({ key: l.key, target: l.targetCents })),
    sources: sources.map(({ id, kind, number, amountCents }) => ({
      id,
      kind,
      number,
      amountCents,
    })),
  });
  return state;
}
export async function projectSource(
  c: DatabaseConnection,
  hyl: HylService,
  input: SourceInput,
  actor: string,
  force = false,
) {
  let order = await c.repository<Order>('hylSplitOrders').findOne({
    filter: { sourceKind: input.sourceKind, sourceId: input.sourceId },
  });
  const next = await snapshot(c, input, order ?? undefined);
  if (!next) return null;
  if (!order) {
    // Historical backfill is explicit. Automatic generation only happens at a new eligible source event.
    const id = randomUUID(),
      now = new Date().toISOString();
    const values = {
      id,
      number: `FZ-${now.slice(0, 10).replaceAll('-', '')}-${id.slice(0, 8)}`,
      contractId: next.contractId,
      merchantId: next.merchantId,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      activeRevision: 0,
      version: 0,
      sourceHash: '',
      sourceFundsCents: '0',
      netPaidCents: '0',
      remainingCents: '0',
      recoveryCents: '0',
      payload: { snapshot: next, reviewedHash: '' },
      searchText: `${next.sourceNumber} ${next.contractNumber} ${next.merchantName}`,
      createdAt: now,
      updatedAt: now,
    };
    await hyl.runtime.create('hylSplitOrders', values, {
      actor: { id: actor },
      transaction: c,
    });
    order = (await c
      .repository<Order>('hylSplitOrders')
      .findOne({ filter: { id } }))!;
  }
  if (order.status === 'cancelled' && !force) return order;
  const changed = order.sourceHash !== next.sourceHash;
  const reviewed = !changed && order.payload.reviewedHash === next.sourceHash;
  const state = !reviewed
    ? order.activeRevision > 0
      ? 'adjustmentPending'
      : 'pendingReview'
    : BigInt(next.remainingCents) === 0n &&
        BigInt(next.recoveryCents) === 0n &&
        BigInt(next.fundingGapCents) === 0n
      ? 'completed'
      : BigInt(next.netPaidCents) > 0n
        ? 'partiallyExecuted'
        : 'ready';
  const revision = order.activeRevision + (changed ? 1 : 0);
  if (changed)
    await c.repository('hylSplitRevisions').createOne({
      values: {
        id: randomUUID(),
        orderId: order.id,
        revision,
        sourceHash: next.sourceHash,
        payload: { ...next },
        actor,
        createdAt: new Date().toISOString(),
      },
    });
  if (
    changed ||
    order.status !== state ||
    JSON.stringify(order.payload.snapshot) !== JSON.stringify(next)
  ) {
    if (order.status !== state)
      await hyl.runtime.fire('hylSplitOrders', order.id, 'refresh', {
        actor: { id: actor },
        transaction: c,
        expect: { version: order.lifecycleVersion },
        input: { state },
      });
    await c.repository('hylSplitOrders').updateOne({
      filter: { id: order.id },
      values: {
        activeRevision: revision,
        version: order.version + 1,
        sourceHash: next.sourceHash,
        sourceFundsCents: next.sourceFundsCents,
        netPaidCents: next.netPaidCents,
        remainingCents: next.remainingCents,
        recoveryCents: next.recoveryCents,
        payload: { ...order.payload, snapshot: next },
        updatedAt: new Date().toISOString(),
      },
    });
  }
  return (await c
    .repository<Order>('hylSplitOrders')
    .findOne({ filter: { id: order.id } }))!;
}
export async function syncContract(
  c: DatabaseConnection,
  hyl: HylService,
  contractId: string,
  actor: string,
) {
  if (!(await c.repository('hylSplitRules').exists({ filter: { contractId } })))
    return;
  const contract = await c
    .repository<Row>('hylContracts')
    .findOne({ filter: { id: contractId } });
  if (!contract) return;
  const bills = await c
    .repository<Bill>('hylBills')
    .findMany({ filter: { contractId } });
  for (const b of bills)
    await projectSource(c, hyl, { sourceKind: 'bill', sourceId: b.id }, actor);
  const settlements = await c
    .repository<Row>('hylSettlements')
    .findMany({ filter: { merchantId: contract.merchantId } });
  for (const s of settlements.filter(
    (s) => s.payload.contractId === contractId,
  ))
    await projectSource(
      c,
      hyl,
      { sourceKind: 'settlement', sourceId: s.id },
      actor,
    );
}
