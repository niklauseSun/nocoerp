import { Hono } from 'hono';
import { z } from 'zod';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  apiErrorHandler,
  ApiError,
  apiValidator,
  describeRoute,
  listResponse,
  dataResponse,
  apiErrorResponses,
} from '@nocobase/app-server/router';
import { operationLogsToken } from '../providers/operation-logs.js';
import { querySchema, logSchema } from '../operation-logs/model.js';
export default defineApiRoutes<Application>((app) => {
  const r = new Hono<AuthEnv & AuthorizationEnv>(),
    auth = app.container.resolve(authenticationToken),
    authz = app.container.resolve(authorizationToken),
    service = app.container.resolve(operationLogsToken);
  r.onError(apiErrorHandler);
  for (const path of ['/operationLogs', '/operationLogs/:id'])
    r.use(path, auth.required(), authz.middleware(), async (c, next) => {
      if (!(await c.get('authz').snapshot()).unrestricted)
        throw new ApiError({
          status: 'PERMISSION_DENIED',
          reason: 'ADMIN_REQUIRED',
          domain: 'operationLogs',
          message: 'Unrestricted administrator required',
        });
      await next();
    });
  r.get(
    '/operationLogs',
    describeRoute({
      tags: ['Operation logs'],
      operationId: 'operationLogsList',
      summary:
        'Read business and administration operation logs (unrestricted administrators only)',
      responses: {
        200: listResponse(
          logSchema,
          z.object({
            total: z.number(),
            page: z.number(),
            pageSize: z.number(),
          }),
        ),
        ...apiErrorResponses,
      },
    }),
    apiValidator('query', querySchema),
    async (c) => c.json(await service.list(c.req.valid('query'))),
  );
  r.get(
    '/operationLogs/:id',
    describeRoute({
      tags: ['Operation logs'],
      operationId: 'operationLogsGet',
      summary: 'Read one immutable operation log',
      responses: { 200: dataResponse(logSchema), ...apiErrorResponses },
    }),
    apiValidator('param', z.object({ id: z.string().uuid() })),
    async (c) => c.json({ data: await service.get(c.req.valid('param').id) }),
  );
  return new Hono().route('/', r);
});
