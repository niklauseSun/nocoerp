import { cents } from '../hyl/calculation.js';
import { fail } from '../hyl/service.js';
export function checkoutTotals(input: {
  targets: { contractId: string; amount: string; deposit: string }[];
  payments: {
    amount: string;
    splits: { contractId: string; amount: string }[];
  }[];
}) {
  const rows = new Map<
    string,
    { contractId: string; received: bigint; allocated: bigint; deposit: bigint }
  >();
  for (const t of input.targets) {
    const r = rows.get(t.contractId) ?? {
      contractId: t.contractId,
      received: 0n,
      allocated: 0n,
      deposit: 0n,
    };
    r.allocated += cents(t.amount);
    r.deposit += cents(t.deposit);
    rows.set(t.contractId, r);
  }
  for (const p of input.payments) {
    if (
      cents(p.amount) <= 0n ||
      p.splits.reduce((n, s) => n + cents(s.amount), 0n) !== cents(p.amount) ||
      new Set(p.splits.map((s) => s.contractId)).size !== p.splits.length
    )
      fail('CASHIER_SPLIT');
    for (const s of p.splits) {
      const r = rows.get(s.contractId);
      if (!r || cents(s.amount) <= 0n) fail('CASHIER_SPLIT');
      r.received += cents(s.amount);
    }
  }
  const contracts = [...rows.values()].map((r) => {
    if (r.received < r.allocated) fail('BILLING_INSUFFICIENT');
    return {
      contractId: r.contractId,
      receivedCents: String(r.received),
      allocatedCents: String(r.allocated),
      depositCents: String(r.deposit),
      unusedCents: String(r.received - r.allocated),
    };
  });
  const sum = (
    key: 'receivedCents' | 'allocatedCents' | 'depositCents' | 'unusedCents',
  ) => String(contracts.reduce((n, r) => n + BigInt(r[key]), 0n));
  return {
    receivedCents: sum('receivedCents'),
    allocatedCents: sum('allocatedCents'),
    depositCents: sum('depositCents'),
    unusedCents: sum('unusedCents'),
    contracts,
  };
}
