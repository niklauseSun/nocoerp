import { viewSchema, monthSchema } from '../hyl/filters.js';
import { Hono, type Context } from 'hono';
import type { Application } from '@nocobase/app-server/application';
import type { AuthEnv } from '@nocobase/app-plugin-authentication';
import { z } from 'zod';
import { authenticationToken } from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization';
import {
  defineApiRoutes,
  dataResponse,
  apiErrorResponses,
  describeRoute,
  apiValidator,
  apiErrorHandler,
  ApiError,
} from '@nocobase/app-server/router';
import { LifecycleError, lifecycleErrorFields } from '@nocobase/lifecycle';
import { hylToken } from '../providers/hyl.js';
import { kinds, schemas, actionSchema } from '../hyl/schema.js';

const list = z.object({
  view: viewSchema.optional(),
  month: monthSchema.optional(),
  q: z.string().max(100).default(''),
  status: z.string().max(30).default(''),
  merchantId: z.string().max(100).default(''),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  orderBy: z.string().max(40).default('updatedAt:desc'),
});
const idSchema = z.object({ id: z.string().uuid() });
const description = (id: string) =>
  describeRoute({
    tags: ['海源里经营结算'],
    summary: id,
    operationId: `hyl${id}`,
    responses: {
      '200': { description: 'Success' },
      '201': { description: 'Created' },
      '400': { description: 'Invalid input or state' },
      '401': { description: 'Authentication required' },
      '403': { description: 'Permission denied' },
      '404': { description: 'Not found' },
      '409': { description: 'Concurrent change or duplicate' },
    },
  });
const comparisonSchema = z.object({
  previousAmount: z.string(),
  changeAmount: z.string(),
  changePercent: z.string().nullable(),
  previousReportCount: z.number(),
});
export default defineApiRoutes<Application>((app) => {
  const service = app.container.resolve(hylToken);
  const auth = app.container.resolve(authenticationToken),
    authorization = app.container.resolve(authorizationToken);
  const router = new Hono();
  const dashboardRouter = new Hono<AuthorizationEnv & AuthEnv>();
  dashboardRouter.use(
    '/hylDashboard',
    auth.required(),
    authorization.middleware(),
  );
  dashboardRouter.get(
    '/hylDashboard',
    describeRoute({
      tags: ['海源里经营结算'],
      summary: 'Scoped operating dashboard',
      operationId: 'hylDashboard',
      responses: {
        '200': dataResponse(
          z.object({
            month: z.string(),
            updatedAt: z.string(),
            merchants: z.number().nullable(),
            revenue: z.string().nullable(),
            pendingReports: z.number().nullable(),
            unsettled: z.string().nullable(),
            unpaid: z.string().nullable(),
            analytics: z
              .object({
                previousMonth: z.string(),
                comparison: comparisonSchema,
                daily: z.array(
                  z.object({ date: z.string(), amount: z.string() }),
                ),
                reportCount: z.number(),
                rankedMerchantCount: z.number(),
                ranking: z.array(
                  z.object({
                    merchantId: z.string(),
                    name: z.string().nullable(),
                    amount: z.string(),
                    reportCount: z.number(),
                    comparison: comparisonSchema,
                  }),
                ),
              })
              .nullable(),
          }),
        ),
        ...apiErrorResponses,
      },
    }),
    apiValidator('query', z.object({ month: monthSchema.optional() }).strict()),
    async (c) =>
      c.json({
        data: await service.dashboard(
          {
            actor: String(c.get('auth')?.user.id),
            authorization: c.get('authz'),
          },
          c.req.valid('query').month,
        ),
      }),
  );
  router.route('/', dashboardRouter);
  for (const kind of kinds) {
    const routes = new Hono<AuthorizationEnv & AuthEnv>();
    routes.use('*', auth.required(), authorization.middleware());
    const access = (c: Context<AuthorizationEnv & AuthEnv>) => ({
      actor: String(c.get('auth')?.user.id),
      authorization: c.get('authz'),
    });
    routes.onError((error, c) => {
      if (error instanceof LifecycleError) {
        const fields = lifecycleErrorFields(error);
        if (fields)
          return apiErrorHandler(new ApiError({ ...fields, domain: 'hyl' }), c);
      }
      const e = error as Error & { code?: string };
      if (e.code === '23505' || e.code === 'UNIQUE_CONSTRAINT')
        return apiErrorHandler(
          new ApiError({
            status: 'ALREADY_EXISTS',
            reason: 'DUPLICATE_REFERENCE',
            domain: 'hyl',
            message: 'The business reference is already used.',
          }),
          c,
        );
      return apiErrorHandler(error, c);
    });
    routes.get(
      '/',
      description(`${kind}List`),
      apiValidator('query', list),
      async (c) =>
        c.json(await service.list(access(c), kind, c.req.valid('query'))),
    );
    routes.get(
      '/:id',
      description(`${kind}Detail`),
      apiValidator('param', idSchema),
      async (c) =>
        c.json({
          data: await service.detail(access(c), kind, c.req.valid('param').id),
        }),
    );
    routes.post(
      '/',
      description(`${kind}Create`),
      apiValidator('json', schemas[kind]),
      async (c) =>
        c.json(
          {
            data:
              kind === 'settlements'
                ? await service.generate(access(c), c.req.valid('json'))
                : await service.save(access(c), kind, c.req.valid('json')),
          },
          201,
        ),
    );
    if (kind !== 'settlements')
      routes.patch(
        '/:id',
        description(`${kind}Update`),
        apiValidator('param', idSchema),
        apiValidator(
          'json',
          z
            .object({
              expectedVersion: z.number().int().min(0),
              values: schemas[kind],
            })
            .strict(),
        ),
        async (c) => {
          const b = c.req.valid('json');
          return c.json({
            data: await service.save(
              access(c),
              kind,
              b.values,
              c.req.valid('param').id,
              b.expectedVersion,
            ),
          });
        },
      );
    if (
      kind === 'settlements' ||
      kind === 'revenueReports' ||
      kind === 'expenses'
    ) {
      for (const action of kind === 'settlements'
        ? ['review', 'confirm', 'dispute', 'cancel', 'pay']
        : ['submit', 'approve', 'return']) {
        routes.post(
          `/:id/${action === 'pay' ? 'payments' : action}`,
          description(`${kind}${action}`),
          apiValidator('param', idSchema),
          apiValidator('json', actionSchema),
          async (c) =>
            c.json({
              data: await service.act(
                access(c),
                kind,
                c.req.valid('param').id,
                action,
                c.req.valid('json'),
              ),
            }),
        );
      }
    }
    router.route(`/${kind}`, routes);
  }
  return router;
});
