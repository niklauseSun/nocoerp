import { Hono } from 'hono';
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
import { LeaseService } from '../leases/service.js';
import { operationSchema } from '../leases/model.js';
import { date } from '../hyl/schema.js';
const params = z.object({ id: z.string().uuid() });
const describe = (action: string) =>
  describeRoute({
    tags: ['Lease lifecycle'],
    operationId: `lease${action}`,
    summary: `Lease ${action}`,
    responses: {
      200: { description: 'Success' },
      400: { description: 'Invalid input' },
      401: { description: 'Authentication required' },
      403: { description: 'Permission denied' },
      404: { description: 'Not found' },
      409: { description: 'Conflict' },
      412: { description: 'Business precondition failed' },
    },
  });
export default defineApiRoutes<Application>((app) => {
  const service = new LeaseService(app.container.resolve(hylToken));
  const router = new Hono<AuthEnv & AuthorizationEnv>();
  const auth = app.container.resolve(authenticationToken),
    authz = app.container.resolve(authorizationToken);
  const access = (c: import('hono').Context<AuthEnv & AuthorizationEnv>) => ({
    actor: String(c.get('auth')?.user.id),
    authorization: c.get('authz'),
  });
  router.onError(apiErrorHandler);
  for (const path of [
    '/contracts/:id/leaseSummary',
    '/contracts/:id/terminationPreview',
    '/contracts/:id/leaseActions/:action',
  ])
    router.use(path, auth.required(), authz.middleware());
  router.get(
    '/contracts/:id/leaseSummary',
    describe('Summary'),
    apiValidator('param', params),
    async (c) =>
      c.json({
        data: await service.summary(access(c), c.req.valid('param').id),
      }),
  );
  router.post(
    '/contracts/:id/terminationPreview',
    describe('TerminationPreview'),
    apiValidator('param', params),
    apiValidator(
      'json',
      z
        .object({ actualEnd: date, closing: z.boolean().default(false) })
        .strict(),
    ),
    async (c) =>
      c.json({
        data: await service.preview(
          access(c),
          c.req.valid('param').id,
          c.req.valid('json').actualEnd,
          c.req.valid('json').closing,
        ),
      }),
  );
  router.post(
    '/contracts/:id/leaseActions/:action',
    describe('Action'),
    apiValidator(
      'param',
      params.extend({
        action: z.enum([
          'receive',
          'refund',
          'deduct',
          'reverse',
          'collect',
          'reverseCollection',
          'charge',
          'confirmCharge',
          'cancelCharge',
          'renew',
          'terminate',
          'closeLease',
          'reopenLease',
        ]),
      }),
    ),
    apiValidator('json', operationSchema),
    async (c) =>
      c.json({
        data: await service.operate(
          access(c),
          c.req.valid('param').id,
          c.req.valid('param').action,
          c.req.valid('json'),
        ),
      }),
  );
  return new Hono().route('/', router);
});
