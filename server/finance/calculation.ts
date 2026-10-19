import type { Bill, Receipt, ReceiptEntry } from '../billing/model.js';
import type { Entry } from '../leases/model.js';
import { depositBalance, effectiveEntries } from '../leases/model.js';
import { liveCash } from '../billing/accounting.js';
import type { Row } from '../hyl/schema.js';
import type { Row as Purchase } from '../procurement/model.js';
import { cents } from '../hyl/calculation.js';
import { dayOf, type CashEvent } from '../cashier/reports.js';
import type { Line, Check } from './model.js';
export interface Payment {
  id: string;
  settlementId: string;
  reference: string;
  payload: Record<string, unknown>;
}
export interface Sources {
  contracts: Row[];
  bills: Bill[];
  receipts: Receipt[];
  receiptEntries: ReceiptEntry[];
  leaseEntries: Entry[];
  settlements: Row[];
  payments: Payment[];
  purchaseOrders: Purchase[];
  purchaseLedger: Purchase[];
  cash: CashEvent[];
  projects: { id: string; name: string }[];
  contractProjects: Record<string, string>;
  contractParties?: Record<string, string>;
  purchaseParties?: Record<string, string>;
}
const text = (v: unknown) => (typeof v === 'string' ? v : '');
const sum = <T>(rows: T[], value: (r: T) => bigint) =>
  rows.reduce((a, r) => a + value(r), 0n);
