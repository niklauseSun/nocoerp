import { defineCompositeResource } from '@nocobase/authorization/core';
import {
  defineDatabasePermission,
  type AppAuthorization,
} from '@nocobase/app-plugin-authorization/server';
import { assetFields } from '../assets/schema.js';
const fields = [
  'id',
  'number',
  'name',
  'merchantId',
  'status',
  'payload',
  'version',
  'createdAt',
  'updatedAt',
  'date',
  'amountCents',
];
export const financeResource = defineCompositeResource('hyl.finance', (r) =>
  r.title({ key: 'finance.title', ns: 'nocoerp' }).action('read', (a) =>
    a
      .title({ key: 'finance.read', ns: 'nocoerp' })
      .grant(
        'contracts',
        defineDatabasePermission((p) =>
          p.collection('hylContracts').read(fields),
        ),
      )
      .grant(
        'assets',
        defineDatabasePermission((p) =>
          p.collection('hylAssets').read(assetFields),
        ),
      ),
  ),
);
export function registerFinance(authz: AppAuthorization) {
  authz.compositeResources.define(financeResource);
  authz.ui.place(financeResource.reference(), { section: 'hyl' });
}
