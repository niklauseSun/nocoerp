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
import { messageToken } from '../providers/messages.js';
import {
  preferenceValues,
  preferenceInput,
  listInput,
} from '../messages/schema.js';
const preferences = preferenceValues.extend({
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastCheckedAt: z.string(),
  lastError: z.string(),
});
const todo = z.object({
  id: z.string(),
  kind: z.string(),
  reason: z.string(),
  dueOn: z.string(),
  status: z.string(),
  generation: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  number: z.string(),
  title: z.string(),
  path: z.string(),
  notificationId: z.string(),
});
const detail = todo.extend({
  deliveryStatus: z.string(),
  canRetry: z.boolean(),
});
const result = z.object({
  active: z.number(),
  created: z.number(),
  resolved: z.number(),
  sent: z.number(),
  failed: z.number(),
  busy: z.boolean(),
});
const describe = (name: string, schema: z.ZodType, list = false) =>
  describeRoute({
    tags: ['Messages'],
    operationId: 'messages' + name,
    summary: 'Personal messages ' + name,
    responses: {
      200: list ? listResponse(schema) : dataResponse(schema),
      ...apiErrorResponses,
    },
  });
export default defineApiRoutes<Application>((app) => {
  const router = new Hono<AuthEnv & AuthorizationEnv>(),
    auth = app.container.resolve(authenticationToken),
    authz = app.container.resolve(authorizationToken),
    service = app.container.resolve(messageToken);
  const access = (c: Context<AuthEnv & AuthorizationEnv>) => ({
    actor: String(c.get('auth')?.user.id),
    authorization: c.get('authz'),
  });
  router.onError(apiErrorHandler);
  // Personal ownership is enforced inside every method; each business source additionally checks its domain policies.
  for (const path of [
    '/messagePreferences',
    '/messageChecks',
    '/messageTodos',
    '/messageTodos/:id',
    '/messageTodos/:id/retry',
  ])
    router.use(path, auth.required(), authz.middleware());
  router.get(
    '/messagePreferences',
    describe('Preferences', preferences),
    async (c) =>
      c.json({
        data: service.publicPreferences(await service.preferences(access(c))),
      }),
  );
  router.post(
    '/messagePreferences',
    describe('SavePreferences', preferences),
    apiValidator('json', preferenceInput),
    async (c) =>
      c.json({ data: await service.save(access(c), c.req.valid('json')) }),
  );
  router.post(
    '/messageChecks',
    describe('Check', result),
    apiValidator('json', z.object({}).strict()),
    async (c) => c.json({ data: await service.scan(access(c)) }),
  );
  router.get(
    '/messageTodos',
    describe('Todos', todo, true),
    apiValidator('query', listInput),
    async (c) => c.json(await service.list(access(c), c.req.valid('query'))),
  );
  router.get(
    '/messageTodos/:id',
    describe('Detail', detail),
    apiValidator('param', z.object({ id: z.uuid() })),
    async (c) =>
      c.json({
        data: await service.detail(access(c), c.req.valid('param').id),
      }),
  );
  router.post(
    '/messageTodos/:id/retry',
    describe('Retry', detail),
    apiValidator('param', z.object({ id: z.uuid() })),
    apiValidator('json', z.object({}).strict()),
    async (c) =>
      c.json({ data: await service.retry(access(c), c.req.valid('param').id) }),
  );
  return new Hono().route('/', router);
});
