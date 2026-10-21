import type { DatabaseManager, RepositoryPolicy } from '@nocobase/db';
import { ApiError } from '@nocobase/app-server/router';
import { previousBusinessMonth, revenueComparison } from './comparison.js';
import { cents, money } from './calculation.js';
import { businessFilter } from './filters.js';
import { tables, type Kind, type Row } from './schema.js';

export function businessMonth(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}`;
}
export function turnover(payload: Record<string, unknown>): bigint {
  return (
    cents(String(payload.receipts)) -
    cents(String(payload.refunds)) +
    cents(String(payload.activity)) +
    cents(String(payload.cash)) +
    cents(String(payload.hospitality))
  );
}

export async function loadDashboard(
  db: DatabaseManager,
  policyFor: (kind: Kind) => Promise<RepositoryPolicy | null>,
  now = new Date(),
  selectedMonth?: string,
) {
  const month = selectedMonth ?? businessMonth(now);
  const [merchantsPolicy, revenuePolicy, settlementsPolicy] = await Promise.all(
    ['merchants', 'revenueReports', 'settlements'].map((k) =>
      policyFor(k as Kind),
    ),
  );
  if (!merchantsPolicy && !revenuePolicy && !settlementsPolicy)
    throw new ApiError({
      status: 'PERMISSION_DENIED',
      reason: 'ACCESS_DENIED',
      domain: 'hyl',
      message: 'No business data access.',
    });
  const merchants = merchantsPolicy
    ? await db
        .repository<Row>(tables.merchants)
        .withPolicy(merchantsPolicy)
        .count()
    : null;
  let revenue: string | null = null,
    unsettled: string | null = null,
    pendingReports: number | null = null,
    unpaid: string | null = null;
  let analytics: {
    previousMonth: string;
    comparison: ReturnType<typeof revenueComparison>;
    daily: { date: string; amount: string }[];
    reportCount: number;
    rankedMerchantCount: number;
    ranking: {
      merchantId: string;
      name: string | null;
      amount: string;
      reportCount: number;
      comparison: ReturnType<typeof revenueComparison>;
    }[];
  } | null = null;
  if (revenuePolicy) {
    const repo = db
      .repository<Row>(tables.revenueReports)
      .withPolicy(revenuePolicy);
    pendingReports = await repo.count({
      filter: businessFilter('revenueReports', { status: 'pending' }),
    });
    // Async iteration reads all scoped rows; totals must not inherit a list's 20/100-row cap.
    let monthly = 0n,
      unclaimed = 0n;
    const days = new Map<string, bigint>();
    const daysInMonth = new Date(`${month}-01T00:00:00Z`);
    daysInMonth.setUTCMonth(daysInMonth.getUTCMonth() + 1, 0);
    for (let day = 1; day <= daysInMonth.getUTCDate(); day++)
      days.set(`${month}-${String(day).padStart(2, '0')}`, 0n);
    const byMerchant = new Map<
      string,
      { amount: bigint; reportCount: number }
    >();
    let reportCount = 0;
    for await (const record of repo.findMany({
      filter: businessFilter('revenueReports', { view: 'monthRevenue', month }),
    })) {
      const row = record as Row;
      const value = turnover(row.payload);
      monthly += value;
      reportCount++;
      days.set(row.date, (days.get(row.date) ?? 0n) + value);
      const id = row.merchantId;
      const entry = byMerchant.get(id) ?? { amount: 0n, reportCount: 0 };
      entry.amount += value;
      entry.reportCount++;
      byMerchant.set(id, entry);
    }
    const previousMonth = previousBusinessMonth(month);
    const previousByMerchant = new Map<
      string,
      { amount: bigint; reportCount: number }
    >();
    let previousTotal = 0n,
      previousReportCount = 0;
    // Compare both months under the same revenue policy, before ranking/truncating merchants.
    for await (const record of repo.findMany({
      filter: businessFilter('revenueReports', {
        view: 'monthRevenue',
        month: previousMonth,
      }),
    })) {
      const row = record as Row;
      const value = turnover(row.payload);
      previousTotal += value;
      previousReportCount++;
      const entry = previousByMerchant.get(row.merchantId) ?? {
        amount: 0n,
        reportCount: 0,
      };
      entry.amount += value;
      entry.reportCount++;
      previousByMerchant.set(row.merchantId, entry);
    }
    const leaders = [...byMerchant.entries()]
      .sort(([a, x], [b, y]) =>
        x.amount === y.amount
          ? a < b
            ? -1
            : a > b
              ? 1
              : 0
          : x.amount > y.amount
            ? -1
            : 1,
      )
      .slice(0, 10);
    // A visible report does not grant access to the merchant profile or its name.
    const ranking = await Promise.all(
      leaders.map(async ([merchantId, value]) => {
        const merchant = merchantsPolicy
          ? await db
              .repository<Row>(tables.merchants)
              .withPolicy(merchantsPolicy)
              .findOne({ filter: { id: merchantId } })
          : null;
        return {
          merchantId,
          name: merchant?.name ?? null,
          amount: money(value.amount),
          reportCount: value.reportCount,
          comparison: revenueComparison(
            value.amount,
            previousByMerchant.get(merchantId)?.amount ?? 0n,
            previousByMerchant.get(merchantId)?.reportCount ?? 0,
          ),
        };
      }),
    );
    analytics = {
      previousMonth,
      comparison: revenueComparison(
        monthly,
        previousTotal,
        previousReportCount,
      ),
      reportCount,
      rankedMerchantCount: byMerchant.size,
      ranking,
      daily: [...days].map(([date, value]) => ({ date, amount: money(value) })),
    };

    for await (const row of repo.findMany({
      filter: businessFilter('revenueReports', { view: 'unsettled' }),
    }))
      unclaimed += turnover((row as Row).payload);
    revenue = money(monthly);
    unsettled = money(unclaimed);
  }
  if (settlementsPolicy) {
    const repo = db
      .repository<Row>(tables.settlements)
      .withPolicy(settlementsPolicy);
    let outstanding = 0n;
    const balances: { id: string; payable: bigint }[] = [];
    // Exhaust the scoped cursor before querying payments: SQLite streams hold
    // the sole connection, so nested queries would wait for their own cursor.
    for await (const row of repo.findMany({
      filter: businessFilter('settlements', { view: 'unpaid' }),
    })) {
      const settlement = row as Row;
      balances.push({
        id: settlement.id,
        payable: BigInt(settlement.amountCents),
      });
    }
    for (const balance of balances) {
      let paid = 0n;
      // Payment access is derived only from a settlement returned by the scoped read policy.
      for await (const payment of db
        .repository('hylPayments')
        .findMany({ filter: { settlementId: balance.id } }))
        paid += cents(
          String((payment.payload as Record<string, unknown>).amount),
        );
      const remaining = balance.payable - paid;
      outstanding += remaining > 0n ? remaining : 0n;
    }
    unpaid = money(outstanding);
  }
  return {
    month,
    analytics,
    updatedAt: now.toISOString(),
    merchants,
    revenue,
    pendingReports,
    unsettled,
    unpaid,
  };
}
