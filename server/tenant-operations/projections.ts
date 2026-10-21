import { cents } from '../hyl/calculation.js';
import { turnover } from '../hyl/dashboard.js';
import type { Row } from '../hyl/schema.js';
import type { Item, BankRow, Match } from './model.js';
export function daysInMonth(month: string) {
  const [y, m] = month.split('-').map(Number),
    n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from(
    { length: n },
    (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`,
  );
}
export function reportingRows(
  merchants: Row[],
  contracts: (Row & { end: string })[],
  reports: Row[],
  month: string,
  today: string,
): Item[] {
  return merchants.flatMap((m) =>
    daysInMonth(month)
      .filter(
        (day) =>
          day <= today &&
          contracts.some(
            (c) =>
              c.merchantId === m.id &&
              c.status !== 'draft' &&
              String(c.payload.start) <= day &&
              c.end >= day,
          ),
      )
      .map((day) => {
        const rows = reports.filter(
            (r) => r.merchantId === m.id && r.date === day,
          ),
          approved = rows.filter((r) => r.status === 'approved');
        const status = !rows.length
          ? 'missing'
          : rows.some((r) => r.status === 'returned')
            ? 'returned'
            : rows.some((r) => r.status === 'draft')
              ? 'draft'
              : rows.some((r) => r.status === 'pending')
                ? 'pending'
                : approved.length === rows.length
                  ? 'approved'
                  : 'partial';
        return {
          id: m.id + ':' + day,
          name: m.name,
          date: day,
          status,
          amountCents: String(
            approved.reduce((s, r) => s + turnover(r.payload), 0n),
          ),
          detail: String(rows.length),
          path: `/revenueReports?merchantId=${encodeURIComponent(m.id)}&from=${day}&to=${day}`,
          kind: '',
          sourceId: '',
        };
      }),
  );
}
export function ageBucket(due: string, today: string) {
  const days = Math.floor(
    (Date.parse(today + 'T00:00:00Z') - Date.parse(due + 'T00:00:00Z')) /
      86400000,
  );
  return days <= 0
    ? 'due'
    : days <= 30
      ? 'age30'
      : days <= 60
        ? 'age60'
        : days <= 90
          ? 'age90'
          : 'ageOver90';
}
export function businessRows(
  merchants: Row[],
  reports: Row[],
  month: string,
): Item[] {
  const groups = new Map<string, Item>();
  for (const r of reports.filter(
    (r) => r.status === 'approved' && r.date.startsWith(month),
  )) {
    const name = merchants.find((m) => m.id === r.merchantId)?.name;
    if (!name) continue;
    const key = r.merchantId + ':' + r.date + ':' + String(r.payload.source);
    const row = groups.get(key) ?? {
      id: key,
      name,
      date: r.date,
      status: 'approved',
      amountCents: '0',
      detail: String(r.payload.source),
      path: `/revenueReports?merchantId=${encodeURIComponent(r.merchantId)}&from=${r.date}&to=${r.date}`,
      kind: '',
      sourceId: '',
    };
    row.amountCents = String(BigInt(row.amountCents) + turnover(r.payload));
    groups.set(key, row);
  }
  return [...groups.values()];
}
export interface CashEvent {
  id: string;
  date: string;
  reference: string;
  amountCents: string;
  method: string;
}
export function candidates(
  row: BankRow,
  events: CashEvent[],
  matches: Match[],
) {
  const used = new Set(matches.map((m) => m.eventId));
  return events.filter(
    (e) =>
      !used.has(e.id) &&
      e.date === row.date &&
      e.reference === row.reference &&
      BigInt(e.amountCents) === BigInt(row.amountCents) &&
      e.method === row.method,
  );
}
/** UTF-8 BOM and string cells prevent spreadsheet formula execution; cents stay exact. */
export function csv(rows: string[][]): string {
  return (
    '\uFEFF' +
    rows
      .map((row) =>
        row
          .map(
            (s) =>
              '"' +
              (/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replaceAll('"', '""') +
              '"',
          )
          .join(','),
      )
      .join('\r\n')
  );
}
export const signedCents = (value: string) =>
  value.startsWith('-') ? -cents(value.slice(1)) : cents(value);

/** Same reference with differing financial attributes is a discrepancy, never an automatic match. */
export function differences(row: BankRow, events: CashEvent[]) {
  return events
    .filter(
      (e) =>
        e.reference === row.reference &&
        (e.date !== row.date ||
          e.method !== row.method ||
          BigInt(e.amountCents) !== BigInt(row.amountCents)),
    )
    .map((e) => ({
      ...e,
      differenceCents: String(BigInt(row.amountCents) - BigInt(e.amountCents)),
    }));
}
