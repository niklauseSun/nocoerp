import { z } from 'zod';
import type { DatabaseConnection } from '@nocobase/db';
import type { FileRecord } from '@nocobase/app-plugin-file/server';
import { fail } from '../hyl/service.js';
export const photoRecord = z.object({
  id: z.uuid(),
  filename: z.string(),
  ext: z.string(),
  mimeType: z.string(),
  size: z.union([z.number(), z.string()]),
  createdAt: z.string(),
  updatedAt: z.string(),
  contentUrl: z.string(),
});
export type PhotoStage = 'report' | 'processing' | 'acceptance';
export type RepairFile = FileRecord & {
  ownerId: string;
  assetId: string;
  orderId: string;
  stage: PhotoStage;
  linked: boolean;
};
export const photoIds = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];
export function publicPhoto(file: RepairFile, basePath: string) {
  return {
    id: file.id,
    filename: file.filename,
    ext: file.ext,
    mimeType: file.mimeType,
    size: file.size,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    contentUrl: `${basePath}/uploads/repairPhotos/${file.id}.${file.ext}`,
  };
}
/** Called under the same project lock/transaction as the business transition. */
export async function linkPhotos(
  c: DatabaseConnection,
  ids: string[],
  actor: string,
  assetId: string,
  orderId: string,
  stage: PhotoStage,
) {
  if (ids.length > 9 || new Set(ids).size !== ids.length)
    fail('REPAIR_PHOTO_INVALID');
  for (const id of ids) {
    const repo = c.repository<RepairFile>('hylRepairFiles');
    const file = await repo.findOne({ filter: { id } });
    if (
      !file ||
      file.assetId !== assetId ||
      file.stage !== stage ||
      (file.linked
        ? file.orderId !== orderId || stage !== 'report'
        : file.ownerId !== actor ||
          (file.orderId !== orderId && !(stage === 'report' && !file.orderId)))
    )
      fail('REPAIR_PHOTO_INVALID');
    if (!file.linked)
      await repo.updateOne({
        filter: { id, linked: false },
        values: { linked: true, orderId },
      });
  }
}
export async function readPhotos(
  c: DatabaseConnection,
  orderId: string,
  ids: string[],
  basePath: string,
) {
  // Parent access must be checked by caller; never trust payload to expose another order's files.
  const rows = await c
    .repository<RepairFile>('hylRepairFiles')
    .findMany({ filter: { orderId, linked: true } });
  const byId = new Map(rows.map((f) => [f.id, f]));
  return ids.flatMap((id) => {
    const f = byId.get(id);
    return f ? [publicPhoto(f, basePath)] : [];
  });
}
