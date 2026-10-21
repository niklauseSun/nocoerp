import { buildFilter } from '@nocobase/repository-input';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DatabaseConnection } from '@nocobase/db';
import type { FileRecord } from '@nocobase/app-plugin-file/server';
import type { Row } from '../hyl/schema.js';
import type { Access, HylService } from '../hyl/service.js';
import { fail } from '../hyl/service.js';
import { date } from '../hyl/schema.js';
const text = (max: number) => z.string().trim().max(max);
const optionalDate = z.union([z.literal(''), date]).default('');
export const interactionSchema = z
  .object({
    requestId: z.string().uuid(),
    type: z.enum(['visit', 'contact']),
    date,
    person: text(100).min(1),
    channel: text(50).default(''),
    content: text(2000).min(1),
    outcome: text(1000).default(''),
    nextDate: optionalDate,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.type === 'contact' && !v.channel)
      ctx.addIssue({ code: 'custom', path: ['channel'], message: 'REQUIRED' });
    if (v.nextDate && v.nextDate < v.date)
      ctx.addIssue({
        code: 'custom',
        path: ['nextDate'],
        message: 'INVALID_PERIOD',
      });
  });
export const licenseSchema = z
  .object({
    requestId: z.string().uuid(),
    name: text(100).min(1),
    category: text(50).min(1),
    number: text(100).default(''),
    start: optionalDate,
    end: optionalDate,
    permanent: z.boolean().default(false),
    fileId: z.string().uuid(),
    notes: text(1000).default(''),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.start && v.end && v.end < v.start) || (v.permanent && v.end))
      ctx.addIssue({
        code: 'custom',
        path: ['end'],
        message: 'INVALID_PERIOD',
      });
  });
