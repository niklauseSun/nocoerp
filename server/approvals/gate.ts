import { ApiError } from '@nocobase/app-server/router';
import type { DatabaseConnection, DatabaseManager } from '@nocobase/db';
import type { Request } from './model.js';
import type { Kind } from './schema.js';
import { parameters, scope } from './parameters.js';
export function refuse(
  reason: string,
  status:
    | 'FAILED_PRECONDITION'
    | 'ABORTED'
    | 'PERMISSION_DENIED'
    | 'NOT_FOUND'
    | 'ALREADY_EXISTS' = 'FAILED_PRECONDITION',
): never {
  throw new ApiError({ status, reason, domain: 'approvals', message: reason });
}
export async function latest(
  c: DatabaseConnection,
  kind: Kind,
  sourceId: string,
) {
  const rows = await c.repository<Request>('hylApprovalRequests').findMany({
    filter: { kind, sourceId },
    sort: (s) => [s.field('createdAt').desc(), s.field('id').desc()],
  });
  return rows[0]?.status === 'cancelled' ? undefined : rows[0];
}
export async function editable(c: DatabaseConnection, kind: Kind, id: string) {
  if ((await latest(c, kind, id))?.status === 'pending')
    refuse('APPROVAL_SOURCE_LOCKED');
}
export async function projectForContract(
  c: DatabaseConnection,
  assetIds: unknown,
) {
  const projects = new Set<string>();
  for (const id of Array.isArray(assetIds) ? assetIds : []) {
    const a = await c
      .repository<{ id: string; projectId: string }>('hylAssets')
      .findOne({ filter: { id: String(id) } });
    if (!a) refuse('APPROVAL_SOURCE_MISSING', 'NOT_FOUND');
    projects.add(a.projectId);
  }
  return [...projects];
}
export async function contractRule(
  db: DatabaseManager,
  c: DatabaseConnection,
  assetIds: unknown,
  kind: Kind = 'contracts',
) {
  const projects = await projectForContract(c, assetIds),
    rules = await Promise.all(
      projects.map((id) =>
        parameters(db).read(
          scope(id, kind),
          'approval',
          c === db.connection() ? undefined : c,
        ),
      ),
    );
  if (projects.length > 1 && rules.some((r) => r?.values.enabled))
    refuse('APPROVAL_ONE_PROJECT_REQUIRED');
  return {
    projectId: projects[0] ?? '',
    enabled: rules.some((r) => r?.values.enabled === true),
    revision: rules[0]?.revision ?? 0,
  };
}
export async function ruleForSource(
  db: DatabaseManager,
  c: DatabaseConnection,
  kind: Kind,
  id: string,
) {
  if (kind === 'purchases') {
    const r = await c
      .repository<{ id: string; projectId: string }>('hylPurchaseRequests')
      .findOne({ filter: { id } });
    if (!r) refuse('APPROVAL_SOURCE_MISSING', 'NOT_FOUND');
    const p = await parameters(db).read(
      scope(r.projectId, kind),
      'approval',
      c === db.connection() ? undefined : c,
    );
    return {
      projectId: r.projectId,
      enabled: p?.values.enabled === true,
      revision: p?.revision ?? 0,
    };
  }
  const source =
    kind === 'bills'
      ? await c
          .repository<{ id: string; contractId: string }>('hylBills')
          .findOne({ filter: { id } })
      : { contractId: id };
  if (!source) refuse('APPROVAL_SOURCE_MISSING', 'NOT_FOUND');
  const contract = await c
    .repository<{ id: string; payload: Record<string, unknown> }>(
      'hylContracts',
    )
    .findOne({ filter: { id: source.contractId } });
  if (!contract) refuse('APPROVAL_SOURCE_MISSING', 'NOT_FOUND');
  return contractRule(db, c, contract.payload.assetIds, kind);
}
export async function requires(
  db: DatabaseManager,
  c: DatabaseConnection,
  kind: Kind,
  id: string,
) {
  return (
    (await ruleForSource(db, c, kind, id)).enabled ||
    !!(await latest(c, kind, id))
  );
}
export async function approved(
  db: DatabaseManager,
  c: DatabaseConnection,
  kind: Kind,
  id: string,
  version: number,
  state = 'approved',
) {
  if (!(await requires(db, c, kind, id))) return;
  const r = await latest(c, kind, id);
  if (!r || r.status !== state || r.sourceVersion !== version)
    refuse('APPROVAL_REQUIRED');
}
