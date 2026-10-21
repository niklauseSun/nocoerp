import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { bodyLimit } from 'hono/body-limit';
import type { Application } from '@nocobase/app-server/application';
import {
  ApiError,
  defineApiRoutes,
  defineRootRoutes,
  apiErrorHandler,
  apiValidator,
  describeRoute,
  dataResponse,
  apiErrorResponses,
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
import { hylToken } from '../providers/hyl.js';
import { fail, type Access } from '../hyl/service.js';
import { validateAssetFile } from '../assets/file-validation.js';
import { RepairService } from '../repairs/service.js';
import {
  publicPhoto,
  photoRecord,
  type RepairFile,
} from '../repairs/photos.js';
type Env = AuthEnv & AuthorizationEnv;
const query = z.object({
  assetId: z.uuid(),
  orderId: z.uuid().optional(),
  stage: z.enum(['report', 'processing', 'acceptance']),
});
const access = (c: Context<Env>) => ({
  actor: String(c.get('auth')!.user.id),
  authorization: c.get('authz'),
});
async function uploadAccess(
  service: RepairService,
  a: Access,
  q: z.infer<typeof query>,
) {
  if (!q.orderId) {
    if (q.stage !== 'report') fail('REPAIR_STAGE_INVALID');
    await service.prepare(a, 'report', {
      assetId: q.assetId,
      merchantId: '',
      contractId: '',
    });
    return;
  }
  const row = await service.row(q.orderId);
  if (row.assetId !== q.assetId) fail('REPAIR_PHOTO_INVALID');
  await service.scoped(a, row);
  const action =
    q.stage === 'report'
      ? 'report'
      : q.stage === 'processing'
        ? 'process'
        : 'accept';
  await service.scoped(a, row, action);
  const valid =
    q.stage === 'report'
      ? row.status === 'reported'
      : q.stage === 'processing'
        ? row.status === 'processing'
        : row.status === 'pendingAcceptance';
  if (!valid) fail('REPAIR_STAGE_INVALID');
  if (q.stage === 'processing' && row.assigneeId !== a.actor)
    fail('REPAIR_ASSIGNEE_ONLY', 'PERMISSION_DENIED');
}
async function readable(service: RepairService, a: Access, id: string) {
  const f = await service
    .c()
    .repository<RepairFile>('hylRepairFiles')
    .findOne({ filter: { id } });
  if (!f) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
  if (f.linked) await service.scoped(a, await service.row(f.orderId));
  else {
    if (f.ownerId !== a.actor) fail('ACCESS_DENIED', 'PERMISSION_DENIED');
    await uploadAccess(service, a, {
      assetId: f.assetId,
      orderId: f.orderId || undefined,
      stage: f.stage,
    });
  }
  return f;
}
const api = defineApiRoutes<Application>((app) => {
  const r = new Hono<Env>(),
    service = new RepairService(app.container.resolve(hylToken));
  r.onError(apiErrorHandler);
  for (const path of ['/repairFiles/uploadOne', '/repairPhotos/:id'])
    r.use(
      path,
      app.container.resolve(authenticationToken).required(),
      app.container.resolve(authorizationToken).middleware(),
    );
  r.get(
    '/repairPhotos/:id',
    describeRoute({
      tags: ['Repairs'],
      operationId: 'repairPhotoRead',
      summary: 'Read private repair photo metadata',
      responses: { 200: dataResponse(photoRecord), ...apiErrorResponses },
    }),
    apiValidator('param', z.object({ id: z.uuid() })),
    async (c) =>
      c.json({
        data: publicPhoto(
          await readable(service, access(c), c.req.valid('param').id),
          app.publicBasePath ?? '',
        ),
      }),
  );
  r.use(
    '/repairFiles/uploadOne',
    apiValidator('query', query),
    async (c, next) => {
      await uploadAccess(service, access(c), query.parse(c.req.query()));
      await next();
    },
    bodyLimit({
      maxSize: 10 * 1024 * 1024 + 65536,
      onError: () => {
        fail('PROFILE_FILE_SIZE', 'INVALID_ARGUMENT');
      },
    }),
    async (c, next) => {
      let body: FormData;
      try {
        body = await c.req.raw.clone().formData();
      } catch {
        fail('REPAIR_PHOTO_TYPE', 'INVALID_ARGUMENT');
      }
      const file = body.get('file');
      if (!(file instanceof File) || file.size > 10 * 1024 * 1024)
        fail('PROFILE_FILE_SIZE', 'INVALID_ARGUMENT');
      if (!['image/png', 'image/jpeg'].includes(file.type))
        fail('REPAIR_PHOTO_TYPE', 'INVALID_ARGUMENT');
      try {
        await validateAssetFile(file);
      } catch (error) {
        if (error instanceof ApiError && error.reason === 'PROFILE_FILE_TYPE')
          fail('REPAIR_PHOTO_TYPE', 'INVALID_ARGUMENT');
        throw error;
      }
      await next();
    },
  );
  return new Hono().route('/', r);
});
const content = defineRootRoutes<Application>((app) => {
  const r = new Hono<Env>(),
    service = new RepairService(app.container.resolve(hylToken));
  r.onError(apiErrorHandler);
  r.use(
    '/uploads/repairPhotos/*',
    app.container.resolve(authenticationToken).required(),
    app.container.resolve(authorizationToken).middleware(),
    async (c, next) => {
      const id = (c.req.path.split('/').at(-1) ?? '').split('.')[0] ?? '';
      if (!z.uuid().safeParse(id).success)
        fail('RECORD_NOT_FOUND', 'NOT_FOUND');
      await readable(service, access(c), id);
      c.header('Cache-Control', 'private, no-store');
      c.header('X-Content-Type-Options', 'nosniff');
      await next();
    },
  );
  return new Hono().route('/', r);
});
const standard = defineFileRepositoryApiRoutes<{
  actor: string;
  assetId: string;
  orderId: string;
  stage: string;
}>({
  principal: (c) => ({
    actor: String((c as Context<Env>).get('auth')!.user.id),
    assetId: c.req.query('assetId') ?? '',
    orderId: c.req.query('orderId') ?? '',
    stage: c.req.query('stage') ?? '',
  }),
  repositories: [
    {
      name: 'repairFiles',
      collection: 'hylRepairFiles',
      disk: 'local',
      accessPath: '/uploads/repairPhotos',
      accessMode: 'stream',
      actions: { uploadOne: { maxSize: 10 * 1024 * 1024 + 65536 } },
      policy: ({ actor, assetId, orderId, stage }) => ({
        read: { scope: true, fields: [...FILE_COLUMNS] },
        create: {
          scope: true,
          fields: [],
          defaults: { ownerId: actor, assetId, orderId, stage, linked: false },
        },
        update: false,
        delete: false,
      }),
    },
  ],
});
export default [api, content, ...standard];
