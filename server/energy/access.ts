import type { HylService, Access } from '../hyl/service.js';
import { fail } from '../hyl/service.js';
import { assetPolicy } from '../providers/assets.js';
import { getAsset } from '../assets/transactions.js';
import type { EnergyRecord } from './model.js';
/** Called before entering Billing's transaction; callers cannot bypass source permissions by posting readingIds directly. */
export async function prepareEnergyBillAccess(
  hyl: HylService,
  access: Access,
  contractId: string,
  ids: string[],
) {
  const decision = await access.authorization.authorize({
      resource: { type: 'composite', id: 'hyl.energy' },
      action: 'billGenerate',
    }),
    policy = decision.conditions?.database?.hylAssets;
  if (decision.effect === 'deny' || !policy)
    fail('ACCESS_DENIED', 'PERMISSION_DENIED');
  const assets = await assetPolicy(access, 'read');
  for (const id of ids) {
    const r = await hyl.db
      .repository<EnergyRecord>('hylEnergyReadings')
      .findOne({ filter: { id } });
    if (!r || r.contractId !== contractId)
      fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    await getAsset(hyl.db.connection(), r.assetId, policy);
    await getAsset(hyl.db.connection(), r.assetId, assets);
  }
  await hyl.get(access, 'contracts', contractId, 'read');
  await hyl.get(access, 'contracts', contractId, 'billingRead');
}
