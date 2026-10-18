import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  describeRoute,
  apiValidator,
  apiErrorHandler,
  dataResponse,
  listResponse,
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
import { hylToken } from '../providers/hyl.js';
import { InspectionService } from '../inspections/service.js';
import {
  planValues,
  planAction,
  taskAction,
  issueAction,
  lists,
  kinds,
} from '../inspections/model.js';
const record = z
  .object({
    id: z.string(),
    number: z.string(),
    status: z.string(),
    title: z.string(),
    type: z.string(),
    assetId: z.string(),
    projectId: z.string(),
    planId: z.string(),
    taskId: z.string(),
    repairId: z.string(),
    day: z.string(),
    dueOn: z.string(),
    assigneeId: z.string(),
    actor: z.string(),
    version: z.number(),
    lifecycleVersion: z.number(),
    statusChangedAt: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    payload: z.record(z.string(), z.json()),
    allowedActions: z.array(z.string()),
    blockedActions: z.record(z.string(), z.string()),
    overdue: z.boolean(),
  })
  .loose()
  .meta({ ref: 'InspectionRecord' });
const event = z.object({
  id: z.string(),
  recordId: z.string(),
  kind: z.string(),
  actor: z.string(),
  action: z.string(),
  version: z.number(),
  fromState: z.string(),
  toState: z.string(),
  payload: z.record(z.string(), z.json()),
  createdAt: z.string(),
});
const detail = record.extend({
  events: z.object({
    data: z.array(event),
    meta: z.object({
      page: z.number(),
      pageSize: z.number(),
      total: z.number(),
    }),
  }),
});
const describe = (name: string, list = false, schema: z.ZodType = record) =>
  describeRoute({
    tags: ['Inspection operations'],
    operationId: 'inspection' + name,
    summary: 'Inspection ' + name,
    responses: {
      200: list ? listResponse(schema) : dataResponse(schema),
      ...apiErrorResponses,
    },
  });
export default defineApiRoutes<Application>((app) => {
  const service = new InspectionService(app.container.resolve(hylToken)),
    auth = app.container.resolve(authenticationToken),
    authz = app.container.resolve(authorizationToken),
    router = new Hono<AuthEnv & AuthorizationEnv>();
  const access = (c: Context<AuthEnv & AuthorizationEnv>) => ({
    actor: String(c.get('auth')?.user.id),
    authorization: c.get('authz'),
  });
  router.onError(apiErrorHandler);
  for (const kind of kinds) {
    const path = '/inspection' + kind[0].toUpperCase() + kind.slice(1);
    for (const p of [path, path + '/:id', path + '/:id/actions'])
      router.use(p, auth.required(), authz.middleware());
    router.get(
      path,
      describe('List' + kind, true),
      apiValidator('query', lists),
      async (c) =>
        c.json(await service.list(access(c), kind, c.req.valid('query'))),
    );
    router.get(
      path + '/:id',
      describe('Detail' + kind, false, detail),
      apiValidator('param', z.object({ id: z.uuid() })),
      apiValidator(
        'query',
        z.object({
          eventPage: z.coerce.number().int().min(1).max(100000).default(1),
        }),
      ),
      async (c) =>
        c.json({
          data: await service.detail(
            access(c),
            kind,
            c.req.valid('param').id,
            c.req.valid('query').eventPage,
          ),
        }),
    );
    if (kind === 'plans')
      router.post(
        path,
        describe('CreatePlan'),
        apiValidator(
          'json',
          z.object({ requestId: z.uuid(), values: planValues }).strict(),
        ),
        async (c) => {
          const b = c.req.valid('json');
          return c.json({
            data: await service.create(access(c), b.values, b.requestId),
          });
        },
      );
    router.post(
      path + '/:id/actions',
      describe('Act' + kind),
      apiValidator('param', z.object({ id: z.uuid() })),
      apiValidator(
        'json',
        kind === 'plans'
          ? planAction
          : kind === 'tasks'
            ? taskAction
            : issueAction,
      ),
      async (c) =>
        c.json({
          data: await service.act(
            access(c),
            kind,
            c.req.valid('param').id,
            c.req.valid('json'),
          ),
        }),
    );
  }
  router.use('/inspectionAssignees', auth.required(), authz.middleware());
  router.get(
    '/inspectionAssignees',
    describe('Assignees', true, z.object({ id: z.string(), name: z.string() })),
    apiValidator(
      'query',
      z.object({
        q: z.string().max(100).default(''),
        page: z.coerce.number().int().min(1).max(100000).default(1),
        pageSize: z.coerce.number().int().min(1).max(20).default(20),
      }),
    ),
    async (c) =>
      c.json(
        await service.assignees(
          access(c),
          c.req.valid('query').q,
          c.req.valid('query').page,
        ),
      ),
  );
  router.use('/inspectionAssets', auth.required(), authz.middleware());
  router.get(
    '/inspectionAssets',
    describe(
      'Assets',
      true,
      z.object({ id: z.string(), name: z.string(), number: z.string() }),
    ),
    apiValidator(
      'query',
      z.object({
        q: z.string().max(100).default(''),
        page: z.coerce.number().int().min(1).max(100000).default(1),
        pageSize: z.coerce.number().int().min(1).max(20).default(20),
      }),
    ),
    async (c) =>
      c.json(
        await service.assets(
          access(c),
          c.req.valid('query').q,
          c.req.valid('query').page,
        ),
      ),
  );
  return new Hono().route('/', router);
});
