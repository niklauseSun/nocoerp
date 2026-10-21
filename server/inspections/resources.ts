import { defineCompositeResource } from '@nocobase/authorization/core';
import {
  defineDatabasePermission,
  type AppAuthorization,
} from '@nocobase/app-plugin-authorization/server';
import { assetFields } from '../assets/schema.js';
const assets = defineDatabasePermission((p) =>
  p.collection('hylAssets').read(assetFields),
);
export const inspectionResource = defineCompositeResource(
  'hyl.inspections',
  (r) => {
    let resource = r.title({ key: 'inspection.title', ns: 'nocoerp' });
    for (const action of ['read', 'manage', 'execute', 'rectify', 'review'])
      resource = resource.action(action, (a) =>
        a
          .title({ key: 'inspection.permissions.' + action, ns: 'nocoerp' })
          .grant('assets', assets),
      );
    return resource;
  },
);
export function registerInspections(authz: AppAuthorization) {
  for (const name of [
    'hylInspectionPlans',
    'hylInspectionTasks',
    'hylInspectionIssues',
    'hylInspectionEvents',
    'hylInspectionOperations',
  ])
    authz.database.collections.add({
      name,
      title: { key: 'inspection.title', ns: 'nocoerp' },
    });
  authz.compositeResources.define(inspectionResource);
  authz.ui.place(inspectionResource.reference(), { section: 'hyl' });
}
