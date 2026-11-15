import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import {
  defineApiRoutes,
  describeRoute,
  apiValidator,
  apiErrorHandler,
  dataResponse,
  apiErrorResponses,
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
import { wecomToken } from '../providers/wecom.js';
import { settingsId, mappingInput, syncInput } from '../wecom/model.js';
const id = z.object({ id: z.string().uuid() });
const query = z.object({
  q: z.string().max(100).default(''),
  kind: z.enum(['', 'user', 'department']).default(''),
  page: z.coerce.number().int().min(1).default(1),
  order: z.enum(['asc', 'desc']).default('desc'),
});
const snapshot = z.object({
  name: z.string(),
  parent: z.string().optional(),
  email: z.string().optional(),
  departments: z.array(z.string()).optional(),
  primary: z.string().optional(),
  enabled: z.boolean(),
});
const mapping = z.object({
  id: z.string(),
  corpId: z.string(),
  kind: z.enum(['user', 'department']),
  localId: z.string(),
  remoteId: z.string(),
  localExists: z.boolean(),
  remoteExists: z.boolean(),
  baseline: snapshot.nullable(),
  intent: snapshot.nullable(),
  intentDirection: z.string(),
  state: z.string(),
  version: z.number(),
  error: z.string(),
  updatedAt: z.string(),
});
const identity = z.object({ id: z.string(), name: z.string() });
const responses = {
  wecomStatus: z.object({
    configuration: z.object({
      enabled: z.boolean(),
      corpId: z.string(),
      agentId: z.string(),
      directoryRead: z.boolean(),
      directoryWrite: z.boolean(),
      messages: z.boolean(),
      autoSync: z.boolean(),
    }),
    items: z.array(mapping),
    total: z.number(),
  }),
  wecomOptions: z.object({
    users: z.array(identity),
    userTotal: z.number(),
    departments: z.array(identity),
  }),
  wecomCheck: z.object({ connected: z.boolean() }),
  wecomCreateMapping: mapping,
  wecomSync: mapping,
  wecomReconcile: mapping,
  wecomPreview: z.object({
    mapping,
    local: snapshot.nullable(),
    remote: snapshot.nullable(),
    suggested: z.enum(['pull', 'push', 'equal', 'conflict']),
    fingerprint: z.string(),
    history: z.array(
      z.object({
        id: z.string(),
        mappingId: z.string(),
        actor: z.string(),
        direction: z.string(),
        result: z.string(),
        error: z.string(),
        at: z.string(),
      }),
    ),
  }),
};
const description = (operationId: keyof typeof responses) =>
  describeRoute({
    tags: ['WeCom'],
    operationId,
    summary: operationId,
    responses: {
      200: dataResponse(responses[operationId]),
      ...apiErrorResponses,
    },
  });
export default defineApiRoutes<Application>((app) => {
  const r = new Hono<AuthEnv & AuthorizationEnv>(),
    auth = app.container.resolve(authenticationToken),
    authz = app.container.resolve(authorizationToken),
    s = app.container.resolve(wecomToken);
  const allowed = (write = false) =>
    createMiddleware<AuthEnv & AuthorizationEnv>(async (c, next) => {
      const a = c.get('authz');
      await a.require({
        resource: { type: 'settings', id: settingsId },
        action: write ? 'update' : 'read',
      });
      await a.require({
        resource: { type: 'settings', id: 'hyl.organization' },
        action: write ? 'update' : 'read',
      });
      for (const action of write
        ? ['read', 'create', 'update', 'disable', 'enable']
        : ['read'])
        await a.require({ resource: { type: 'user', id: '*' }, action });
      await next();
    });
  for (const path of [
    '/wecom',
    '/wecom/check',
    '/wecom/options',
    '/wecom/mappings',
    '/wecom/mappings/:id',
    '/wecom/mappings/:id/sync',
    '/wecom/mappings/:id/reconcile',
  ])
    r.use(path, auth.required(), authz.middleware());
  r.onError(apiErrorHandler);
  r.get(
    '/wecom',
    allowed(),
    description('wecomStatus'),
    apiValidator('query', query),
    async (c) => {
      const q = c.req.valid('query'),
        all = (await s.mappings()).filter(
          (m) =>
            (!q.kind || m.kind === q.kind) &&
            (!q.q ||
              (m.localId + ' ' + m.remoteId)
                .toLowerCase()
                .includes(q.q.toLowerCase())),
        );
      if (q.order === 'asc') all.reverse();
      return c.json({
        data: {
          configuration: s.status(),
          items: all.slice((q.page - 1) * 20, q.page * 20),
          total: all.length,
        },
      });
    },
  );
  r.get(
    '/wecom/options',
    allowed(),
    description('wecomOptions'),
    apiValidator('query', query),
    async (c) => {
      const q = c.req.valid('query');
      const people = await s.org.users.list({
        page: q.page,
        pageSize: 50,
        search: q.q,
      });
      const departments = await s.org.tree();
      return c.json({
        data: {
          users: people.items.map((u) => ({ id: u.id, name: u.name })),
          userTotal: people.total,
          departments: departments.map((d) => ({ id: d.id, name: d.title })),
        },
      });
    },
  );
  r.post(
    '/wecom/check',
    allowed(true),
    description('wecomCheck'),
    apiValidator('json', z.object({}).strict()),
    async (c) => c.json({ data: await s.check() }),
  );
  r.post(
    '/wecom/mappings',
    allowed(true),
    description('wecomCreateMapping'),
    apiValidator('json', mappingInput),
    async (c) =>
      c.json({
        data: await s.create(c.get('auth')!.user.id, c.req.valid('json')),
      }),
  );
  r.get(
    '/wecom/mappings/:id',
    allowed(),
    description('wecomPreview'),
    apiValidator('param', id),
    async (c) => c.json({ data: await s.preview(c.req.valid('param').id) }),
  );
  r.post(
    '/wecom/mappings/:id/sync',
    allowed(true),
    description('wecomSync'),
    apiValidator('param', id),
    apiValidator('json', syncInput),
    async (c) => {
      const x = c.req.valid('json');
      return c.json({
        data: await s.sync(
          c.get('auth')!.user.id,
          c.req.valid('param').id,
          x.fingerprint,
          x.direction,
        ),
      });
    },
  );
  r.post(
    '/wecom/mappings/:id/reconcile',
    allowed(true),
    description('wecomReconcile'),
    apiValidator('param', id),
    apiValidator('json', z.object({}).strict()),
    async (c) =>
      c.json({
        data: await s.reconcile(
          c.get('auth')!.user.id,
          c.req.valid('param').id,
        ),
      }),
  );
  return new Hono().route('/', r);
});
