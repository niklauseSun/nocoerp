import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import {
  defineApiRoutes,
  describeRoute,
  apiValidator,
  apiErrorHandler,
  apiErrorResponses,
  dataResponse,
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
import { hylToken } from '../providers/hyl.js';
import { fail } from '../hyl/service.js';
import { SettlementBatches } from '../tenant-operations/batches.js';
import { TenantService } from '../tenant-operations/tenant-service.js';
import {
  IntegrationReadiness,
  integrationCheckSchema,
} from '../tenant-operations/integrations.js';
import {
  batchPreviewSchema,
  batchCreateSchema,
  batchRunSchema,
  deliveryQuery,
  serviceCreateSchema,
  serviceActionSchema,
} from '../tenant-operations/delivery-model.js';
import { xlsx } from '../tenant-operations/export.js';
import { money } from '../hyl/calculation.js';
import en from '../locales/operations-en-US.js';
import zh from '../locales/operations-zh-CN.js';
const describe = (operationId: string) =>
  describeRoute({
    tags: ['Tenant operations'],
    operationId,
    summary: operationId,
    responses: { 200: dataResponse(z.unknown()), ...apiErrorResponses },
  });
export default defineApiRoutes<Application>((app) => {
  const router = new Hono<AuthEnv & AuthorizationEnv>(),
    hyl = app.container.resolve(hylToken),
    batches = new SettlementBatches(hyl),
    service = new TenantService(hyl),
    integration = new IntegrationReadiness(hyl);
  const access = (c: Context<AuthEnv & AuthorizationEnv>) => ({
    actor: String(c.get('auth')!.user.id),
    authorization: c.get('authz'),
  });
  for (const path of [
    '/tenantOperations/batches',
    '/tenantOperations/batches/projects',
    '/tenantOperations/batches/options',
    '/tenantOperations/batches/preview',
    '/tenantOperations/batches/:id',
    '/tenantOperations/batches/:id/run',
    '/tenantOperations/batches/:id/paymentExport',
    '/tenantOperations/serviceRecords',
    '/tenantOperations/serviceRecords/options',
    '/tenantOperations/serviceRecords/:id',
    '/tenantOperations/serviceRecords/:id/actions',
    '/tenantOperations/integrations',
    '/tenantOperations/integrations/check',
  ]) {
    router.use(
      path,
      app.container.resolve(authenticationToken).required(),
      app.container.resolve(authorizationToken).middleware(),
    );
    router.use(
      path,
      bodyLimit({
        maxSize: 128 * 1024,
        onError: () => {
          fail('BODY_TOO_LARGE', 'INVALID_ARGUMENT');
        },
      }),
    );
  }
  router.onError((error, c) => {
    if (
      ('code' in error &&
        ['23505', 'UNIQUE_CONSTRAINT'].includes(String(error.code))) ||
      /unique constraint|duplicate key/i.test(error.message)
    ) {
      try {
        fail('REQUEST_CONFLICT', 'ALREADY_EXISTS');
      } catch (e) {
        return apiErrorHandler(e, c);
      }
    }
    return apiErrorHandler(error, c);
  });
  const idParam = z.object({ id: z.uuid() });
  router.get(
    '/tenantOperations/batches/projects',
    describe('settlementBatchProjects'),
    async (c) => c.json({ data: await batches.projects(access(c)) }),
  );
  router.get(
    '/tenantOperations/batches',
    describe('settlementBatchesList'),
    apiValidator('query', deliveryQuery),
    async (c) => c.json(await batches.list(access(c), c.req.valid('query'))),
  );
  router.get(
    '/tenantOperations/batches/options',
    describe('settlementBatchOptions'),
    apiValidator('query', batchPreviewSchema),
    async (c) =>
      c.json({ data: await batches.preview(access(c), c.req.valid('query')) }),
  );
  router.post(
    '/tenantOperations/batches/preview',
    describe('settlementBatchPreview'),
    apiValidator('json', batchPreviewSchema),
    async (c) =>
      c.json({ data: await batches.preview(access(c), c.req.valid('json')) }),
  );
  router.post(
    '/tenantOperations/batches',
    describe('settlementBatchCreate'),
    apiValidator('json', batchCreateSchema),
    async (c) =>
      c.json({ data: await batches.create(access(c), c.req.valid('json')) }),
  );
  router.get(
    '/tenantOperations/batches/:id',
    describe('settlementBatchDetail'),
    apiValidator('param', idParam),
    async (c) =>
      c.json({
        data: await batches.detail(access(c), c.req.valid('param').id),
      }),
  );
  router.post(
    '/tenantOperations/batches/:id/run',
    describe('settlementBatchRun'),
    apiValidator('param', idParam),
    apiValidator('json', batchRunSchema),
    async (c) =>
      c.json({
        data: await batches.run(
          access(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      }),
  );
  router.get(
    '/tenantOperations/batches/:id/paymentExport',
    describe('settlementBatchPaymentExport'),
    apiValidator('param', idParam),
    apiValidator(
      'query',
      z.object({ locale: z.enum(['zh-CN', 'en-US']).default('zh-CN') }),
    ),
    async (c) => {
      const d = await batches.paymentRows(access(c), c.req.valid('param').id),
        labels = (c.req.valid('query').locale === 'zh-CN' ? zh : en)
          .paymentExport;
      const rows = [
        [labels.title, d.number, d.generatedAt],
        [labels.hint],
        [
          labels.merchant,
          labels.settlement,
          labels.amount,
          labels.accountName,
          labels.bank,
          labels.account,
          labels.validation,
        ],
        ...d.items.map((i) => [
          i.merchantName,
          i.number,
          money(BigInt(i.amountCents)),
          i.accountName,
          i.bank,
          i.account,
          i.eligible ? labels.eligible : labels.blocked,
        ]),
      ];
      return new Response(new Uint8Array(xlsx(rows)), {
        headers: {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="payment-preparation-${d.number}.xlsx"`,
          'Cache-Control': 'private, no-store',
        },
      });
    },
  );
  router.get(
    '/tenantOperations/serviceRecords/options',
    describe('tenantServiceOptions'),
    async (c) => c.json({ data: await service.options(access(c)) }),
  );
  router.get(
    '/tenantOperations/serviceRecords',
    describe('tenantServiceList'),
    apiValidator('query', deliveryQuery),
    async (c) => c.json(await service.list(access(c), c.req.valid('query'))),
  );
  router.post(
    '/tenantOperations/serviceRecords',
    describe('tenantServiceCreate'),
    apiValidator('json', serviceCreateSchema),
    async (c) =>
      c.json({ data: await service.create(access(c), c.req.valid('json')) }),
  );
  router.get(
    '/tenantOperations/serviceRecords/:id',
    describe('tenantServiceDetail'),
    apiValidator('param', idParam),
    async (c) =>
      c.json({
        data: await service.detail(access(c), c.req.valid('param').id),
      }),
  );
  router.post(
    '/tenantOperations/serviceRecords/:id/actions',
    describe('tenantServiceAction'),
    apiValidator('param', idParam),
    apiValidator('json', serviceActionSchema),
    async (c) =>
      c.json({
        data: await service.act(
          access(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      }),
  );
  router.get(
    '/tenantOperations/integrations',
    describe('tenantIntegrations'),
    async (c) => c.json({ data: await integration.list(access(c)) }),
  );
  router.post(
    '/tenantOperations/integrations/check',
    describe('tenantIntegrationTestCheck'),
    apiValidator('json', integrationCheckSchema),
    async (c) =>
      c.json({ data: await integration.check(access(c), c.req.valid('json')) }),
  );
  return new Hono().route('/', router);
});
