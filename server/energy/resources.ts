import { defineCompositeResource } from '@nocobase/authorization/core';
import {
  defineDatabasePermission,
  type AppAuthorization,
} from '@nocobase/app-plugin-authorization/server';
import { assetFields } from '../assets/schema.js';
import { energyActions } from './model.js';
const assets = defineDatabasePermission((p) =>
  p.collection('hylAssets').read(assetFields),
);
export const energyResource = defineCompositeResource('hyl.energy', (r) => {
  let resource = r.title({ key: 'energy.title', ns: 'nocoerp' });
  for (const action of energyActions)
    resource = resource.action(action, (a) => {
      const grant = a
        .title({ key: 'energy.actions.' + action, ns: 'nocoerp' })
        .grant('assets', assets);
      return grant;
    });
  return resource;
});
export function registerEnergy(authz: AppAuthorization) {
  for (const name of [
    'hylEnergyMeters',
    'hylEnergyAssignments',
    'hylEnergyReadings',
    'hylEnergyBillLinks',
    'hylEnergyOperations',
    'hylEnergyAudit',
  ])
    authz.database.collections.add({
      name,
      title: { key: 'energy.title', ns: 'nocoerp' },
    });
  authz.compositeResources.define(energyResource);
  authz.ui.place(energyResource.reference(), { section: 'hyl' });
}
