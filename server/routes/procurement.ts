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
import { ProcurementService } from '../procurement/service.js';
import {
  kinds,
  lists,
  supplierValues,
  requestValues,
  receiptValues,
  supplierAction,
  requestAction,
  orderAction,
  receiptAction,
  paymentAction,
} from '../procurement/model.js';
const record = z
  .object({
    id: z.string(),
    number: z.string(),
    title: z.string(),
    status: z.string(),
    projectId: z.string(),
    assetId: z.string(),
    repairId: z.string(),
    supplierId: z.string(),
    requestId: z.string(),
    orderId: z.string(),
    sourceId: z.string(),
    day: z.string(),
    type: z.string(),
    version: z.number(),
    amountCents: z.string(),
    acceptedCents: z.string(),
    paidCents: z.string(),
    outstandingCents: z.string(),
    payload: z.record(z.string(), z.json()),
    allowedActions: z.array(z.string()),
    blockedActions: z.record(z.string(), z.string()),
  })
  .loose()
  .meta({ ref: 'ProcurementRecord' });
const detail = record.extend({
  events: z.object({
    data: z.array(
      z.object({
        id: z.string(),
        recordId: z.string(),
        kind: z.string(),
        version: z.number(),
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
    tags: ['Procurement'],
    operationId: 'procurement' + name,
    summary: 'Procurement ' + name,
    responses: {
      200: list ? listResponse(schema) : dataResponse(schema),
      ...apiErrorResponses,
    },
  });
export default defineApiRoutes<Application>((app) => {
  const service = new ProcurementService(app.container.resolve(hylToken)),
    router = new Hono<AuthEnv & AuthorizationEnv>(),
    auth = app.container.resolve(authenticationToken),
    authz = app.container.resolve(authorizationToken);
  const access = (c: Context<AuthEnv & AuthorizationEnv>) => ({
    actor: String(c.get('auth')?.user.id),
    authorization: c.get('authz'),
  });
  router.onError(apiErrorHandler);
  const param = z.object({ id: z.uuid() }),
    eventQuery = z.object({
      eventPage: z.coerce.number().int().min(1).max(100000).default(1),
    });
  for (const path of [
    '/procurementSummary',
    '/procurementAssets',
    ...kinds.flatMap((k) => [
      '/purchase' + k[0].toUpperCase() + k.slice(1),
      '/purchase' + k[0].toUpperCase() + k.slice(1) + '/:id',
      '/purchase' + k[0].toUpperCase() + k.slice(1) + '/:id/actions',
    ]),
  ])
    router.use(path, auth.required(), authz.middleware());
  for (const kind of kinds) {
    const path = '/purchase' + kind[0].toUpperCase() + kind.slice(1);
    router.get(
      path,
      describe(kind + 'List', true),
      apiValidator('query', lists),
      async (c) =>
        c.json(await service.list(access(c), kind, c.req.valid('query'))),
    );
    router.get(
      path + '/:id',
      describe(kind + 'Detail', false, detail),
      apiValidator('param', param),
      apiValidator('query', eventQuery),
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
  }
  router.get(
    '/procurementSummary',
    describe(
      'Summary',
      false,
      z.object({
        acceptedCents: z.string(),
        paidCents: z.string(),
        outstandingCents: z.string(),
      }),
    ),
    apiValidator(
      'query',
      z.object({ repairId: z.string().max(100).default('') }),
    ),
    async (c) =>
      c.json({
        data: await service.summary(access(c), c.req.valid('query').repairId),
      }),
  );
  router.get(
    '/procurementAssets',
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
        projectsOnly: z.enum(['true', 'false']).default('false'),
      }),
    ),
    async (c) => {
      const v = c.req.valid('query');
      return c.json(
        await service.assets(access(c), v.q, v.page, v.projectsOnly === 'true'),
      );
    },
  );
  router.post(
    '/purchaseSuppliers',
    describe('SupplierCreate'),
    apiValidator(
      'json',
      z.object({ requestId: z.uuid(), values: supplierValues }).strict(),
    ),
    async (c) => {
      const v = c.req.valid('json');
      return c.json({
        data: await service.createSupplier(access(c), v.values, v.requestId),
      });
    },
  );
  router.post(
    '/purchaseRequests',
    describe('RequestCreate'),
    apiValidator(
      'json',
      z.object({ requestId: z.uuid(), values: requestValues }).strict(),
    ),
    async (c) => {
      const v = c.req.valid('json');
      return c.json({
        data: await service.createRequest(access(c), v.values, v.requestId),
      });
    },
  );
  router.post(
    '/purchaseReceipts',
    describe('ReceiptCreate'),
    apiValidator(
      'json',
      z
        .object({
          requestId: z.uuid(),
          expectedOrderVersion: z.number().int().min(0),
          values: receiptValues,
        })
        .strict(),
    ),
    async (c) => {
      const v = c.req.valid('json');
      return c.json({
        data: await service.createReceipt(
          access(c),
          v.values,
          v.requestId,
          v.expectedOrderVersion,
        ),
      });
    },
  );
  for (const [kind, schema] of [
    ['suppliers', supplierAction],
    ['requests', requestAction],
    ['orders', orderAction],
    ['receipts', receiptAction],
    ['payments', paymentAction],
  ] as const)
    router.post(
      '/purchase' + kind[0].toUpperCase() + kind.slice(1) + '/:id/actions',
      describe(kind + 'Action'),
      apiValidator('param', param),
      apiValidator('json', schema),
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
  return new Hono().route('/', router);
});
