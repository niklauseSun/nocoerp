import type { JsonValue } from '@nocobase/db';
import { randomUUID } from 'node:crypto';
import type { DatabaseConnection, RepositoryPolicy } from '@nocobase/db';
import { fail } from '../hyl/service.js';
import { assetFields, type Asset } from './schema.js';
export async function getAsset(
  c: DatabaseConnection,
  id: string,
  policy: RepositoryPolicy,
): Promise<Asset> {
  const row = await c
    .repository<Asset>('hylAssets')
    .withPolicy(policy)
    .findOne({ filter: { id } });
  if (!row) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
  return row as Asset;
}
export async function lockProjects(c: DatabaseConnection, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) {
    const project = await c
      .repository<Asset>('hylAssets')
      .findOne({ filter: { id } });
    if (!project) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    const result = await c.repository('hylAssets').updateMany({
      filter: { id, version: project.version },
      values: { version: Number(project.version) + 1 },
    });
    if (result.updatedCount !== 1) fail('VERSION_CONFLICT', 'ABORTED');
  }
}
export async function audit(
  c: DatabaseConnection,
  assetId: string,
  actor: string,
  action: string,
  reason: string,
  before: unknown,
  after: unknown,
) {
  await c.repository('hylAssetHistory').createOne({
    values: {
      id: randomUUID(),
      assetId,
      actor,
      action,
      reason,
      before:
        before === null
          ? null
          : (JSON.parse(JSON.stringify(before)) as JsonValue),
      after: JSON.parse(JSON.stringify(after)) as JsonValue,
      createdAt: new Date().toISOString(),
    },
  });
}
export async function available(c: DatabaseConnection, asset: Asset) {
  let node: Asset | undefined = asset;
  const seen = new Set<string>();
  while (node) {
    if (seen.has(node.id) || node.state !== 'normal') fail('ASSET_UNAVAILABLE');
    seen.add(node.id);
    node = node.parentId
      ? await c
          .repository<Asset>('hylAssets')
          .findOne({ filter: { id: node.parentId } })
      : undefined;
  }
}
export function assetSummary(asset: Asset) {
  const {
    id,
    number,
    name,
    type,
    projectId,
    parentId,
    address,
    floor,
    location,
    area,
    lettableArea,
    state,
  } = asset;
  return {
    id,
    number,
    name,
    type,
    projectId,
    parentId,
    address,
    floor,
    location,
    area,
    lettableArea,
    state,
  };
}
export { assetFields };
