import { Hono, type Context } from 'hono';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  describeRoute,
  apiValidator,
  apiErrorHandler,
} from '@nocobase/app-server/router';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization';
import { z } from 'zod';
import { hylToken } from '../providers/hyl.js';
import { CashierService, tables, type Kind } from '../cashier/service.js';
import {
  checkoutSchema,
  writeOrderSchema,
  operationSchema,
  refundSchema,
  dayQuery,
  reconcileSchema,
  listSchema,
} from '../cashier/model.js';
const param = z.object({ id: z.string().uuid() });
const description = (name: string) =>
  describeRoute({
    tags: ['Cashier'],
    operationId: `cashier${name}`,
    summary: `Cashier ${name}`,
    responses: {
      200: { description: 'Success' },
      400: { description: 'Invalid input or business precondition' },
      401: { description: 'Authentication required' },
      403: { description: 'Action forbidden' },
      404: { description: 'Record outside allowed scope' },
      409: { description: 'Version, reference or request conflict' },
    },
  });
export default defineApiRoutes<Application>((app) => {
  const service = new CashierService(app.container.resolve(hylToken)),
    router = new Hono<AuthEnv & AuthorizationEnv>();
  const auth = app.container.resolve(authenticationToken),
    authz = app.container.resolve(authorizationToken);
  const access = (c: Context<AuthEnv & AuthorizationEnv>) => ({
    actor: String(c.get('auth')?.user.id),
    authorization: c.get('authz'),
  });
  router.onError(apiErrorHandler);
  for (const path of [
    '/cashierOrders',
    '/cashierOrders/:id',
    '/cashierOrders/:id/:action',
    '/cashierRefunds',
    '/cashierRefunds/:id',
    '/cashierRefunds/:id/:action',
    '/cashierReconciliationPreview',
    '/cashierReconciliations',
    '/cashierReconciliations/:id',
  ])
    router.use(path, auth.required(), authz.middleware());
  for (const kind of Object.keys(tables) as Kind[]) {
    const path = {
      orders: '/cashierOrders',
      refunds: '/cashierRefunds',
      reconciliations: '/cashierReconciliations',
    }[kind];
    router.get(
      path,
      description(`List${kind}`),
      apiValidator('query', listSchema),
      async (c) =>
        c.json(await service.list(access(c), kind, c.req.valid('query'))),
    );
    router.get(
      path + '/:id',
      description(`Get${kind}`),
      apiValidator('param', param),
      async (c) =>
        c.json({
          data: await service.detail(access(c), kind, c.req.valid('param').id),
        }),
    );
  }
  router.post(
    '/cashierOrders/preview',
    description('PreviewOrder'),
    apiValidator('json', checkoutSchema),
    async (c) =>
      c.json({ data: await service.preview(access(c), c.req.valid('json')) }),
  );
  router.post(
    '/cashierOrders',
    description('SaveOrder'),
    apiValidator('json', writeOrderSchema),
    async (c) =>
      c.json({ data: await service.save(access(c), c.req.valid('json')) }),
  );
  router.patch(
    '/cashierOrders/:id',
    description('EditOrder'),
    apiValidator('param', param),
    apiValidator('json', writeOrderSchema),
    async (c) =>
      c.json({
        data: await service.save(
          access(c),
          c.req.valid('json'),
          c.req.valid('param').id,
        ),
      }),
  );
  for (const action of ['post', 'void'] as const)
    router.post(
      '/cashierOrders/:id/' + action,
      description(action + 'Order'),
      apiValidator('param', param),
      apiValidator('json', operationSchema),
      async (c) =>
        c.json({
          data: await (action === 'post'
            ? service.post(
                access(c),
                c.req.valid('param').id,
                c.req.valid('json'),
              )
            : service.voidOrder(
                access(c),
                c.req.valid('param').id,
                c.req.valid('json'),
              )),
        }),
    );
  router.post(
    '/cashierRefunds/preview',
    description('PreviewRefund'),
    apiValidator('json', refundSchema),
    async (c) =>
      c.json({
        data: await service.refundPreview(access(c), c.req.valid('json')),
      }),
  );
  router.post(
    '/cashierRefunds',
    description('Refund'),
    apiValidator('json', refundSchema),
    async (c) =>
      c.json({
        data: await service.createRefund(access(c), c.req.valid('json')),
      }),
  );
  router.post(
    '/cashierRefunds/:id/reverse',
    description('ReverseRefund'),
    apiValidator('param', param),
    apiValidator('json', operationSchema),
    async (c) =>
      c.json({
        data: await service.reverseRefund(
          access(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      }),
  );
  router.get(
    '/cashierReconciliationPreview',
    description('PreviewReconciliation'),
    apiValidator('query', dayQuery),
    async (c) =>
      c.json({
        data: await service.reportPreview(access(c), c.req.valid('query')),
      }),
  );
  router.post(
    '/cashierReconciliations',
    description('ConfirmReconciliation'),
    apiValidator('json', reconcileSchema),
    async (c) =>
      c.json({
        data: await service.confirmReport(access(c), c.req.valid('json')),
      }),
  );
  return new Hono().route('/', router);
});
