import {
  defineCompositeResource,
  defineRecordAccess,
} from '@nocobase/authorization/core';
import {
  defineDatabasePermission,
  type AppAuthorization,
} from '@nocobase/app-plugin-authorization/server';
import { buildFilter } from '@nocobase/repository-input';
import type { DatabaseManager } from '@nocobase/db';
import { kinds, tables, type Kind } from './schema.js';
const fields = [
  'id',
  'number',
  'name',
  'merchantId',
  'userId',
  'date',
  'status',
  'payload',
  'version',
  'lifecycleVersion',
  'statusChangedAt',
  'createdAt',
  'updatedAt',
  'amountCents',
  'settlementId',
];
export const resources = Object.fromEntries(
  kinds.map((kind) => {
    const data = defineDatabasePermission((p) =>
      p
        .collection(tables[kind])
        .title({ key: `hyl.nav.${kind}`, ns: 'nocoerp' })
        .read(fields),
    );
    return [
      kind,
      defineCompositeResource(`hyl.${kind}`, (r) =>
        r
          .title({ key: `hyl.nav.${kind}`, ns: 'nocoerp' })
          .action('read', (a) =>
            a
              .title({ key: 'hyl.actions.view', ns: 'nocoerp' })
              .grant('records', data),
          )
          .action('write', (a) =>
            a
              .title({ key: 'hyl.actions.edit', ns: 'nocoerp' })
              .grant('records', data.create(fields).update(fields)),
          )
          .action('submit', (a) =>
            a
              .title({ key: 'hyl.actions.submit', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('review', (a) =>
            a
              .title({ key: 'hyl.actions.approve', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('confirm', (a) =>
            a
              .title({ key: 'hyl.actions.confirm', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('pay', (a) =>
            a
              .title({ key: 'hyl.actions.pay', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          ),
      ),
    ];
  }),
) as Record<Kind, ReturnType<typeof defineCompositeResource>>;
export function registerResources(
  authz: AppAuthorization,
  db: DatabaseManager,
): void {
  authz.ui.sections.add({
    name: 'hyl',
    title: { key: 'hyl.copy.workspace', ns: 'nocoerp' },
    parent: 'business',
  });
  for (const kind of kinds) {
    authz.database.collections.add({
      name: tables[kind],
      title: { key: `hyl.nav.${kind}`, ns: 'nocoerp' },
    });
    authz.compositeResources.define(resources[kind]);
    authz.ui.place(resources[kind].reference(), { section: 'hyl' });
  }
  authz.recordAccess.define(
    defineRecordAccess('hyl.ownMerchant', (access) =>
      access
        .title({ key: 'hyl.ownMerchant', ns: 'nocoerp' })
        .collections(...Object.values(tables))
        .resolver(async ({ principal, collection }) => {
          if (principal.type !== 'user') return false;
          if (collection === tables.merchants)
            return buildFilter((f) => f.string('userId').eq(principal.id));
          const merchants = await db
            .repository(tables.merchants)
            .findMany({ filter: { userId: principal.id } });
          if (!merchants.length) return false;
          return buildFilter((f) =>
            f.or(
              merchants.map((m) =>
                f.string('merchantId').eq(typeof m.id === 'string' ? m.id : ''),
              ),
            ),
          );
        }),
    ),
  );
}
