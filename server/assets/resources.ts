import { defineCompositeResource } from '@nocobase/authorization/core';
import {
  defineDatabasePermission,
  type AppAuthorization,
} from '@nocobase/app-plugin-authorization/server';
import { definePermissionSet } from '@nocobase/authorization/permission-sets';
import type { DatabaseManager } from '@nocobase/db';
import { assetFields } from './schema.js';
const data = defineDatabasePermission((p) =>
  p
    .collection('hylAssets')
    .title({ key: 'assets.title', ns: 'nocoerp' })
    .read(assetFields),
);
export const assetResource = defineCompositeResource('hyl.assets', (r) =>
  r
    .title({ key: 'assets.title', ns: 'nocoerp' })
    .action('read', (a) =>
      a
        .title({ key: 'hyl.actions.view', ns: 'nocoerp' })
        .grant('records', data),
    )
    .action('write', (a) =>
      a
        .title({ key: 'hyl.actions.edit', ns: 'nocoerp' })
        .grant('records', data.create(assetFields).update(assetFields)),
    ),
);
export async function registerAssets(
  authz: AppAuthorization,
  db: DatabaseManager,
) {
  authz.database.collections.add({
    name: 'hylAssets',
    title: { key: 'assets.title', ns: 'nocoerp' },
  });
  authz.compositeResources.define(assetResource);
  authz.ui.place(assetResource.reference(), { section: 'hyl' });
  await provisionAssetDefaults(authz, db);
}
export async function provisionAssetDefaults(
  authz: AppAuthorization,
  db: DatabaseManager,
) {
  // One-time additive defaults; later administrator changes remain authoritative.
  const setup = db.repository('hylAssetSetup');
  if (await setup.exists({ filter: { id: 'permissions-v1' } })) return;
  for (const [key, actions] of [
    ['hyl-finance', ['read', 'write']],
    ['hyl-observer', ['read']],
  ] as const) {
    const existing = await authz.permissionSets.get(key);
    if (!existing) continue;
    const grants = definePermissionSet(key)
      .grant({
        resource: { type: 'page', id: 'hyl-assets' },
        actions: [{ action: 'access' }],
      })
      .grant(
        assetResource
          .reference()
          .grant(
            Object.fromEntries(
              actions.map((action) => [action, { records: 'allRecords' }]),
            ),
          ),
      )
      .build().grants;
    const combined = [...existing.grants];
    for (const grant of grants)
      if (!combined.some((g) => JSON.stringify(g) === JSON.stringify(grant)))
        combined.push(grant);
    await authz.permissionSets.update(key, {
      key,
      title: existing.title,
      grants: combined,
    });
  }
  await setup.upsertOne({
    filter: { id: 'permissions-v1' },
    create: { id: 'permissions-v1' },
    update: { id: 'permissions-v1' },
  });
}
