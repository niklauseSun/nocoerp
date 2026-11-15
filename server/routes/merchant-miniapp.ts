import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { Application } from '@nocobase/app-server/application';
import {
  ApiError,
  getClientAddress,
  apiErrorHandler,
  apiErrorResponses,
  apiValidator,
  dataResponse,
  listResponse,
  defineApiRoutes,
  describeRoute,
} from '@nocobase/app-server/router';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization';
import { merchantMiniappToken } from '../providers/merchant-miniapp.js';
import { merchantMiniappSession } from '../merchant-miniapp/session.js';
import { loginInput, phone } from '../merchant-miniapp/wechat.js';
import { fail } from '../hyl/service.js';
import { amount, date } from '../hyl/schema.js';
import { categories } from '../repairs/model.js';

type Env = AuthEnv & AuthorizationEnv;
const root = '/merchantMiniapp',
  shared = root + '/merchants/:merchantId';
const merchant = z.object({ merchantId: z.uuid() }),
  item = merchant.extend({ id: z.uuid() });
const page = z
  .object({ page: z.coerce.number().int().min(1).max(10000).default(1) })
  .strict();
const version = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const report = z
  .object({
    date,
    amount,
    orders: z.number().int().min(0).max(999999999),
    note: z.string().trim().max(500).default(''),
    id: z.uuid().optional(),
    version: version.optional(),
  })
  .strict()
  .refine((v) => !!v.id === (v.version !== undefined));
const repair = z
  .object({
    assetId: z.uuid(),
    title: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(4000),
    category: z.enum(categories),
    requestId: z.uuid(),
  })
  .strict();
const grant = z.object({
  id: z.string(),
  merchantId: z.string(),
  phone,
  active: z.boolean(),
  actor: z.string(),
  updatedAt: z.string(),
});
const reportDto = z.object({
  id: z.string(),
  number: z.string(),
  date: z.string(),
  status: z.string(),
  version,
  amount: z.string(),
  orders: z.number().nullable(),
  note: z.string(),
});
const repairDto = z.object({
  id: z.string(),
  number: z.string(),
  title: z.string(),
  status: z.string(),
  updatedAt: z.string(),
  description: z.string(),
});
const billDto = z.object({
  id: z.string(),
  number: z.string(),
  dueDate: z.string(),
  amountCents: z.string(),
  remainingCents: z.string(),
  status: z.string(),
});
const meta = z.object({
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});
const doc = (operationId: string, schema: z.ZodType, paginated = false) =>
  describeRoute({
    tags: ['Merchant mini-program'],
    operationId,
    summary: operationId,
    responses: {
      200: paginated ? listResponse(schema, meta) : dataResponse(schema),
      ...apiErrorResponses,
    },
  });
