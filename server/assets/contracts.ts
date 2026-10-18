import type { ContractAsset } from './schema.js';
import { randomUUID } from 'node:crypto';
import type { DatabaseConnection, RepositoryPolicy } from '@nocobase/db';
import { fail } from '../hyl/service.js';
import type { Row } from '../hyl/schema.js';
import { type Binding, isLeaf } from './schema.js';
import {
  getAsset,
  lockProjects,
  available,
  assetSummary,
  audit,
} from './transactions.js';
export async function saveContractAssets(
  c: DatabaseConnection,
  row: Row,
  ids: string[],
  policy: RepositoryPolicy,
  actor: string,
) {
  const existing = await c
    .repository<ContractAsset>('hylContractAssets')
    .findMany({ filter: { contractId: row.id } });
  const assets = await Promise.all(ids.map((id) => getAsset(c, id, policy)));
  const removed = await Promise.all(
    existing
      .filter((e) => !ids.includes(String(e.assetId)))
      .map((e) => getAsset(c, String(e.assetId), policy)),
  );
  await lockProjects(
    c,
    [...assets, ...removed].map((a) => a.projectId),
  );
  for (const asset of [...assets, ...removed]) {
    const fresh = await getAsset(c, asset.id, policy);
    if (fresh.projectId !== asset.projectId)
      fail('VERSION_CONFLICT', 'ABORTED');
    Object.assign(asset, fresh);
  }
  const energyAssignments = await c
    .repository<{
      assetId: string;
      contractId: string;
      start: string;
      end: string;
    }>('hylEnergyAssignments')
    .findMany({ filter: { contractId: row.id } });
  if (
    energyAssignments.some(
      (a) =>
        !ids.includes(a.assetId) ||
        a.start < String(row.payload.start) ||
        (a.end ||
          String(
            existing.find((e) => e.assetId === a.assetId)?.end ||
              row.payload.end,
          )) > String(row.payload.end),
    )
  )
    fail('ENERGY_ASSIGNMENT_CONFLICT');
  for (const asset of assets) {
    if (!isLeaf(asset.type)) fail('ASSET_LEAF_REQUIRED', 'INVALID_ARGUMENT');
    const prior = existing.find((e) => e.assetId === asset.id);
    if (
      !prior ||
      prior.start !== String(row.payload.start) ||
      prior.end !== String(row.payload.end)
    )
      await available(c, asset);
    const bindings = await c
      .repository<Binding>('hylAssetBindings')
      .findMany({ filter: { merchantId: row.merchantId, assetId: asset.id } });
    if (
      !bindings.some(
        (b) =>
          b.start <= String(row.payload.start) &&
          (!b.end || b.end >= String(row.payload.end)),
      )
    ) {
      const occupants = await c
        .repository<Binding>('hylAssetBindings')
        .findMany({ filter: { assetId: asset.id } });
      if (
        occupants.some(
          (b) =>
            b.start <= String(row.payload.end) &&
            (!b.end || b.end >= String(row.payload.start)),
        )
      )
        fail('ASSET_BINDING_OVERLAP');
      const binding = {
        id: randomUUID(),
        merchantId: row.merchantId,
        assetId: asset.id,
        requestId: randomUUID(),
        start: String(row.payload.start),
        end: String(row.payload.end),
        area: asset.lettableArea,
        actor,
        version: 0,
        createdAt: new Date().toISOString(),
      };
      await c.repository('hylAssetBindings').createOne({ values: binding });
      await audit(c, asset.id, actor, 'bind', '', null, binding);
    }
  }
  for (const prior of existing)
    if (!ids.includes(String(prior.assetId))) {
      // Removed assets must also be authorized, and use the same project serialization.
      const asset = removed.find((a) => a.id === prior.assetId)!;
      await c
        .repository<ContractAsset>('hylContractAssets')
        .deleteMany({ filter: { id: String(prior.id) } });
      await audit(
        c,
        asset.id,
        actor,
        'contractUnlink',
        '',
        { contractId: row.id },
        {},
      );
    }
  for (const asset of assets) {
    const prior = existing.find((e) => e.assetId === asset.id);
    if (prior) {
      // Revalidate dates and allocation, but never refresh a historical signing snapshot.
      await c.repository<ContractAsset>('hylContractAssets').updateMany({
        filter: { id: String(prior.id) },
        values: {
          start: String(row.payload.start),
          end: String(row.payload.end),
        },
      });
    } else {
      await c.repository<ContractAsset>('hylContractAssets').createOne({
        values: {
          id: randomUUID(),
          assetId: asset.id,
          merchantId: row.merchantId,
          contractId: row.id,
          start: String(row.payload.start),
          end: String(row.payload.end),
          snapshot: assetSummary(asset),
          createdAt: new Date().toISOString(),
        },
      });
      await audit(c, asset.id, actor, 'contractLink', '', null, {
        contractId: row.id,
        start: String(row.payload.start),
        end: String(row.payload.end),
      });
    }
  }
}
