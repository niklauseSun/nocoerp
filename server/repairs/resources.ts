import { defineCompositeResource } from '@nocobase/authorization/core';
import {
  defineDatabasePermission,
  type AppAuthorization,
} from '@nocobase/app-plugin-authorization/server';
import { assetFields } from '../assets/schema.js';
const assets = defineDatabasePermission((p) =>
  p.collection('hylAssets').read(assetFields),
);
export const repairResource = defineCompositeResource('hyl.repairs', (r) => {
  let resource = r.title({ key: 'repair.title', ns: 'nocoerp' });
  for (const action of [
    'read',
    'report',
    'dispatch',
    'process',
    'accept',
    'close',
    'cancel',
  ])
    resource = resource.action(action, (a) =>
      a
        .title({ key: 'repair.permissions.' + action, ns: 'nocoerp' })
        .grant('assets', assets),
    );
  return resource;
});
export function registerRepairs(authz: AppAuthorization) {
  for (const name of [
    'hylRepairOrders',
    'hylRepairEvents',
    'hylRepairOperations',
  ])
    authz.database.collections.add({
      name,
      title: { key: 'repair.title', ns: 'nocoerp' },
    });
  authz.compositeResources.define(repairResource);
  authz.ui.place(repairResource.reference(), { section: 'hyl' });
}