export default defineApiRoutes<Application>((app) => {
  const r = new Hono<Env>(),
    auth = app.container.resolve(authenticationToken),
    authz = app.container.resolve(authorizationToken),
    service = app.container.resolve(merchantMiniappToken);
  const access = (c: Context<Env>) => ({
    actor: String(c.get('auth')!.user.id),
    authorization: c.get('authz'),
  });
  const admin = createMiddleware<Env>(async (c, next) => {
    if (!(await c.get('authz').snapshot()).unrestricted)
      fail('ACCESS_DENIED', 'PERMISSION_DENIED');
    await next();
  });
  r.onError(apiErrorHandler);
  const secured = [
    root + '/merchants',
    shared + '/reports',
    shared + '/reports/:id/submit',
    shared + '/bills',
    shared + '/assets',
    shared + '/repairs',
    shared + '/repairs/:id',
    shared + '/grants',
  ];
  for (const path of secured)
    r.use(path, auth.required(), authz.middleware(), async (c, next) => {
      c.header('Cache-Control', 'private, no-store');
      if (path !== shared + '/grants')
        await service.requireSession(
          access(c).actor,
          c.get('auth')!.session.id,
        );
      await next();
    });
  const loginThrottle = new Map<string, number>();
  let windowStart = 0;
  let totalAttempts = 0;
  const throttled = new ApiError({
    status: 'RESOURCE_EXHAUSTED',
    domain: 'merchantMiniapp',
    reason: 'MINIAPP_LOGIN_RATE',
    message: 'Too many mini-program sign-in attempts.',
  });
  r.post(
    root + '/signIn',
    doc('merchantMiniappSignIn', z.object({ token: z.string() })),
    bodyLimit({
      maxSize: 2048,
      onError: () => fail('MINIAPP_LOGIN_INVALID', 'INVALID_ARGUMENT'),
    }),
    apiValidator('json', loginInput),
    async (c) => {
      // Use only the transport's peer, never client-supplied forwarding headers.
      const now = Date.now();
      if (now - windowStart >= 60_000) {
        windowStart = now;
        loginThrottle.clear();
        totalAttempts = 0;
      }
      const peer = getClientAddress(c) ?? 'unknown-peer';
      const attempts = loginThrottle.get(peer) ?? 0;
      if (
        attempts >= (service.config.signInPerPeerLimit ?? 120) ||
        totalAttempts >= 3000
      ) {
        c.header(
          'Retry-After',
          String(Math.max(1, Math.ceil((windowStart + 60_000 - now) / 1000))),
        );
        throw throttled;
      }
      loginThrottle.set(peer, attempts + 1);
      totalAttempts++;
      c.header('Cache-Control', 'no-store');
      const userId = await service.login(c.req.valid('json'));
      const result = await auth
        .pluginApi<ReturnType<typeof merchantMiniappSession>>(
          'merchant-miniapp-session',
        )
        .issueMerchantMiniappSession({ body: { userId } });
      await service.bindSession(userId, result.sessionId, result.expiresAt);
      return c.json({ data: { token: result.token } });
    },
  );
  r.get(
    root + '/merchants',
    doc(
      'merchantMiniappMerchants',
      z.array(z.object({ id: z.string(), name: z.string() })),
    ),
    async (c) => c.json({ data: await service.merchants(access(c).actor) }),
  );
  r.get(
    shared + '/grants',
    admin,
    doc('merchantMiniappGrants', z.array(grant)),
    apiValidator('param', merchant),
    async (c) =>
      c.json({
        data: await service.adminList(c.req.valid('param').merchantId),
      }),
  );
  r.put(
    shared + '/grants',
    admin,
    doc('merchantMiniappSetGrant', grant),
    apiValidator('param', merchant),
    apiValidator('json', z.object({ phone, active: z.boolean() }).strict()),
    async (c) => {
      const body = c.req.valid('json');
      return c.json({
        data: await service.setGrant(
          access(c).actor,
          c.req.valid('param').merchantId,
          body.phone,
          body.active,
        ),
      });
    },
  );
  r.get(
    shared + '/reports',
    doc(
      'merchantMiniappReports',
      reportDto.extend({ editable: z.boolean(), returnReason: z.string() }),
      true,
    ),
    apiValidator('param', merchant),
    apiValidator('query', page),
    async (c) =>
      c.json(
        await service.reports(
          access(c),
          c.req.valid('param').merchantId,
          c.req.valid('query').page,
        ),
      ),
  );
  r.post(
    shared + '/reports',
    doc('merchantMiniappSaveReport', reportDto),
    apiValidator('param', merchant),
    apiValidator('json', report),
    async (c) =>
      c.json({
        data: await service.saveReport(
          access(c),
          c.req.valid('param').merchantId,
          c.req.valid('json'),
        ),
      }),
  );
  r.post(
    shared + '/reports/:id/submit',
    doc('merchantMiniappSubmitReport', reportDto),
    apiValidator('param', item),
    apiValidator('json', z.object({ version }).strict()),
    async (c) => {
      const p = c.req.valid('param');
      return c.json({
        data: await service.submit(
          access(c),
          p.merchantId,
          p.id,
          c.req.valid('json').version,
        ),
      });
    },
  );
  r.get(
    shared + '/bills',
    doc('merchantMiniappBills', billDto, true),
    apiValidator('param', merchant),
    apiValidator('query', page),
    async (c) =>
      c.json(
        await service.bills(
          access(c),
          c.req.valid('param').merchantId,
          c.req.valid('query').page,
        ),
      ),
  );
  r.get(
    shared + '/assets',
    doc(
      'merchantMiniappAssets',
      z.array(
        z.object({ id: z.string(), name: z.string(), number: z.string() }),
      ),
    ),
    apiValidator('param', merchant),
    async (c) =>
      c.json({
        data: await service.assets(
          access(c).actor,
          c.req.valid('param').merchantId,
        ),
      }),
  );
  r.get(
    shared + '/repairs',
    doc('merchantMiniappRepairs', repairDto, true),
    apiValidator('param', merchant),
    apiValidator('query', page),
    async (c) =>
      c.json(
        await service.repairs(
          access(c).actor,
          c.req.valid('param').merchantId,
          c.req.valid('query').page,
        ),
      ),
  );
  r.post(
    shared + '/repairs',
    doc('merchantMiniappCreateRepair', repairDto),
    apiValidator('param', merchant),
    apiValidator('json', repair),
    async (c) =>
      c.json({
        data: await service.createRepair(
          access(c),
          c.req.valid('param').merchantId,
          c.req.valid('json'),
        ),
      }),
  );
  r.get(
    shared + '/repairs/:id',
    doc(
      'merchantMiniappRepairProgress',
      repairDto.extend({
        events: z.array(
          z.object({
            id: z.string(),
            action: z.string(),
            status: z.string(),
            createdAt: z.string(),
          }),
        ),
      }),
    ),
    apiValidator('param', item),
    async (c) => {
      const p = c.req.valid('param');
      return c.json({
        data: await service.progress(access(c).actor, p.merchantId, p.id),
      });
    },
  );
  return new Hono().route('/', r);
});
