import { Hono, type Context } from 'hono';
import {
  defineApiRoutes,
  describeRoute,
  apiValidator,
  apiErrorHandler,
  dataResponse,
  apiErrorResponses,
  resolver,
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
import { hylToken } from '../providers/hyl.js';
import { FinanceService } from '../finance/service.js';
import { querySchema, lineSchema, reportDataSchema } from '../finance/model.js';
const description = (detail = false) =>
  describeRoute({
    tags: ['Financial reports'],
    operationId: detail ? 'financialReportSource' : 'financialReports',
    summary: detail
      ? 'Read an authorized financial source'
      : 'Registered cash movements and current financial balances',
    description:
      'CNY integer cents; cash and deposit movements use Asia/Shanghai registration days. Receivables, payables and current deposits are a current transaction snapshot, independent of the range. Totals cover the intersection of finance and original source record permissions. Cash opening/closing are cumulative registered movements, not bank balances.',
    responses: {
      200: detail
        ? dataResponse(lineSchema.extend({ generatedAt: z.string() }))
        : {
            description: 'Complete totals before table filtering/pagination',
            content: {
              'application/json': {
                schema: resolver(
                  z.object({
                    data: reportDataSchema,
                    meta: z.object({
                      page: z.number(),
                      pageSize: z.number(),
                      total: z.number(),
                    }),
                  }),
                ),
              },
            },
          },
      ...apiErrorResponses,
      400: { description: 'Invalid date range or query' },
      401: { description: 'Authentication required' },
      403: { description: 'Finance or original source permission required' },
      404: { description: 'Source not found in authorized scope' },
    },
  });
export default defineApiRoutes<Application>((app) => {
  const r = new Hono<AuthEnv & AuthorizationEnv>(),
    auth = app.container.resolve(authenticationToken),
    authz = app.container.resolve(authorizationToken),
    service = new FinanceService(app.container.resolve(hylToken));
  const access = (c: Context<AuthEnv & AuthorizationEnv>) => ({
    actor: String(c.get('auth')!.user.id),
    authorization: c.get('authz'),
  });
  r.onError(apiErrorHandler);
  for (const path of ['/financialReports', '/financialReports/:kind/:id'])
    r.use(path, auth.required(), authz.middleware());
  r.get(
    '/financialReports',
    description(),
    apiValidator('query', querySchema),
    async (c) => c.json(await service.report(access(c), c.req.valid('query'))),
  );
  r.get(
    '/financialReports/:kind/:id',
    description(true),
    apiValidator(
      'param',
      z.object({
        kind: z.enum(['event', 'receivable', 'payable', 'deposit']),
        id: z.string().min(1).max(150),
      }),
    ),
    apiValidator('query', querySchema),
    async (c) => {
      const p = c.req.valid('param');
      return c.json({
        data: await service.detail(
          access(c),
          c.req.valid('query'),
          p.kind,
          p.id,
        ),
      });
    },
  );
  return new Hono().route('/', r);
});
