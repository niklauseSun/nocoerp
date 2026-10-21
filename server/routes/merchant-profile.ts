import { createHash } from 'node:crypto';
import { watermarkLicense } from '../providers/license-watermark.js';
import { Hono, type Context } from 'hono';
import { buildFilter } from '@nocobase/repository-input';
import { driveManagerToken } from '@nocobase/app-server/drive';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { Application } from '@nocobase/app-server/application';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization';
import {
  defineApiRoutes,
  defineRootRoutes,
  apiValidator,
  describeRoute,
  apiErrorHandler,
  ApiError,
} from '@nocobase/app-server/router';
import {
  defineFileRepositoryApiRoutes,
  FILE_COLUMNS,
} from '@nocobase/app-plugin-file/server';
import { hylToken } from '../providers/hyl.js';
import {
  MerchantProfileService,
  licenseSchema,
  interactionSchema,
  type MerchantFile,
} from '../providers/merchant-profile.js';
import { fail, type Access } from '../hyl/service.js';
type ProfileEnv = AuthEnv &
  AuthorizationEnv & { Variables: { uploadHash: string } };
const params = z.object({ id: z.string().uuid() });
const deleteInput = z
  .object({ filter: z.object({ id: z.string().uuid() }).strict() })
  .strict();
const paging = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const describe = (operationId: string) =>
  describeRoute({
    tags: ['Merchant profile'],
    operationId,
    summary: operationId,
    responses: {
      200: { description: 'Success' },
      201: { description: 'Created' },
      400: { description: 'Invalid input' },
      401: { description: 'Sign in required' },
      403: { description: 'Permission denied' },
      404: { description: 'Not found' },
      409: { description: 'Retry or file conflict' },
    },
  });
