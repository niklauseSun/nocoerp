import { defineRecordAccess } from '@nocobase/authorization/core';
import { buildFilter } from '@nocobase/repository-input';
import type { OrganizationService } from './service.js';
import type { Row } from '../hyl/schema.js';
import type { Asset, Binding } from '../assets/schema.js';
const collections = [
  'hylAssets',
  'hylMerchants',
  'hylContracts',
  'hylRevenueReports',
  'hylExpenses',
  'hylSettlements',
];
/** Trusted relationship lookup, not a business listing. Excludes a shared merchant unless every associated project is in scope. */
export async function projectScope(
  org: OrganizationService,
  userId: string,
  collection: string,
) {
  const ids = await org.projectIds(userId);
  if (!ids.length) return false;
  if (collection === 'hylAssets')
    return buildFilter((f) =>
      f.or(ids.map((id) => f.string('projectId').eq(id))),
    );
  const c = org.db.connection(),
    assets = await c.repository<Asset>('hylAssets').findMany(),
    projects = new Map(assets.map((a) => [a.id, a.projectId])),
    allowed = new Set(ids);
  const memberships = new Map<string, Set<string>>();
  const add = (merchantId: string, assetId: string) => {
    const s = memberships.get(merchantId) ?? new Set<string>();
    s.add(projects.get(assetId) ?? '__unknown__');
    memberships.set(merchantId, s);
  };
  for (const binding of await c
    .repository<Binding>('hylAssetBindings')
    .findMany())
    add(binding.merchantId, binding.assetId);
  const contracts = await c.repository<Row>('hylContracts').findMany();
  for (const contract of contracts) {
    const assetIds = contract.payload.assetIds;
    if (!Array.isArray(assetIds) || !assetIds.length) {
      const s = memberships.get(contract.merchantId) ?? new Set<string>();
      s.add('__unknown__');
      memberships.set(contract.merchantId, s);
    } else for (const id of assetIds) add(contract.merchantId, String(id));
  }
  const merchantIds = [...memberships]
    .filter(([, set]) => set.size && [...set].every((id) => allowed.has(id)))
    .map(([id]) => id);
  if (!merchantIds.length) return false;
  const field = collection === 'hylMerchants' ? 'id' : 'merchantId';
  return buildFilter((f) =>
    f.or(merchantIds.map((id) => f.string(field).eq(id))),
  );
}
export function registerOrganizationAccess(org: OrganizationService) {
  const authz = org.authz;
  authz.ui.sections.add({
    name: 'hyl-organization',
    title: { key: 'organization.title', ns: 'nocoerp' },
    parent: 'administration',
  });
  authz.settings.add({
    id: 'hyl.organization',
    title: { key: 'organization.title', ns: 'nocoerp' },
    actions: ['read', 'update'].map((name) => ({
      name,
      title: { key: 'organization.' + name, ns: 'nocoerp' },
    })),
  });
  authz.ui.place(
    { type: 'settings', id: 'hyl.organization' },
    { section: 'hyl-organization' },
  );
  authz.recordAccess.define(
    defineRecordAccess('hyl.assignedProjects', (a) =>
      a
        .title({ key: 'organization.projectScope', ns: 'nocoerp' })
        .collections(...collections)
        .resolver(({ principal, collection }) =>
          principal.type === 'user'
            ? projectScope(org, principal.id, collection)
            : false,
        ),
    ),
  );
  return authz.subjects.add<import('@nocobase/db').DatabaseConnection>(
    'org.department',
    {
      resolveFor: (principal) =>
        principal.type === 'user'
          ? org.subjects(principal.id)
          : Promise.resolve([]),
      filterActive: (ids, connection) => org.filterActive(ids, connection),
      administration: {
        title: { key: 'organization.departments', ns: 'nocoerp' },
        selection: {
          type: 'collection',
          list: async ({ search, page, pageSize }) => {
            const rows = (await org.tree()).filter((x) =>
              x.title.toLowerCase().includes((search ?? '').toLowerCase()),
            );
            return {
              items: rows
                .slice((page - 1) * pageSize, page * pageSize)
                .map((x) => ({ id: x.id, title: x.title })),
              total: rows.length,
            };
          },
          resolve: async (ids) =>
            (await org.tree())
              .filter((x) => ids.includes(x.id))
              .map((x) => ({ id: x.id, title: x.title })),
        },
      },
    },
  );
}
