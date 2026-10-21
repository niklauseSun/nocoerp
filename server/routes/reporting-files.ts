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
      await hyl.get(access(c), p.kind, p.id);
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
      await hyl.get(
        access(c),
        kinds.parse(c.req.query('kind')),
        c.req.query('recordId')!,
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
      await validateAssetFile(file);
      await next();
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
      await hyl.get(access(c), file.kind, file.recordId);
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