export interface MerchantRecord {
  id: string;
  merchantId: string;
  type: string;
  requestId: string;
  actor: string;
  date: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
export type MerchantFile = FileRecord & {
  merchantId: string;
  ownerId: string;
  linked: boolean;
  uploadId?: string | null;
  uploadHash?: string;
};
export interface CleanupRecord {
  id: string;
  merchantId: string;
  ownerId: string;
  disk: string;
  key: string;
  createdAt: string;
}
export class MerchantProfileService {
  constructor(
    readonly hyl: HylService,
    readonly basePath: string,
  ) {}
  private async file(c: DatabaseConnection, id: string) {
    const file = await c
      .repository<MerchantFile>('hylMerchantFiles')
      .findOne({ filter: { id } });
    if (!file) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    return file;
  }
  async authorizeUploadParent(access: Access, merchantId: string) {
    if (
      await this.hyl.db
        .repository('hylMerchants')
        .exists({ filter: { id: merchantId } })
    ) {
      await this.hyl.get(access, 'merchants', merchantId, 'write');
    } else {
      // Prospective UUIDs have no merchant record yet; staging stays owner-isolated.
      await this.hyl.policy(access, 'merchants', 'write');
    }
  }
  async authorizeFile(access: Access, id: string) {
    const file = await this.file(this.hyl.db.connection(), id);
    if (file.linked)
      await this.hyl.get(access, 'merchants', file.merchantId, 'read');
    else await this.authorizeUploadParent(access, file.merchantId);
    if (!file.linked && file.ownerId !== access.actor)
      fail('ACCESS_DENIED', 'PERMISSION_DENIED');
    return file;
  }
  publicFile(file: MerchantFile) {
    return {
      id: file.id,
      filename: file.filename,
      ext: file.ext,
      mimeType: file.mimeType,
      size: file.size,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      contentUrl: `${this.basePath}/uploads/merchantLicenses/${file.id}.${file.ext}`,
    };
  }
  async pendingFiles(access: Access, merchantId: string) {
    await this.authorizeUploadParent(access, merchantId);
    const files = await this.hyl.db
      .repository<MerchantFile>('hylMerchantFiles')
      .findMany({
        filter: buildFilter((f) =>
          f.and([
            f.string('merchantId').eq(merchantId),
            f.string('ownerId').eq(access.actor),
            f.boolean('linked').isFalse(),
          ]),
        ),
        sort: (s) => [s.field('createdAt').desc(), s.field('id').desc()],
        limit: 100,
      });
    const cleanup = await this.hyl.db
      .repository<CleanupRecord>('hylMerchantFileCleanup')
      .findMany({ filter: { merchantId, ownerId: access.actor }, limit: 100 });
    const pendingDeletion = new Set(cleanup.map((row) => row.id));
    return {
      files: files
        .filter((file) => !pendingDeletion.has(file.id))
        .map((file) => this.publicFile(file)),
      cleanupIds: cleanup.map((row) => row.id),
    };
  }
  async prepareCleanup(access: Access, id: string, merchantId: string) {
    await this.authorizeUploadParent(access, merchantId);
    const repo = this.hyl.db.repository<CleanupRecord>(
      'hylMerchantFileCleanup',
    );
    const pending = await repo.findOne({
      filter: { id, merchantId, ownerId: access.actor },
    });
    if (pending) return pending;
    const file = await this.authorizeFile(access, id);
    if (
      file.linked ||
      file.ownerId !== access.actor ||
      file.merchantId !== merchantId
    )
      fail('PROFILE_FILE_CONFLICT', 'ALREADY_EXISTS');
    const row: CleanupRecord = {
      id,
      merchantId,
      ownerId: access.actor,
      disk: file.disk,
      key: file.key,
      createdAt: new Date().toISOString(),
    };
    await repo.upsertOne({
      filter: { id },
      create: row,
      update: { ownerId: access.actor },
    });
    return row;
  }
  async list(
    access: Access,
    merchantId: string,
    type: 'license' | 'visit' | 'contact',
    page: number,
    pageSize: number,
  ) {
    await this.hyl.get(access, 'merchants', merchantId);
    const repo = this.hyl.db.repository<MerchantRecord>('hylMerchantRecords');
    const filter = { merchantId, type };
    const total = await repo.count({ filter });
    const data = await repo.findMany({
      filter,
      offset: (page - 1) * pageSize,
      limit: pageSize,
      sort: (s) => [
        s.field('date').desc(),
        s.field('createdAt').desc(),
        s.field('id').desc(),
      ],
    });
    return {
      data: await Promise.all(
        data.map(async (r) =>
          r.type === 'license'
            ? {
                ...r,
                file: this.publicFile(
                  await this.file(
                    this.hyl.db.connection(),
                    String(r.payload.fileId),
                  ),
                ),
              }
            : r,
        ),
      ),
      meta: { total, page, pageSize },
    };
  }
  async append(
    access: Access,
    merchantId: string,
    type: 'license' | 'visit' | 'contact',
    input: unknown,
  ) {
    const payload = (
      type === 'license' ? licenseSchema : interactionSchema
    ).parse(input);
    if ('type' in payload && payload.type !== type)
      fail('INVALID_FIELD', 'INVALID_ARGUMENT');
    // Resolve authorization before opening SQLite's single-connection transaction.
    const policy = await this.hyl.policy(access, 'merchants', 'write');
    return this.hyl.db.transaction(async (c) => {
      const merchant = await c
        .repository<Row>('hylMerchants')
        .withPolicy(policy)
        .findOne({ filter: { id: merchantId } });
      if (!merchant) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
      const version = merchant.version!;
      // Serialize append retries and attachment claims with the existing merchant CAS.
      const locked = await c.repository('hylMerchants').updateMany({
        filter: { id: merchantId, version },
        values: { version: version + 1 },
      });
      if (locked.updatedCount !== 1) fail('VERSION_CONFLICT', 'ABORTED');
      const repo = c.repository<MerchantRecord>('hylMerchantRecords');
      const previous = await repo.findOne({
        filter: { merchantId, type, requestId: payload.requestId },
      });
      if (previous) {
        if (
          previous.actor !== access.actor ||
          JSON.stringify(
            (type === 'license' ? licenseSchema : interactionSchema).parse(
              previous.payload,
            ),
          ) !== JSON.stringify(payload)
        )
          fail('PROFILE_RETRY_CONFLICT', 'ALREADY_EXISTS');
        return previous;
      }
      if ('fileId' in payload) {
        const file = await this.file(c, payload.fileId);
        if (
          file.merchantId !== merchantId ||
          file.ownerId !== access.actor ||
          file.linked
        )
          fail('PROFILE_FILE_CONFLICT', 'ALREADY_EXISTS');
        const claim = await c.repository('hylMerchantFiles').updateMany({
          filter: buildFilter((f) =>
            f.and([
              f.string('id').eq(file.id),
              f.boolean('linked').isFalse(),
              f.string('ownerId').eq(access.actor),
              f.string('merchantId').eq(merchantId),
            ]),
          ),
          values: { linked: true },
        });
        if (claim.updatedCount !== 1)
          fail('PROFILE_FILE_CONFLICT', 'ALREADY_EXISTS');
      }
      const createdAt = new Date().toISOString();
      const row: MerchantRecord = {
        id: randomUUID(),
        merchantId,
        type,
        requestId: payload.requestId,
        actor: access.actor,
        date: 'date' in payload ? payload.date : createdAt.slice(0, 10),
        payload,
        createdAt,
      };
      await repo.createOne({ values: row });
      await c.repository('hylEvents').createOne({
        values: {
          id: randomUUID(),
          recordId: merchantId,
          payload: {
            action: `profile${type}`,
            actor: access.actor,
            at: createdAt,
            detail: { recordId: row.id },
            version: version + 1,
          },
        },
      });
      return row;
    });
  }
}
