import { defineCompositeResource } from '@nocobase/authorization/core';
import {
  defineDatabasePermission,
  type AppAuthorization,
} from '@nocobase/app-plugin-authorization/server';
import { assetFields } from '../assets/schema.js';
export const approvalResource = defineCompositeResource(
  'hyl.approvals',
  (r) => {
    let base = r.title({ key: 'approval.title', ns: 'nocoerp' });
    for (const a of ['read', 'configure', 'submit', 'decide', 'cancel'])
      base = base.action(a, (v) =>
        v.title({ key: 'approval.permissions.' + a, ns: 'nocoerp' }).grant(
          'assets',
          defineDatabasePermission((p) =>
            p.collection('hylAssets').read(assetFields),
          ),
        ),
      );
    return base;
  },
);
export function registerApprovals(authz: AppAuthorization) {
  authz.compositeResources.define(approvalResource);
  authz.ui.place(approvalResource.reference(), { section: 'hyl' });
}
