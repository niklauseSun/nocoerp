import { cents } from '../hyl/calculation.js';
import { fail } from '../hyl/service.js';
import type { DatabaseManager, RepositoryPolicy } from '@nocobase/db';
import type { Row } from '../hyl/schema.js';
import type { ListInput, Access, HylService } from '../hyl/service.js';
import { depositBalance, getLease, money } from './model.js';
import type { Entry } from './model.js';
/** Derived lease state is date-sensitive; it never overwrites the signed contract or accounting snapshots. */
export async function listLeases(
  db: DatabaseManager,
  policy: RepositoryPolicy,
  input: ListInput,
  hyl: HylService,
  access: Access,
) {
  if (
    !['updatedAt', 'date', 'end', 'depositTarget', 'depositBalance'].some((c) =>
      [`${c}:asc`, `${c}:desc`].includes(input.orderBy),
    )
  )
    fail('INVALID_SORT', 'INVALID_ARGUMENT');
  if (input.from && input.to && input.to < input.from)
    fail('INVALID_PERIOD', 'INVALID_ARGUMENT');
  const rows = (await db
    .repository<Row>('hylContracts')
    .withPolicy(policy)
    .findMany({})) as Row[];
  const financial = await hyl
    .policy(access, 'contracts', 'depositRead')
    .catch(() => undefined);
  const visible = new Set(
    financial
      ? (
          await db
            .repository<Row>('hylContracts')
            .withPolicy(financial)
            .findMany({})
        ).map((r) => r.id)
      : [],
  );
  const today = new Date().toISOString().slice(0, 10);
  const data = [];
  for (const row of rows) {
    const lease = await getLease(db.connection(), row),
      end =
        lease.actualEnd && lease.actualEnd < String(row.payload.end)
          ? lease.actualEnd
          : String(row.payload.end),
      state =
        lease.status === 'active'
          ? String(row.payload.start) > today
            ? 'future'
            : String(row.payload.end) < today
              ? 'expired'
              : 'active'
          : lease.status;
    if (input.status && input.status !== state) continue;
    if (input.merchantId && input.merchantId !== row.merchantId) continue;
    const q = (input.q ?? '').toLocaleLowerCase();
    if (
      q &&
      ![
        row.number,
        row.name,
        typeof row.payload.title === 'string' ? row.payload.title : '',
      ].some((v) => v.toLocaleLowerCase().includes(q))
    )
      continue;
    if (
      (input.from && end < input.from) ||
      (input.to && String(row.payload.start) > input.to)
    )
      continue;
    const links = await db
      .repository('hylContractAssets')
      .findMany({ filter: { contractId: row.id } });
    const entries = visible.has(row.id)
      ? await db
          .repository<Entry>('hylLeaseEntries')
          .findMany({ filter: { contractId: row.id } })
      : undefined;
    data.push({
      ...row,
      ...(entries
        ? {}
        : {
            payload: Object.fromEntries(
              Object.entries(row.payload).filter(
                ([key]) => key !== 'depositTarget',
              ),
            ),
          }),
      leaseState: state,
      leaseEnd: end,
      assetNames: links
        .map((l) =>
          typeof (l.snapshot as Record<string, unknown>).name === 'string'
            ? (l.snapshot as { name: string }).name
            : '',
        )
        .join(' / '),
      depositTarget: entries
        ? typeof row.payload.depositTarget === 'string'
          ? row.payload.depositTarget
          : '0'
        : null,
      depositBalance: entries ? money(depositBalance(entries)) : null,
    });
  }
  const [column = 'updatedAt', direction = 'desc'] = input.orderBy.split(':');
  data.sort((a, b) => {
    const av =
      column === 'end'
        ? a.leaseEnd
        : column === 'depositTarget' || column === 'depositBalance'
          ? a[column]
          : a[column as 'updatedAt' | 'date'];
    const bv =
      column === 'end'
        ? b.leaseEnd
        : column === 'depositTarget' || column === 'depositBalance'
          ? b[column]
          : b[column as 'updatedAt' | 'date'];
    const left = column.startsWith('deposit')
        ? av === null
          ? -1n
          : cents(String(av))
        : String(av),
      right = column.startsWith('deposit')
        ? bv === null
          ? -1n
          : cents(String(bv))
        : String(bv);
    const diff = left < right ? -1 : left > right ? 1 : 0;
    return (direction === 'asc' ? diff : -diff) || a.id.localeCompare(b.id);
  });
  return {
    data: data.slice(
      (input.page - 1) * input.pageSize,
      input.page * input.pageSize,
    ),
    meta: { total: data.length, page: input.page, pageSize: input.pageSize },
  };
}
