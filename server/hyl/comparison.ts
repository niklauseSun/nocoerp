import { money } from './calculation.js';

export function previousBusinessMonth(month: string): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

/** Percent is a decimal string in percent units, rounded half away from zero to 2 places. */
export function revenueComparison(
  current: bigint,
  previous: bigint,
  previousReportCount: number,
) {
  const change = current - previous;
  const absolute = change < 0n ? -change : change;
  const rounded =
    previous > 0n ? (absolute * 10000n + previous / 2n) / previous : null;
  return {
    previousAmount: money(previous),
    changeAmount: money(change),
    changePercent:
      rounded === null ? null : money(change < 0n ? -rounded : rounded),
    previousReportCount,
  };
}
