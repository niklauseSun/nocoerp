import { defineCompositeResource } from '@nocobase/authorization/core';
import {
  defineDatabasePermission,
  type AppAuthorization,
} from '@nocobase/app-plugin-authorization/server';
import { assetFields } from '../assets/schema.js';
import { tables } from './model.js';
const assets = defineDatabasePermission((p) =>
  p.collection('hylAssets').read(assetFields),
);
export const procurementResource = defineCompositeResource(
  'hyl.procurement',
  (r) => {
    let base = r.title({ key: 'procurement.title', ns: 'nocoerp' });
    for (const action of [
      'read',
      'manage',
      'request',
      'review',
      'purchase',
      'receive',
      'accept',
      'financeRead',
      'pay',
      'reverse',
    ])
      base = base.action(action, (a) =>
        a
          .title({ key: 'procurement.permissions.' + action, ns: 'nocoerp' })
          .grant('assets', assets),
      );
    return base;
  },
);
export function registerProcurement(authz: AppAuthorization) {
  for (const name of [
    ...Object.values(tables),
    'hylPurchaseEvents',
    'hylPurchaseOperations',
  ])
    authz.database.collections.add({
      name,
      title: { key: 'procurement.title', ns: 'nocoerp' },
    });
  authz.compositeResources.define(procurementResource);
  authz.ui.place(procurementResource.reference(), { section: 'hyl' });
}