export function calculateReport(
  s: Sources,
  range: { from: string; to: string },
) {
  const lines: Record<
    'cash' | 'receivables' | 'payables' | 'deposits',
    Line[]
  > = { cash: [], receivables: [], payables: [], deposits: [] };
  const checks: Check[] = [];
  const check = (
    id: string,
    type: string,
    number: string,
    expected: bigint,
    actual: bigint,
  ) =>
    checks.push({
      id,
      type,
      number,
      expectedCents: String(expected),
      actualCents: String(actual),
      differenceCents: String(expected - actual),
    });
  const line = (
    values: Partial<Line> & Pick<Line, 'id' | 'kind' | 'type' | 'number'>,
  ): Line => ({
    title: '',
    partyName: '',
    projectId: '',
    contractId: '',
    at: '',
    date: '',
    reference: '',
    amountCents: '0',
    appliedCents: '0',
    remainingCents: '0',
    openingCents: '0',
    movementCents: '0',
    closingCents: '0',
    ...values,
  });
  const meta = (id: string) => ({
    contractId: id,
    projectId: s.contractProjects[id] ?? '',
    title: s.contracts.find((c) => c.id === id)?.number ?? '',
    partyName: s.contractParties?.[id] ?? '',
  });
  const liveLease = effectiveEntries(s.leaseEntries),
    liveReceipt = liveCash(s.receiptEntries);
  for (const b of s.bills.filter((b) => b.status === 'issued')) {
    const deposit = sum(
      liveLease.filter(
        (e) =>
          e.kind === 'deduct' &&
          e.sourceId === b.id &&
          e.payload.sourceType === 'bill',
      ),
      (e) => BigInt(e.amountCents),
    );
    const allocated = sum(
      liveReceipt.filter((e) => e.kind === 'allocate' && e.billId === b.id),
      (e) => BigInt(e.amountCents),
    );
    const remaining = BigInt(b.amountCents) - deposit - allocated;
    lines.receivables.push(
      line({
        ...meta(b.contractId),
        id: 'bill:' + b.id,
        kind: 'receivable',
        type: 'bill',
        number: b.number,
        at: b.createdAt,
        date: b.dueDate,
        amountCents: b.amountCents,
        appliedCents: String(deposit + allocated),
        remainingCents: String(remaining),
      }),
    );
    check(
      'bill:' + b.id + ':remaining',
      'bill',
      b.number,
      remaining,
      BigInt(b.remainingCents),
    );
    check(
      'bill:' + b.id + ':deposit',
      'billDeposit',
      b.number,
      deposit,
      BigInt(b.depositCents),
    );
    check(
      'bill:' + b.id + ':allocated',
      'billAllocated',
      b.number,
      allocated,
      BigInt(b.allocatedCents),
    );
  }
  const coverage = (id: string) =>
    sum(
      liveLease.filter(
        (e) => ['deduct', 'collect'].includes(e.kind) && e.sourceId === id,
      ),
      (e) => BigInt(e.amountCents),
    );
  for (const e of liveLease.filter((e) => e.kind === 'charge')) {
    if (
      !s.leaseEntries.some(
        (x) => x.kind === 'confirmCharge' && x.sourceId === e.id,
      ) ||
      s.leaseEntries.some(
        (x) => x.kind === 'cancelCharge' && x.sourceId === e.id,
      )
    )
      continue;
    const applied = coverage(e.id);
    lines.receivables.push(
      line({
        ...meta(e.contractId),
        id: 'charge:' + e.id,
        kind: 'receivable',
        type: 'charge',
        number: e.reference ?? e.id,
        at: e.createdAt,
        date: text(e.payload.date),
        amountCents: e.amountCents,
        appliedCents: String(applied),
        remainingCents: String(BigInt(e.amountCents) - applied),
      }),
    );
  }
  for (const r of s.settlements) {
    if (!['due', 'payable', 'partial', 'paid', 'settled'].includes(r.status))
      continue;
    const n = BigInt(r.amountCents),
      contractId = text(r.payload.contractId);
    if (n < 0n) {
      const applied = coverage(r.id);
      lines.receivables.push(
        line({
          ...meta(contractId),
          id: 'settlement:' + r.id,
          kind: 'receivable',
          type: 'settlementDebt',
          number: r.number,
          at: r.createdAt,
          date: r.date,
          amountCents: String(-n),
          appliedCents: String(applied),
          remainingCents: String(-n - applied),
        }),
      );
    } else {
      const paid = sum(
        s.payments.filter((p) => p.settlementId === r.id),
        (p) => cents(String(p.payload.amount)),
      );
      lines.payables.push(
        line({
          ...meta(contractId),
          id: 'settlement:' + r.id,
          kind: 'payable',
          type: 'settlement',
          number: r.number,
          at: r.createdAt,
          date: r.date,
          amountCents: String(n),
          appliedCents: String(paid),
          remainingCents: String(n - paid),
        }),
      );
    }
  }
  for (const o of s.purchaseOrders) {
    const ledger = s.purchaseLedger.filter((e) => e.orderId === o.id),
      accepted = sum(
        ledger.filter((e) => e.type === 'accrual'),
        (e) => BigInt(e.amountCents),
      ),
      paid = sum(
        ledger.filter((e) => ['payment', 'paymentReversal'].includes(e.type)),
        (e) => BigInt(e.amountCents) * (e.type === 'payment' ? 1n : -1n),
      );
    if (accepted !== 0n || paid !== 0n)
      lines.payables.push(
        line({
          id: 'purchase:' + o.id,
          kind: 'payable',
          type: 'procurement',
          number: o.number,
          title: o.title,
          partyName: s.purchaseParties?.[o.id] ?? '',
          projectId: o.projectId,
          at: o.createdAt,
          date: o.day,
          amountCents: String(accepted),
          appliedCents: String(paid),
          remainingCents: String(accepted - paid),
        }),
      );
    check(
      'purchase:' + o.id + ':accepted',
      'purchaseAccepted',
      o.number,
      accepted,
      BigInt(o.acceptedCents),
    );
    check(
      'purchase:' + o.id + ':paid',
      'purchasePaid',
      o.number,
      paid,
      BigInt(o.paidCents),
    );
  }
  let advance = 0n;
  for (const r of s.receipts) {
    const entries = liveReceipt.filter((e) => e.receiptId === r.id),
      allocated = sum(
        entries.filter((e) => e.kind === 'allocate'),
        (e) => BigInt(e.amountCents),
      ),
      refunded = sum(
        entries.filter((e) => e.kind === 'refund'),
        (e) => BigInt(e.amountCents),
      ),
      unused =
        r.status === 'voided'
          ? 0n
          : BigInt(r.amountCents) - allocated - refunded;
    advance += unused;
    check(
      'receipt:' + r.id + ':unused',
      'receiptUnused',
      r.number,
      unused,
      BigInt(r.unusedCents),
    );
    check(
      'receipt:' + r.id + ':allocated',
      'receiptAllocated',
      r.number,
      allocated,
      BigInt(r.allocatedCents),
    );
    check(
      'receipt:' + r.id + ':refunded',
      'receiptRefunded',
      r.number,
      refunded,
      BigInt(r.refundedCents),
    );
  }
  let currentDeposit = 0n;
  for (const c of s.contracts) {
    const entries = s.leaseEntries.filter((e) => e.contractId === c.id);
    if (!entries.length) continue;
    const effects = entries.map((e) => {
      const original = e.reverseOf
        ? entries.find((x) => x.id === e.reverseOf)
        : e;
      if (!original) return { day: dayOf(e.createdAt), value: 0n };
      const sign = ['receive', 'transferIn'].includes(original.kind)
        ? 1n
        : ['deduct', 'refund', 'transferOut'].includes(original.kind)
          ? -1n
          : 0n;
      return {
        day: dayOf(e.createdAt),
        value: BigInt(original.amountCents) * sign * (e.reverseOf ? -1n : 1n),
      };
    });
    const opening = sum(
        effects.filter((x) => x.day < range.from),
        (e) => e.value,
      ),
      movement = sum(
        effects.filter((x) => x.day >= range.from && x.day <= range.to),
        (e) => e.value,
      ),
      closing = opening + movement,
      current = depositBalance(entries);
    currentDeposit += current;
    lines.deposits.push(
      line({
        ...meta(c.id),
        id: c.id,
        kind: 'deposit',
        type: 'deposit',
        number: c.number,
        at: entries
          .map((e) => e.createdAt)
          .sort()
          .at(-1)!,
        amountCents: String(current),
        remainingCents: String(current),
        openingCents: String(opening),
        movementCents: String(movement),
        closingCents: String(closing),
      }),
    );
    check(
      'deposit:' + c.id,
      'deposit',
      c.number,
      sum(effects, (e) => e.value),
      current,
    );
  }
  const all = s.cash.map((e) =>
    line({
      ...meta(e.contractId),
      id: e.id,
      kind: 'event',
      type: e.category,
      number: e.number,
      title: e.kind,
      at: e.at,
      date: e.date,
      reference: e.reference ?? e.number,
      amountCents: e.amountCents,
    }),
  );
  lines.cash = all.filter(
    (e) => dayOf(e.at) >= range.from && dayOf(e.at) <= range.to,
  );
  const opening = sum(
      all.filter((e) => dayOf(e.at) < range.from),
      (e) => BigInt(e.amountCents),
    ),
    received = sum(
      lines.cash.filter((e) => BigInt(e.amountCents) > 0n),
      (e) => BigInt(e.amountCents),
    ),
    paid = -sum(
      lines.cash.filter((e) => BigInt(e.amountCents) < 0n),
      (e) => BigInt(e.amountCents),
    );
  const categories = [...new Set(lines.cash.map((e) => e.type))].map(
    (type) => ({
      type,
      receivedCents: String(
        sum(
          lines.cash.filter(
            (e) => e.type === type && BigInt(e.amountCents) > 0n,
          ),
          (e) => BigInt(e.amountCents),
        ),
      ),
      paidCents: String(
        -sum(
          lines.cash.filter(
            (e) => e.type === type && BigInt(e.amountCents) < 0n,
          ),
          (e) => BigInt(e.amountCents),
        ),
      ),
      netCents: String(
        sum(
          lines.cash.filter((e) => e.type === type),
          (e) => BigInt(e.amountCents),
        ),
      ),
    }),
  );
  const summary = {
    openingCashCents: String(opening),
    receivedCents: String(received),
    paidCents: String(paid),
    netCents: String(received - paid),
    closingCashCents: String(opening + received - paid),
    receivableCents: String(
      sum(lines.receivables, (e) => BigInt(e.remainingCents)),
    ),
    merchantPayableCents: String(
      sum(
        lines.payables.filter((e) => e.type === 'settlement'),
        (e) => BigInt(e.remainingCents),
      ),
    ),
    supplierPayableCents: String(
      sum(
        lines.payables.filter((e) => e.type === 'procurement'),
        (e) => BigInt(e.remainingCents),
      ),
    ),
    depositCents: String(currentDeposit),
    advanceCents: String(advance),
  };
  for (const r of [...lines.receivables, ...lines.payables, ...lines.deposits])
    if (BigInt(r.remainingCents) < 0n)
      check(
        'negative:' + r.kind + ':' + r.id,
        'negativeBalance',
        r.number,
        0n,
        BigInt(r.remainingCents),
      );
  return { summary, categories, checks, lines };
}
