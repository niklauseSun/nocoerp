import type { FileRecord } from '@nocobase/app-plugin-file/server';
import type { Access } from '../hyl/service.js';
import { fail } from '../hyl/service.js';
import { AssetService, assetPolicy } from './assets.js';
import { fileLinkSchema } from '../assets/schema.js';
import { getAsset, lockProjects, audit } from '../assets/transactions.js';
export type AssetFile = FileRecord & {
  assetId: string;
  ownerId: string;
  linked: boolean;
  category: string;
  title: string;
  uploadId?: string | null;
  uploadHash: string;
};
export type AssetCleanup = {
  id: string;
  assetId: string;
  ownerId: string;
  disk: string;
  key: string;
};
export class AssetFiles {
  constructor(
    readonly assets: AssetService,
    readonly basePath: string,
  ) {}
  public(file: AssetFile) {
    return {
      id: file.id,
      filename: file.filename,
      ext: file.ext,
      mimeType: file.mimeType,
      size: file.size,
      title: file.title,
      category: file.category,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      contentUrl: `${this.basePath}/uploads/assets/${file.id}.${file.ext}`,
    };
  }
  async authorize(access: Access, id: string) {
    const file = await this.assets.hyl.db
      .repository<AssetFile>('hylAssetFiles')
      .findOne({ filter: { id } });
    if (!file) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    await this.assets.get(access, file.assetId, file.linked ? 'read' : 'write');
    if (!file.linked && file.ownerId !== access.actor)
      fail('ACCESS_DENIED', 'PERMISSION_DENIED');
    return file;
  }
  async list(access: Access, assetId: string, page: number, pageSize: number) {
    await this.assets.get(access, assetId);
    const repo = this.assets.hyl.db.repository<AssetFile>('hylAssetFiles'),
      filter = { assetId, linked: true };
    return {
      data: (
        await repo.findMany({
          filter,
          sort: (s) => [s.field('createdAt').desc(), s.field('id').desc()],
          offset: (page - 1) * pageSize,
          limit: pageSize,
        })
      ).map((f) => this.public(f)),
      meta: { total: await repo.count({ filter }), page, pageSize },
    };
  }
  async pending(access: Access, assetId: string) {
    await this.assets.get(access, assetId, 'write');
    const files = await this.assets.hyl.db
      .repository<AssetFile>('hylAssetFiles')
      .findMany({
        filter: { assetId, linked: false, ownerId: access.actor },
        limit: 100,
      });
    const cleanup = await this.assets.hyl.db
      .repository<AssetCleanup>('hylAssetFileCleanup')
      .findMany({ filter: { assetId, ownerId: access.actor }, limit: 100 });
    const ids = new Set(cleanup.map((f) => f.id));
    return {
      files: files
        .filter((f) => !ids.has(String(f.id)))
        .map((f) => ({ ...this.public(f), uploadId: f.uploadId })),
      cleanupIds: [...ids],
    };
  }
  async link(access: Access, assetId: string, input: unknown) {
    const body = fileLinkSchema.parse(input),
      policy = await assetPolicy(access, 'write');
    return this.assets.hyl.db.transaction(async (c) => {
      const asset = await getAsset(c, assetId, policy);
      await lockProjects(c, [asset.projectId]);
      if ((await getAsset(c, assetId, policy)).projectId !== asset.projectId)
        fail('VERSION_CONFLICT', 'ABORTED');
      const file = await c.repository<AssetFile>('hylAssetFiles').findOne({
        filter: { id: body.fileId, assetId, ownerId: access.actor },
      });
      if (!file) fail('PROFILE_FILE_CONFLICT', 'ALREADY_EXISTS');
      if (file.linked) {
        if (file.title !== body.title || file.category !== body.category)
          fail('PROFILE_RETRY_CONFLICT', 'ALREADY_EXISTS');
        return this.public(file);
      }
      if (
        await c
          .repository('hylAssetFileCleanup')
          .exists({ filter: { id: body.fileId } })
      )
        fail('PROFILE_FILE_CONFLICT', 'ALREADY_EXISTS');
      const result = await c.repository<AssetFile>('hylAssetFiles').updateOne({
        filter: { id: body.fileId, linked: false },
        values: { linked: true, title: body.title, category: body.category },
      });
      await audit(c, assetId, access.actor, 'file', '', null, {
        fileId: body.fileId,
        title: body.title,
        category: body.category,
      });
      return this.public(result.record);
    });
  }
  async cleanup(access: Access, assetId: string, id: string) {
    const policy = await assetPolicy(access, 'write');
    return this.assets.hyl.db.transaction(async (c) => {
      const asset = await getAsset(c, assetId, policy);
      await lockProjects(c, [asset.projectId]);
      if ((await getAsset(c, assetId, policy)).projectId !== asset.projectId)
        fail('VERSION_CONFLICT', 'ABORTED');
      const repo = c.repository<AssetCleanup>('hylAssetFileCleanup');
      const prior = await repo.findOne({
        filter: { id, assetId, ownerId: access.actor },
      });
      if (prior) return prior;
      const file = await c
        .repository<AssetFile>('hylAssetFiles')
        .findOne({ filter: { id, assetId, ownerId: access.actor } });
      if (!file || file.linked) fail('PROFILE_FILE_CONFLICT', 'ALREADY_EXISTS');
      const row = {
        id,
        assetId,
        ownerId: access.actor,
        disk: file.disk,
        key: file.key,
      };
      await repo.upsertOne({ filter: { id }, create: row, update: { id } });
      return row;
    });
  }
}
