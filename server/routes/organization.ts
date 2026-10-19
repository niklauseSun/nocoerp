import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import {
  defineApiRoutes,
  describeRoute,
  apiValidator,
  apiErrorHandler,
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
import { z } from 'zod';
import { organizationToken } from '../providers/organization.js';
import {
  departmentSchema,
  departmentInput,
  memberInput,
  projectInput,
  SETTINGS,
} from '../organization/model.js';
const id = z.object({ id: z.string().min(1).max(100) }),
  page = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    q: z.string().max(100).default(''),
  });
const member = memberInput.extend({ id: z.string(), departmentId: z.string() }),
  project = projectInput.extend({ id: z.string() }),
  user = z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    disabledAt: z.string().nullable().optional(),
  });
const description = (operationId: string, schema: z.ZodType) =>
  describeRoute({
    tags: ['Organization'],
    operationId,
    summary: operationId,
    responses: { 200: dataResponse(schema), ...apiErrorResponses },
  });
export default defineApiRoutes<Application>((app) => {
  const r = new Hono<AuthEnv & AuthorizationEnv>(),
    auth = app.container.resolve(authenticationToken),
    authz = app.container.resolve(authorizationToken),
    service = app.container.resolve(organizationToken);
  const allowed = (action: 'read' | 'update') =>
    createMiddleware<AuthEnv & AuthorizationEnv>(async (c, next) => {
      await c
        .get('authz')
        .require({ resource: { type: 'settings', id: SETTINGS }, action });
      await next();
    });
  for (const path of [
    '/organization',
    '/organization/options',
    '/organization/audit',
    '/organization/departments',
    '/organization/departments/:id',
    '/organization/departments/:id/members',
    '/organization/projects',
  ])
    r.use(path, auth.required(), authz.middleware());
  r.onError(apiErrorHandler);
  r.get(
    '/organization',
    allowed('read'),
    description(
      'organizationSnapshot',
      z.object({
        names: z.record(z.string(), z.string()),
        departments: z.array(departmentSchema),
        members: z.array(member),
        projects: z.array(project),
      }),
    ),
    async (c) => c.json({ data: await service.snapshot() }),
  );
  r.get(
    '/organization/options',
    allowed('read'),
    description(
      'organizationOptions',
      z.object({
        users: z.array(user),
        userTotal: z.number(),
        projects: z.array(z.object({ id: z.string(), name: z.string() })),
        projectTotal: z.number(),
      }),
    ),
    apiValidator('query', page),
    async (c) => {
      const q = c.req.valid('query'),
        u = await service.users.list({
          search: q.q,
          page: q.page,
          pageSize: q.pageSize,
        }),
        repo = service.db.repository('hylAssets'),
        filter = { type: 'project', state: 'normal' };
      return c.json({
        data: {
          users: u.items.map((x) => ({
            id: x.id,
            name: x.name,
            email: x.email,
            disabledAt: x.disabledAt ?? null,
          })),
          userTotal: u.total,
          projects: await repo.findMany({
            filter,
            select: (s) => s.fields('id', 'name'),
            offset: (q.page - 1) * q.pageSize,
            limit: q.pageSize,
            sort: (s) => [s.field('id').asc()],
          }),
          projectTotal: await repo.count({ filter }),
        },
      });
    },
  );
  r.post(
    '/organization/departments',
    allowed('update'),
    description('organizationCreateDepartment', departmentSchema),
    apiValidator('json', departmentInput),
    async (c) =>
      c.json({
        data: await service.department(
          String(c.get('auth')!.user.id),
          c.req.valid('json'),
        ),
      }),
  );
  r.patch(
    '/organization/departments/:id',
    allowed('update'),
    description('organizationUpdateDepartment', departmentSchema),
    apiValidator('param', id),
    apiValidator('json', departmentInput),
    async (c) =>
      c.json({
        data: await service.department(
          String(c.get('auth')!.user.id),
          c.req.valid('json'),
          c.req.valid('param').id,
        ),
      }),
  );
  r.put(
    '/organization/departments/:id/members',
    allowed('update'),
    description('organizationSetMember', member),
    apiValidator('param', id),
    apiValidator('json', memberInput),
    async (c) =>
      c.json({
        data: await service.member(
          String(c.get('auth')!.user.id),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      }),
  );
  r.put(
    '/organization/projects',
    allowed('update'),
    description('organizationSetProject', project),
    apiValidator('json', projectInput),
    async (c) =>
      c.json({
        data: await service.project(
          String(c.get('auth')!.user.id),
          c.req.valid('json'),
        ),
      }),
  );
  const audit = z.object({
    id: z.string(),
    actor: z.string(),
    action: z.string(),
    target: z.string(),
    before: z.unknown(),
    after: z.unknown(),
    at: z.string(),
  });
  r.get(
    '/organization/audit',
    allowed('read'),
    description(
      'organizationAudit',
      z.object({ items: z.array(audit), total: z.number() }),
    ),
    apiValidator('query', page),
    async (c) => {
      const q = c.req.valid('query'),
        repo = service.db.repository('hylOrganizationAudit');
      return c.json({
        data: {
          items: await repo.findMany({
            sort: (s) => [s.field('at').desc(), s.field('id').desc()],
            offset: (q.page - 1) * q.pageSize,
            limit: q.pageSize,
          }),
          total: await repo.count(),
        },
      });
    },
  );
  return new Hono().route('/', r);
});