const routes = defineApiRoutes<Application>((app) => {
  const router = new Hono<ProfileEnv>();
  const auth = app.container.resolve(authenticationToken),
    authz = app.container.resolve(authorizationToken);
  const service = new MerchantProfileService(
    app.container.resolve(hylToken),
    app.publicBasePath ?? '',
  );
  router.onError(apiErrorHandler);
  const access = (c: Context<ProfileEnv>): Access => ({
    actor: String(c.get('auth')?.user.id),
    authorization: c.get('authz'),
  });
  for (const suffix of ['licenses', 'interactions']) {
    const path = `/merchants/:id/${suffix}`;
    router.use(path, auth.required(), authz.middleware());
    router.get(
      path,
      describe(`merchant${suffix}List`),
      apiValidator('param', params),
      apiValidator(
        'query',
        suffix === 'licenses'
          ? paging
          : paging.extend({ type: z.enum(['visit', 'contact']) }),
      ),
      async (c) => {
        const query = c.req.valid('query');
        return c.json(
          await service.list(
            access(c),
            c.req.valid('param').id,
            'type' in query ? (query.type as 'visit' | 'contact') : 'license',
            query.page,
            query.pageSize,
          ),
        );
      },
    );
    router.post(
      path,
      describe(`merchant${suffix}Create`),
      apiValidator('param', params),
      apiValidator(
        'json',
        suffix === 'licenses' ? licenseSchema : interactionSchema,
      ),
      async (c) => {
        const values = c.req.valid('json');
        return c.json(
          {
            data: await service.append(
              access(c),
              c.req.valid('param').id,
              'type' in values ? values.type : 'license',
              values,
            ),
          },
          201,
        );
      },
    );
  }
  router.use(
    '/merchants/:id/licenseUploads',
    auth.required(),
    authz.middleware(),
  );
  router.get(
    '/merchants/:id/licenseUploads',
    describe('merchantLicenseUploads'),
    apiValidator('param', params),
    async (c) =>
      c.json({
        data: await service.pendingFiles(access(c), c.req.valid('param').id),
      }),
  );
  // Exact scopes precede the standard File Repository contributions. The parent is never trusted from multipart fields.
  for (const action of ['uploadOne', 'deleteOne']) {
    const path = `/merchantLicenseFiles/${action}`;
    router.use(
      path,
      auth.required(),
      authz.middleware(),
      apiValidator(
        'query',
        z.object({
          merchantId: z.string().uuid(),
          uploadId: z.string().uuid().optional(),
        }),
      ),
      async (c, next) => {
        await service.authorizeUploadParent(
          access(c),
          c.req.query('merchantId') ?? '',
        );
        await next();
      },
    );
  }
  router.use(
    '/merchantLicenseFiles/deleteOne',
    bodyLimit({
      maxSize: 65536,
      onError: (c) =>
        apiErrorHandler(
          new ApiError({
            status: 'INVALID_ARGUMENT',
            reason: 'BODY_TOO_LARGE',
            domain: 'hyl',
            httpStatus: 413,
            message: 'Request body is too large.',
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
      const parsed = deleteInput.safeParse(body);
      if (!parsed.success) fail('INVALID_FIELD', 'INVALID_ARGUMENT');
      const { id } = parsed.data.filter;
      const pending = await service.prepareCleanup(
        access(c),
        id,
        c.req.query('merchantId') ?? '',
      );
      const filesRepo = service.hyl.db.repository('hylMerchantFiles');
      const cleanupRepo = service.hyl.db.repository('hylMerchantFileCleanup');
      if (await filesRepo.exists({ filter: { id } })) await next();
      // A durable tombstone makes storage failures retryable after metadata was committed.
      if (!(await filesRepo.exists({ filter: { id } }))) {
        await app.container
          .resolve(driveManagerToken)
          .use(pending.disk)
          .delete(pending.key);
        await cleanupRepo.deleteMany({ filter: { id } });
        return c.json({ data: { deletedCount: 1 } });
      }
      await cleanupRepo.deleteMany({ filter: { id } });
    },
  );
  router.use(
    '/merchantLicenseFiles/uploadOne',
    bodyLimit({
      maxSize: 10 * 1024 * 1024 + 65536,
      onError: (c) =>
        apiErrorHandler(
          new ApiError({
            status: 'INVALID_ARGUMENT',
            reason: 'PROFILE_FILE_SIZE',
            domain: 'hyl',
            httpStatus: 413,
            message: 'File is too large.',
          }),
          c,
        ),
    }),
    async (c, next) => {
      // Inspect a clone: the standard upload handler still owns and reads the original body.
      let body: FormData;
      try {
        body = await c.req.raw.clone().formData();
      } catch {
        fail('PROFILE_FILE_TYPE', 'INVALID_ARGUMENT');
      }
      const file = body.get('file');
      if (!(file instanceof File))
        fail('PROFILE_FILE_TYPE', 'INVALID_ARGUMENT');
      if (file.size > 10 * 1024 * 1024)
        throw new ApiError({
          status: 'INVALID_ARGUMENT',
          reason: 'PROFILE_FILE_SIZE',
          domain: 'hyl',
          httpStatus: 413,
          message: 'File is too large.',
        });
      const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      const valid =
        (file.type === 'application/pdf' &&
          /\.pdf$/i.test(file.name) &&
          new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-') ||
        (file.type === 'image/png' &&
          /\.png$/i.test(file.name) &&
          [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) ||
        (file.type === 'image/jpeg' &&
          /\.jpe?g$/i.test(file.name) &&
          bytes[0] === 255 &&
          bytes[1] === 216 &&
          bytes[2] === 255);
      if (!valid)
        throw new ApiError({
          status: 'INVALID_ARGUMENT',
          reason: 'PROFILE_FILE_TYPE',
          domain: 'hyl',
          httpStatus: 415,
          message: 'Unsupported file type.',
        });
      const source = new Uint8Array(await file.arrayBuffer());
      try {
        await watermarkLicense(source, file.type);
      } catch {
        fail('PROFILE_FILE_TYPE', 'INVALID_ARGUMENT');
      }
      const hash = createHash('sha256').update(source).digest('hex');
      c.set('uploadHash', hash);
      const uploadId = c.req.query('uploadId');
      if (uploadId) {
        const existing = await service.hyl.db
          .repository<MerchantFile>('hylMerchantFiles')
          .findOne({
            filter: {
              merchantId: c.req.query('merchantId'),
              ownerId: access(c).actor,
              uploadId,
            },
          });
        if (existing) {
          if (
            existing.uploadHash !== hash ||
            existing.filename !== file.name ||
            existing.linked
          )
            fail('PROFILE_RETRY_CONFLICT', 'ALREADY_EXISTS');
          return c.json(
            {
              data: {
                record: service.publicFile(existing),
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
  return new Hono().route('/', router);
});
const contentGuard = defineRootRoutes<Application>((app) => {
  const router = new Hono<AuthEnv & AuthorizationEnv>();
  const service = new MerchantProfileService(
    app.container.resolve(hylToken),
    app.publicBasePath ?? '',
  );
  router.onError(apiErrorHandler);
  router.use(
    '/uploads/merchantLicenses/*',
    app.container.resolve(authenticationToken).required(),
    app.container.resolve(authorizationToken).middleware(),
    async (c) => {
      const segment = c.req.path.split('/').at(-1) ?? '';
      const id = segment.split('.')[0];
      if (!z.string().uuid().safeParse(id).success)
        fail('RECORD_NOT_FOUND', 'NOT_FOUND');
      const file = await service.authorizeFile(
        {
          actor: String(c.get('auth')?.user.id),
          authorization: c.get('authz'),
        },
        id,
      );
      if (!['GET', 'HEAD'].includes(c.req.method))
        fail('RECORD_NOT_FOUND', 'NOT_FOUND');
      let content: Uint8Array;
      try {
        const bytes = await app.container
          .resolve(driveManagerToken)
          .use(file.disk)
          .getBytes(file.key);
        content = await watermarkLicense(bytes, file.mimeType);
      } catch {
        // Never expose the unmarked original when conversion fails.
        fail('PROFILE_FILE_TYPE', 'FAILED_PRECONDITION');
      }
      c.header('Content-Type', file.mimeType);
      c.header('Content-Length', String(content.byteLength));
      c.header('Cache-Control', 'private, no-store');
      c.header('X-Content-Type-Options', 'nosniff');
      c.header(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      );
      if (c.req.method === 'HEAD') return c.body(null);
      return c.body(new Uint8Array(content).buffer);
    },
  );
  return new Hono().route('/', router);
});
const files = defineFileRepositoryApiRoutes<{
  actor: string;
  merchantId: string;
  uploadId: string | null;
  uploadHash: string;
}>({
  principal: (c) => ({
    actor: String((c as Context<AuthEnv>).get('auth')?.user.id),
    merchantId: c.req.query('merchantId') ?? '',
    uploadId: c.req.query('uploadId') ?? null,
    uploadHash: String(c.get('uploadHash') ?? ''),
  }),
  repositories: [
    {
      name: 'merchantLicenseFiles',
      collection: 'hylMerchantFiles',
      disk: 'local',
      accessPath: '/uploads/merchantLicenses',
      accessMode: 'stream',
      actions: {
        uploadOne: { maxSize: 10 * 1024 * 1024 + 65536 },
        deleteOne: {},
      },
      policy: ({ actor, merchantId, uploadId, uploadHash }) => ({
        read: {
          scope: buildFilter((f) =>
            f.and([
              f.string('ownerId').eq(actor),
              f.string('merchantId').eq(merchantId),
              f.boolean('linked').isFalse(),
            ]),
          ),
          fields: [...FILE_COLUMNS],
        },
        create: {
          scope: buildFilter((f) =>
            f.and([
              f.string('ownerId').eq(actor),
              f.string('merchantId').eq(merchantId),
              f.boolean('linked').isFalse(),
            ]),
          ),
          defaults: {
            ownerId: actor,
            merchantId,
            linked: false,
            uploadId,
            uploadHash,
          },
          fields: [],
        },
        update: false,
        delete: {
          scope: buildFilter((f) =>
            f.and([
              f.string('ownerId').eq(actor),
              f.string('merchantId').eq(merchantId),
              f.boolean('linked').isFalse(),
            ]),
          ),
        },
      }),
    },
  ],
});
export default [routes, contentGuard, ...files];
