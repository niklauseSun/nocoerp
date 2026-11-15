import { randomUUID } from 'node:crypto';
import { driveManagerToken } from '@nocobase/app-server/drive';
import { loggingToken } from '@nocobase/app-server/logging';
import { merchantMiniappToken } from '../providers/merchant-miniapp.js';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { bodyLimit } from 'hono/body-limit';
import {
  defineApiRoutes,
  defineRootRoutes,
  apiErrorHandler,
  apiValidator,
  describeRoute,
  dataResponse,
  apiErrorResponses,
} from '@nocobase/app-server/router';
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
  defineFileRepositoryApiRoutes,
  FILE_COLUMNS,
  serverFileRepositoryManagerToken,
  type FileRecord,
} from '@nocobase/app-plugin-file/server';
import { buildFilter } from '@nocobase/repository-input';
import { hylToken } from '../providers/hyl.js';
import { fail } from '../hyl/service.js';
import { validateAssetFile } from '../assets/file-validation.js';
const kinds = z.enum(['revenueReports', 'expenses']);
type Env = AuthEnv & AuthorizationEnv;
type Evidence = FileRecord & {
  kind: 'revenueReports' | 'expenses';
  recordId: string;
  ownerId: string;
};
const access = (c: Context<Env>) => ({
  actor: String(c.get('auth')!.user.id),
  authorization: c.get('authz'),
});
// Mini-program accounts carry no ERP role. Only this evidence resource accepts
// their merchant capability; all other ERP file roles remain unchanged.
async function evidenceAccess(
  app: Application,
  c: Context<Env>,
  kind: z.infer<typeof kinds>,
  id: string,
  write = false,
) {
  const base = access(c),
    service = app.container.resolve(merchantMiniappToken);
  if (!(await service.isMiniappIdentity(base.actor))) return base;
  if (kind !== 'revenueReports') fail('ACCESS_DENIED', 'PERMISSION_DENIED');
  await service.requireSession(base.actor, c.get('auth')!.session.id);
  return service.reportingAccess(base, id, write);
}
const api = defineApiRoutes<Application>((app) => {
  const r = new Hono<Env>(),
    hyl = app.container.resolve(hylToken);
  r.onError(apiErrorHandler);
  for (const p of ['/reportingEvidence/:kind/:id', '/reportingFiles/uploadOne'])
    r.use(
      p,
      app.container.resolve(authenticationToken).required(),
      app.container.resolve(authorizationToken).middleware(),
    );
  r.get(
    '/reportingEvidence/:kind/:id',
    describeRoute({
      tags: ['Tenant operations'],
      operationId: 'reportingEvidence',
      summary: 'Read append-only private reporting evidence',
      responses: {
        200: dataResponse(z.array(z.unknown())),
        ...apiErrorResponses,
      },
    }),
    apiValidator('param', z.object({ kind: kinds, id: z.uuid() })),
    async (c) => {
      const p = c.req.valid('param');
      c.header('Cache-Control', 'private, no-store');
      await hyl.get(await evidenceAccess(app, c, p.kind, p.id), p.kind, p.id);
      const rows = await hyl.db
        .repository<Evidence>('hylReportingFiles')
        .findMany({
          filter: { kind: p.kind, recordId: p.id },
          sort: (s) => [s.field('createdAt').asc()],
        });
      return c.json({
        data: rows.map((f) => ({
          id: f.id,
          filename: f.filename,
          ext: f.ext,
          mimeType: f.mimeType,
          size: f.size,
          createdAt: f.createdAt,
          updatedAt: f.updatedAt,
          ownerId: f.ownerId,
          contentUrl: `${app.publicBasePath ?? ''}/uploads/reportingEvidence/${f.id}.${f.ext}`,
        })),
      });
    },
  );
  r.use(
    '/reportingFiles/uploadOne',
    apiValidator('query', z.object({ kind: kinds, recordId: z.uuid() })),
    async (c, next) => {
      const p = z
        .object({ kind: kinds, recordId: z.uuid() })
        .parse(c.req.query());
      await hyl.get(
        await evidenceAccess(app, c, p.kind, p.recordId, true),
        p.kind,
        p.recordId,
        'write',
      );
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
        fail('PROFILE_FILE_TYPE', 'INVALID_ARGUMENT');
      }
      const file = body.get('file');
      if (!(file instanceof File) || file.size > 10 * 1024 * 1024)
        fail('PROFILE_FILE_SIZE', 'INVALID_ARGUMENT');
      const service = app.container.resolve(merchantMiniappToken);
      const actor = access(c).actor;
      if (!(await service.isMiniappIdentity(actor))) {
        await validateAssetFile(file);
        await next();
        return;
      }
      if (!['image/png', 'image/jpeg'].includes(file.type))
        fail('PROFILE_FILE_TYPE', 'INVALID_ARGUMENT');
      await validateAssetFile(file);
      const reportId = c.req.query('recordId')!;
      // File Repository stores privately first. Only the attachment transaction can expose
      // the staged row on a report, serialized with submit and grant revocation.
      const stagingId = randomUUID();
      const storage = app.container
        .resolve(serverFileRepositoryManagerToken)
        .repository('hylReportingFiles', {
          disk: 'local',
          accessPath: '/uploads/reportingEvidence',
          policy: {
            read: false,
            create: {
              scope: true,
              defaults: {
                ownerId: actor,
                kind: 'revenueReports',
                recordId: stagingId,
              },
              fields: [],
            },
            update: false,
            delete: false,
          },
        });
      const result = await storage.uploadOne({ file });
      try {
        await service.attachEvidence(
          actor,
          reportId,
          stagingId,
          result.record.id,
        );
      } catch (error) {
        try {
          const removed = await hyl.db
            .repository<Evidence>('hylReportingFiles')
            .deleteMany({
              filter: {
                id: result.record.id,
                recordId: stagingId,
                ownerId: actor,
              },
            });
          if (removed.deletedCount === 1)
            await app.container
              .resolve(driveManagerToken)
              .use(result.record.disk)
              .delete(result.record.key);
        } catch {
          // Never remove a file with uncertain attachment state; leave a trace for reconciliation.
          app.container
            .resolve(loggingToken)
            .getLogger('merchantMiniapp')
            .warn(
              { fileId: result.record.id },
              'Could not remove staged evidence',
            );
        }
        throw error;
      }
      const { id, filename, ext, mimeType, size, createdAt, updatedAt } =
        result.record;
      c.header('Cache-Control', 'private, no-store');
      return c.json(
        {
          data: {
            record: {
              id,
              filename,
              ext,
              mimeType,
              size,
              createdAt,
              updatedAt,
              contentUrl: `${app.publicBasePath ?? ''}/uploads/reportingEvidence/${id}.${ext}`,
            },
            createdTargets: [],
          },
        },
        201,
      );
    },
  );
  return new Hono().route('/', r);
});
const guard = defineRootRoutes<Application>((app) => {
  const r = new Hono<Env>();
  r.onError(apiErrorHandler);
  r.use(
    '/uploads/reportingEvidence/*',
    app.container.resolve(authenticationToken).required(),
    app.container.resolve(authorizationToken).middleware(),
    async (c, next) => {
      const id = (c.req.path.split('/').at(-1) ?? '').split('.')[0];
      if (!z.uuid().safeParse(id).success)
        fail('RECORD_NOT_FOUND', 'NOT_FOUND');
      const hyl = app.container.resolve(hylToken),
        file = await hyl.db
          .repository<Evidence>('hylReportingFiles')
          .findOne({ filter: { id } });
      if (!file) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
      await hyl.get(
        await evidenceAccess(app, c, file.kind, file.recordId),
        file.kind,
        file.recordId,
      );
      c.header('Cache-Control', 'private, no-store');
      c.header('X-Content-Type-Options', 'nosniff');
      await next();
    },
  );
  return new Hono().route('/', r);
});
const standard = defineFileRepositoryApiRoutes<{
  actor: string;
  kind: string;
  recordId: string;
}>({
  principal: (c) => ({
    actor: String((c as Context<Env>).get('auth')!.user.id),
    kind: c.req.query('kind') ?? '',
    recordId: c.req.query('recordId') ?? '',
  }),
  repositories: [
    {
      name: 'reportingFiles',
      collection: 'hylReportingFiles',
      disk: 'local',
      accessPath: '/uploads/reportingEvidence',
      accessMode: 'stream',
      actions: { uploadOne: { maxSize: 10 * 1024 * 1024 + 65536 } },
      policy: ({ actor, kind, recordId }) => ({
        read: {
          scope: buildFilter((f) =>
            f.and([
              f.string('kind').eq(kind),
              f.string('recordId').eq(recordId),
            ]),
          ),
          fields: [...FILE_COLUMNS],
        },
        create: {
          scope: true,
          defaults: { ownerId: actor, kind, recordId },
          fields: [],
        },
        update: false,
        delete: false,
      }),
    },
  ],
});
export default [api, guard, ...standard];
