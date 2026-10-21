import { validateAssetFile } from '../assets/file-validation.js';
import { createHash } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { bodyLimit } from 'hono/body-limit';
import { buildFilter } from '@nocobase/repository-input';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  defineRootRoutes,
  apiValidator,
  apiErrorHandler,
  ApiError,
} from '@nocobase/app-server/router';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization';
import {
  defineFileRepositoryApiRoutes,
  FILE_COLUMNS,
} from '@nocobase/app-plugin-file/server';
import { driveManagerToken } from '@nocobase/app-server/drive';
import { hylToken } from '../providers/hyl.js';
import { AssetService } from '../providers/assets.js';
import { AssetFiles, type AssetFile } from '../providers/asset-files.js';
import { fileLinkSchema } from '../assets/schema.js';
import { fail } from '../hyl/service.js';
import {
  assetAccess,
  assetParams,
  assetPaging,
  describeAsset,
  type AssetEnv,
} from './assets.js';
type Env = AssetEnv & { Variables: { uploadHash: string } };
const fileAccess = (c: Context<Env>) => ({
  actor: String(c.get('auth')?.user.id),
  authorization: c.get('authz'),
});
const routes = defineApiRoutes<Application>((app) => {
  const router = new Hono<Env>(),
    files = new AssetFiles(
      new AssetService(app.container.resolve(hylToken)),
      app.publicBasePath ?? '',
    );
  router.onError(apiErrorHandler);
  for (const path of [
    '/assets/:id/files',
    '/assets/:id/fileUploads',
    '/assetFiles/uploadOne',
    '/assetFiles/deleteOne',
  ])
    router.use(
      path,
      app.container.resolve(authenticationToken).required(),
      app.container.resolve(authorizationToken).middleware(),
    );
  router.get(
    '/assets/:id/files',
    describeAsset('assetFilesList'),
    apiValidator('param', assetParams),
    apiValidator('query', assetPaging),
    async (c) =>
      c.json(
        await files.list(
          fileAccess(c),
          c.req.valid('param').id,
          c.req.valid('query').page,
          c.req.valid('query').pageSize,
        ),
      ),
  );
  router.post(
    '/assets/:id/files',
    describeAsset('assetFilesLink'),
    apiValidator('param', assetParams),
    apiValidator('json', fileLinkSchema),
    async (c) =>
      c.json(
        {
          data: await files.link(
            fileAccess(c),
            c.req.valid('param').id,
            c.req.valid('json'),
          ),
        },
        201,
      ),
  );
  router.get(
    '/assets/:id/fileUploads',
    describeAsset('assetFilesPending'),
    apiValidator('param', assetParams),
    async (c) =>
      c.json({
        data: await files.pending(fileAccess(c), c.req.valid('param').id),
      }),
  );
  for (const path of ['/assetFiles/uploadOne', '/assetFiles/deleteOne'])
    router.use(
      path,
      apiValidator(
        'query',
        z.object({
          assetId: z.string().uuid(),
          uploadId: z.string().uuid().optional(),
        }),
      ),
      async (c, next) => {
        await files.assets.get(
          fileAccess(c),
          c.req.query('assetId') ?? '',
          'write',
        );
        await next();
      },
    );
  router.use(
    '/assetFiles/uploadOne',
    bodyLimit({
      maxSize: 10 * 1024 * 1024 + 65536,
      onError: (c) =>
        apiErrorHandler(
          new ApiError({
            status: 'INVALID_ARGUMENT',
            reason: 'PROFILE_FILE_SIZE',
            domain: 'hyl',
            message: 'File too large.',
            httpStatus: 413,
          }),
          c,
        ),
    }),
    async (c, next) => {
      let body: FormData;
      try {
        body = await c.req.raw.clone().formData();
      } catch {
        fail('PROFILE_FILE_TYPE', 'INVALID_ARGUMENT');
      }
      const file = body.get('file');
      if (!(file instanceof File) || file.size > 10 * 1024 * 1024)
        fail('PROFILE_FILE_SIZE', 'INVALID_ARGUMENT');
      const bytes = new Uint8Array(await file.arrayBuffer());
      await validateAssetFile(file);
      const hash = createHash('sha256').update(bytes).digest('hex');
      c.set('uploadHash', hash);
      const uploadId = c.req.query('uploadId');
      if (uploadId) {
        const existing = await files.assets.hyl.db
          .repository<AssetFile>('hylAssetFiles')
          .findOne({
            filter: {
              assetId: c.req.query('assetId'),
              ownerId: fileAccess(c).actor,
              uploadId,
            },
          });
        if (existing) {
          if (
            existing.linked ||
            existing.filename !== file.name ||
            existing.uploadHash !== hash
          )
            fail('PROFILE_RETRY_CONFLICT', 'ALREADY_EXISTS');
          return c.json(
            {
              data: {
                record: files.public(existing),
                createdTargets: [],
              },
            },
            201,
          );
        }
      }
      await next();
    },
  );
  router.use(
    '/assetFiles/deleteOne',
    bodyLimit({
      maxSize: 65536,
      onError: (c) =>
        apiErrorHandler(
          new ApiError({
            status: 'INVALID_ARGUMENT',
            reason: 'BODY_TOO_LARGE',
            domain: 'hyl',
            message: 'Request too large.',
            httpStatus: 413,
          }),
          c,
        ),
    }),
    async (c, next) => {
      let body: unknown;
      try {
        body = await c.req.raw.clone().json();
      } catch {
        fail('INVALID_FIELD', 'INVALID_ARGUMENT');
      }
      const parsed = z
        .object({ filter: z.object({ id: z.string().uuid() }).strict() })
        .strict()
        .safeParse(body);
      if (!parsed.success) fail('INVALID_FIELD', 'INVALID_ARGUMENT');
      const pending = await files.cleanup(
        fileAccess(c),
        c.req.query('assetId') ?? '',
        parsed.data.filter.id,
      );
      const repo = files.assets.hyl.db.repository('hylAssetFiles'),
        cleanup = files.assets.hyl.db.repository('hylAssetFileCleanup');
      if (await repo.exists({ filter: { id: pending.id } })) await next();
      if (!(await repo.exists({ filter: { id: pending.id } }))) {
        await app.container
          .resolve(driveManagerToken)
          .use(pending.disk)
          .delete(pending.key);
        await cleanup.deleteMany({ filter: { id: pending.id } });
        return c.json({ data: { deletedCount: 1 } });
      }
      await cleanup.deleteMany({ filter: { id: pending.id } });
    },
  );
  return new Hono().route('/', router);
});
const guard = defineRootRoutes<Application>((app) => {
  const router = new Hono<AuthEnv & AuthorizationEnv>(),
    files = new AssetFiles(
      new AssetService(app.container.resolve(hylToken)),
      app.publicBasePath ?? '',
    );
  router.onError(apiErrorHandler);
  router.use(
    '/uploads/assets/*',
    app.container.resolve(authenticationToken).required(),
    app.container.resolve(authorizationToken).middleware(),
    async (c, next) => {
      const id = (c.req.path.split('/').at(-1) ?? '').split('.')[0] ?? '';
      if (!z.string().uuid().safeParse(id).success)
        fail('RECORD_NOT_FOUND', 'NOT_FOUND');
      await files.authorize(assetAccess(c), id);
      c.header('Cache-Control', 'private, no-store');
      c.header('X-Content-Type-Options', 'nosniff');
      await next();
    },
  );
  return new Hono().route('/', router);
});
const standard = defineFileRepositoryApiRoutes<{
  actor: string;
  assetId: string;
  uploadId: string | null;
  uploadHash: string;
}>({
  principal: (c) => ({
    actor: String((c as Context<AuthEnv>).get('auth')?.user.id),
    assetId: c.req.query('assetId') ?? '',
    uploadId: c.req.query('uploadId') ?? null,
    uploadHash: String(c.get('uploadHash') ?? ''),
  }),
  repositories: [
    {
      name: 'assetFiles',
      collection: 'hylAssetFiles',
      disk: 'local',
      accessPath: '/uploads/assets',
      accessMode: 'stream',
      actions: {
        uploadOne: { maxSize: 10 * 1024 * 1024 + 65536 },
        deleteOne: {},
      },
      policy: ({ actor, assetId, uploadId, uploadHash }) => {
        const scope = buildFilter((f) =>
          f.and([
            f.string('ownerId').eq(actor),
            f.string('assetId').eq(assetId),
            f.boolean('linked').isFalse(),
          ]),
        );
        return {
          read: { scope, fields: [...FILE_COLUMNS] },
          create: {
            scope,
            defaults: {
              ownerId: actor,
              assetId,
              linked: false,
              uploadId,
              uploadHash,
              title: '',
              category: '',
            },
            fields: [],
          },
          update: false,
          delete: { scope },
        };
      },
    },
  ],
});
export default [routes, guard, ...standard];
