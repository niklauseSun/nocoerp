import { photoRecord } from '../repairs/photos.js';
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
import { RepairService } from '../repairs/service.js';
import {
  createValues,
  actionValues,
  listInput,
  states,
  categories,
  priorities,
} from '../repairs/model.js';
const record = z
  .object({
    id: z.string(),
    number: z.string(),
    status: z.enum(states),
    projectId: z.string(),
    category: z.enum(categories),
    priority: z.enum(priorities),
    occurredOn: z.string(),
    dueOn: z.string(),
    assigneeId: z.string(),
    costCents: z.string().regex(/^\d+$/),
    actor: z.string(),
    lifecycleVersion: z.number().int(),
    statusChangedAt: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    blockedActions: z.array(z.string()),
    overdue: z.boolean(),
    version: z.number(),
    title: z.string(),
    assetId: z.string(),
    merchantId: z.string(),
    contractId: z.string(),
    payload: z.record(z.string(), z.json()),
    allowedActions: z.array(z.string()),
  })
  .loose()
  .meta({ ref: 'RepairOrder' });
const detail = record.extend({
  photos: z.object({
    report: z.array(photoRecord),
    processing: z.array(photoRecord),
    acceptance: z.array(photoRecord),
  }),
  events: z.object({
    data: z.array(
      z.object({
        id: z.string(),
        orderId: z.string(),
        photos: z.array(photoRecord),
        actor: z.string(),
        action: z.string(),
        fromState: z.string(),
        toState: z.string(),
        payload: z.record(z.string(), z.json()),
        createdAt: z.string(),
      }),
    ),
    meta: z.object({
      page: z.number(),
      pageSize: z.number(),
      total: z.number(),
    }),
  }),
});
const describe = (name: string, list = false, schema: z.ZodType = record) =>
  describeRoute({
    tags: ['Repairs'],
    operationId: 'repair' + name,
    summary: 'Repairs ' + name,
    responses: {
      200: list ? listResponse(schema) : dataResponse(schema),
      ...apiErrorResponses,
    },
  });
export default defineApiRoutes<Application>((app) => {
  const service = new RepairService(
      app.container.resolve(hylToken),
      app.publicBasePath ?? '',
    ),
    router = new Hono<AuthEnv & AuthorizationEnv>(),
    auth = app.container.resolve(authenticationToken),
    authz = app.container.resolve(authorizationToken);
  const access = (c: Context<AuthEnv & AuthorizationEnv>) => ({
    actor: String(c.get('auth')?.user.id),
    authorization: c.get('authz'),
  });
  router.onError(apiErrorHandler);
  for (const path of [
    '/repairOrders',
    '/repairOrders/:id',
    '/repairOrders/:id/actions',
    '/repairAssignees',
  ])
    router.use(path, auth.required(), authz.middleware());
  router.get(
    '/repairOrders',
    describe('List', true),
    apiValidator('query', listInput),
    async (c) => c.json(await service.list(access(c), c.req.valid('query'))),
  );
  router.get(
    '/repairAssignees',
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
      c.json(await service.assignees(access(c), c.req.valid('query'))),
  );
  router.get(
    '/repairOrders/:id',
    describe('Detail', false, detail),
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
          c.req.valid('param').id,
          c.req.valid('query').eventPage,
        ),
      }),
  );
  router.post(
    '/repairOrders',
    describe('Create'),
    apiValidator(
      'json',
      z.object({ requestId: z.uuid(), values: createValues }).strict(),
    ),
    async (c) => {
      const b = c.req.valid('json');
      return c.json({
        data: await service.create(access(c), b.values, b.requestId),
      });
    },
  );
  router.post(
    '/repairOrders/:id/actions',
    describe('Action'),
    apiValidator('param', z.object({ id: z.uuid() })),
    apiValidator('json', actionValues),
    async (c) =>
      c.json({
        data: await service.act(
          access(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      }),
  );
  return new Hono().route('/', router);
});
