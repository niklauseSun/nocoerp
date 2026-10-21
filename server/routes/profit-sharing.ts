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
import { SplitService } from '../profit-sharing/service.js';
import {
  ruleValues,
  ruleInput,
  sourceInput,
  backfillInput,
  actionInput,
  listInput,
} from '../profit-sharing/model.js';
const param = z.object({ id: z.string().uuid() });
const describe = (name: string) =>
  describeRoute({
    tags: ['Profit sharing'],
    operationId: `split${name}`,
    summary: `Profit sharing ${name}`,
    responses: {
      200: { description: 'Success' },
      400: { description: 'Invalid input or precondition' },
      401: { description: 'Authentication required' },
      403: { description: 'Action forbidden' },
      404: { description: 'Unavailable or outside scope' },
      409: { description: 'Version, source or request conflict' },
    },
  });
export default defineApiRoutes<Application>((app) => {
  const service = new SplitService(app.container.resolve(hylToken)),
    router = new Hono<AuthEnv & AuthorizationEnv>(),
    auth = app.container.resolve(authenticationToken),
    authz = app.container.resolve(authorizationToken);
  const access = (c: Context<AuthEnv & AuthorizationEnv>) => ({
    actor: String(c.get('auth')?.user.id),
    authorization: c.get('authz'),
  });
  router.onError(apiErrorHandler);
  for (const path of [
    '/splitRules',
    '/splitRules/:id',
    '/splitOrders',
    '/splitOrders/:id',
    '/splitOrders/:id/:action',
    '/contracts/:id/splitRules',
    '/contracts/:id/previewSplitRule',
    '/contracts/:id/splitRenewals',
  ])
    router.use(path, auth.required(), authz.middleware());
  router.get(
    '/splitRules',
    describe('ListRules'),
    apiValidator('query', listInput),
    async (c) =>
      c.json(await service.list(access(c), 'rules', c.req.valid('query'))),
  );
  router.get(
    '/splitRules/:id',
    describe('GetRule'),
    apiValidator('param', param),
    async (c) =>
      c.json({
        data: await service.ruleDetail(access(c), c.req.valid('param').id),
      }),
  );
  router.get(
    '/contracts/:id/splitRules',
    describe('ContractRules'),
    apiValidator('param', param),
    apiValidator('query', listInput),
    async (c) =>
      c.json(
        await service.list(access(c), 'rules', {
          ...c.req.valid('query'),
          contractId: c.req.valid('param').id,
        }),
      ),
  );
  router.get(
    '/contracts/:id/splitRenewals',
    describe('RenewedContracts'),
    apiValidator('param', param),
    apiValidator('query', listInput),
    async (c) =>
      c.json(
        await service.renewals(
          access(c),
          c.req.valid('param').id,
          c.req.valid('query'),
        ),
      ),
  );
  router.put(
    '/contracts/:id/splitRules',
    describe('SaveRule'),
    apiValidator('param', param),
    apiValidator('json', ruleInput),
    async (c) =>
      c.json({
        data: await service.saveRule(
          access(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      }),
  );
  router.post(
    '/contracts/:id/previewSplitRule',
    describe('PreviewRule'),
    apiValidator('param', param),
    apiValidator('json', ruleValues),
    async (c) =>
      c.json({
        data: await service.previewRule(
          access(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      }),
  );
  router.get(
    '/splitOrders',
    describe('ListOrders'),
    apiValidator('query', listInput),
    async (c) =>
      c.json(await service.list(access(c), 'orders', c.req.valid('query'))),
  );
  router.post(
    '/splitOrders/preview',
    describe('PreviewSource'),
    apiValidator('json', sourceInput),
    async (c) =>
      c.json({ data: await service.preview(access(c), c.req.valid('json')) }),
  );
  router.post(
    '/splitOrders',
    describe('Backfill'),
    apiValidator('json', backfillInput),
    async (c) =>
      c.json({ data: await service.backfill(access(c), c.req.valid('json')) }),
  );
  router.get(
    '/splitOrders/:id',
    describe('GetOrder'),
    apiValidator('param', param),
    apiValidator(
      'query',
      z.object({
        sources: z.coerce.number().int().min(1).default(1),
        payments: z.coerce.number().int().min(1).default(1),
        transfersOrder: z
          .enum(['createdAt', '-createdAt', 'amountCents', '-amountCents'])
          .default('-createdAt'),
        attemptsOrder: z
          .enum(['createdAt', '-createdAt', 'amountCents', '-amountCents'])
          .default('-createdAt'),
        revisionsOrder: z
          .enum(['createdAt', '-createdAt', 'revision', '-revision'])
          .default('-createdAt'),
        revisions: z.coerce.number().int().min(1).default(1),
        transfers: z.coerce.number().int().min(1).default(1),
        attempts: z.coerce.number().int().min(1).default(1),
      }),
    ),
    async (c) =>
      c.json({
        data: await service.detail(
          access(c),
          c.req.valid('param').id,
          c.req.valid('query'),
        ),
      }),
  );
  for (const action of ['review', 'execute', 'recover', 'reverse', 'cancel'])
    router.post(
      `/splitOrders/:id/${action}`,
      describe(action),
      apiValidator('param', param),
      apiValidator('json', actionInput),
      async (c) =>
        c.json({
          data: await service.act(
            access(c),
            c.req.valid('param').id,
            action,
            c.req.valid('json'),
          ),
        }),
    );
  return new Hono().route('/', router);
});
