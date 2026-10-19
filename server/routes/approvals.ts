import { LifecycleError, lifecycleErrorFields } from '@nocobase/lifecycle';
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
  ApiError,
} from '@nocobase/app-server/router';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization';
import { approvalToken } from '../providers/approvals.js';
import {
  personDto,
  configDto,
  requestDto,
  detailDto,
  sourceDto,
  kinds,
  configSave,
  submission,
  actionInput,
  listInput,
} from '../approvals/schema.js';
const id = z.object({ id: z.uuid() });
const record = z.record(z.string(), z.unknown());
const describe = (name: string, schema: z.ZodType = record, list = false) =>
  describeRoute({
    tags: ['Approvals'],
    operationId: 'approvals' + name,
    summary: 'Sequential business approvals: ' + name,
    responses: {
      200: list ? listResponse(schema) : dataResponse(schema),
      400: {
        description:
          'Invalid input, source state, missing reviewer or business precondition.',
      },
      404: {
        description:
          'Source or approval is missing or outside the caller’s project scope.',
      },
      409: {
        description:
          'Source/configuration changed or action key was reused with different intent.',
      },
      ...apiErrorResponses,
    },
  });
export default defineApiRoutes<Application>((app) => {
  const router = new Hono<AuthEnv & AuthorizationEnv>(),
    auth = app.container.resolve(authenticationToken),
    authz = app.container.resolve(authorizationToken),
    service = app.container.resolve(approvalToken);
  const access = (c: Context<AuthEnv & AuthorizationEnv>) => ({
    actor: String(c.get('auth')?.user.id),
    authorization: c.get('authz'),
  });
  router.onError((error, c) => {
    if (error instanceof LifecycleError) {
      const fields = lifecycleErrorFields(error);
      if (fields)
        return apiErrorHandler(
          new ApiError({ ...fields, domain: 'approvals' }),
          c,
        );
    }
    return apiErrorHandler(error, c);
  });
  for (const p of [
    '/approvalProjects',
    '/approvalPeople',
    '/approvalConfigs',
    '/approvalConfigs/:projectId/:kind',
    '/approvalSources/:kind/:id',
    '/approvalRequests',
    '/approvalRequests/:id',
    '/approvalRequests/:id/actions',
  ])
    router.use(p, auth.required(), authz.middleware());
  router.get(
    '/approvalProjects',
    describe('Projects', z.array(personDto)),
    apiValidator(
      'query',
      z.object({
        action: z.enum(['read', 'configure', 'submit']).default('read'),
      }),
    ),
    async (c) =>
      c.json({
        data: await service.projects(access(c), c.req.valid('query').action),
      }),
  );
  router.get(
    '/approvalPeople',
    describe('People', personDto, true),
    apiValidator(
      'query',
      z.object({
        q: z.string().max(100).default(''),
        page: z.coerce.number().int().min(1).default(1),
      }),
    ),
    async (c) => {
      const q = c.req.valid('query');
      return c.json(await service.people(access(c), q.q, q.page));
    },
  );
  router.get(
    '/approvalConfigs',
    describe('Configurations', z.array(configDto)),
    async (c) => c.json({ data: await service.configs(access(c)) }),
  );
  router.get(
    '/approvalConfigs/:projectId/:kind',
    describe('Configuration', configDto),
    apiValidator(
      'param',
      z.object({ projectId: z.uuid(), kind: z.enum(kinds) }),
    ),
    async (c) => {
      const p = c.req.valid('param');
      return c.json({
        data: await service.config(access(c), p.projectId, p.kind),
      });
    },
  );
  router.post(
    '/approvalConfigs',
    describe('SaveConfiguration', configDto),
    apiValidator('json', configSave),
    async (c) =>
      c.json({
        data: await service.saveConfig(access(c), c.req.valid('json')),
      }),
  );
  router.get(
    '/approvalSources/:kind/:id',
    describe('Source', sourceDto),
    apiValidator('param', z.object({ id: z.uuid(), kind: z.enum(kinds) })),
    async (c) => {
      const p = c.req.valid('param');
      return c.json({
        data: await service.sourceView(access(c), p.kind, p.id),
      });
    },
  );
  router.get(
    '/approvalRequests',
    describe('Requests', requestDto, true),
    apiValidator('query', listInput),
    async (c) => c.json(await service.list(access(c), c.req.valid('query'))),
  );
  router.post(
    '/approvalRequests',
    describe('Submit', detailDto),
    apiValidator('json', submission),
    async (c) =>
      c.json({ data: await service.submit(access(c), c.req.valid('json')) }),
  );
  router.get(
    '/approvalRequests/:id',
    describe('Detail', detailDto),
    apiValidator('param', id),
    apiValidator(
      'query',
      z.object({
        eventPage: z.coerce.number().int().min(1).default(1),
        eventOrder: z.enum(['createdAt', '-createdAt']).default('-createdAt'),
      }),
    ),
    async (c) => {
      const q = c.req.valid('query');
      return c.json({
        data: await service.detail(
          access(c),
          c.req.valid('param').id,
          q.eventPage,
          q.eventOrder,
        ),
      });
    },
  );
  router.post(
    '/approvalRequests/:id/actions',
    describe('Decision', detailDto),
    apiValidator('param', id),
    apiValidator('json', actionInput),
    async (c) =>
      c.json({
        data: await service.decide(
          access(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      }),
  );
  return new Hono().route('/', router);
});
