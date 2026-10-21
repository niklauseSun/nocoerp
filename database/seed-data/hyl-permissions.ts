import { definePermissionSet } from '@nocobase/authorization/permission-sets';
import { resources } from '../../server/hyl/resources.js';
import { kinds, type Kind } from '../../server/hyl/schema.js';
function role(
  key: string,
  label: string,
  scope: string,
  actions: Record<Kind, string[]>,
) {
  let set = definePermissionSet(key).title(label);
  for (const kind of kinds) {
    if (!actions[kind].length) continue;
    set = set.grant({
      resource: { type: 'page', id: `hyl-${kind}` },
      actions: [{ action: 'access' }],
    });
    set = set.grant(
      resources[kind]
        .reference()
        .grant(
          Object.fromEntries(
            actions[kind].map((action) => [action, { records: scope }]),
          ),
        ),
    );
  }
  return set.build();
}
export const hylPermissionSets = [
  role('hyl-finance', '财务人员', 'allRecords', {
    merchants: ['read', 'write'],
    contracts: ['read', 'write'],
    revenueReports: ['read', 'write', 'submit', 'review'],
    expenses: ['read', 'write', 'submit', 'review'],
    settlements: ['read', 'write', 'review', 'confirm', 'pay'],
  }),
  role('hyl-merchant', '商户用户', 'hyl.ownMerchant', {
    merchants: ['read'],
    contracts: ['read'],
    revenueReports: ['read', 'write', 'submit'],
    expenses: ['read', 'write', 'submit'],
    settlements: ['read', 'confirm'],
  }),
  role('hyl-observer', '只读管理人员', 'allRecords', {
    merchants: ['read'],
    contracts: ['read'],
    revenueReports: ['read'],
    expenses: ['read'],
    settlements: ['read'],
  }),
];
