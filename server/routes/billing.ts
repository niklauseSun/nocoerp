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
import { BillingService } from '../billing/service.js';
import {
  configSchema,
  billValuesSchema,
  billCreateSchema,
  billEditSchema,
  operationSchema,
  receiptSchema,
  listSchema,
} from '../billing/model.js';
const params = z.object({ id: z.string().uuid() });
const pages = z.object({
  auditPage: z.coerce.number().int().min(1).default(1),
  linePage: z.coerce.number().int().min(1).default(1),
  ledgerPage: z.coerce.number().int().min(1).default(1),
});
const describe = (id: string) =>
  describeRoute({
    tags: ['Billing'],
    operationId: `billing${id}`,
    summary: `Billing ${id}`,
    responses: {
      200: { description: 'Success' },
      201: { description: 'Created' },
      400: { description: 'Invalid argument or business precondition' },
      401: { description: 'Authentication required' },
      403: { description: 'Permission denied' },
      404: { description: 'Not found in permitted records' },
      409: { description: 'Version, reference or idempotency conflict' },
    },
  });
export default defineApiRoutes<Application>((app) => {
  const service = new BillingService(app.container.resolve(hylToken));
  const router = new Hono<AuthEnv & AuthorizationEnv>();
  const auth = app.container.resolve(authenticationToken),
    authz = app.container.resolve(authorizationToken);
  const access = (c: Context<AuthEnv & AuthorizationEnv>) => ({
    actor: String(c.get('auth')?.user.id),
    authorization: c.get('authz'),
  });
  router.onError(apiErrorHandler);
  for (const path of [
    '/billingOverview',
    '/contracts/:id/billingConfig',
    '/contracts/:id/billingSummary',
    '/contracts/:id/previewBill',
    '/bills',
    '/bills/:id',
    '/bills/:id/:action',
    '/receipts',
    '/receipts/:id',
    '/receipts/:id/:action',
  ])
    router.use(path, auth.required(), authz.middleware());
  router.get('/billingOverview', describe('Overview'), async (c) =>
    c.json({ data: await service.overview(access(c)) }),
  );
  router.get(
    '/contracts/:id/billingConfig',
    describe('Configuration'),
    apiValidator('param', params),
    async (c) =>
      c.json({
        data: await service.configuration(
          access(c),
          c.req.valid('param').id,
          true,
        ),
      }),
  );
  router.put(
    '/contracts/:id/billingConfig',
    describe('Configure'),
    apiValidator('param', params),
    apiValidator('json', configSchema),
    async (c) =>
      c.json({
        data: await service.saveConfiguration(
          access(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      }),
  );
  router.get(
    '/contracts/:id/billingSummary',
    describe('ContractSummary'),
    apiValidator('param', params),
    async (c) =>
      c.json({
        data: await service.summary(access(c), c.req.valid('param').id),
      }),
  );
  router.post(
    '/contracts/:id/previewBill',
    describe('Preview'),
    apiValidator('param', params),
    apiValidator(
      'json',
      billValuesSchema.extend({ billId: z.string().uuid().optional() }),
    ),
    async (c) =>
      c.json({
        data: await service.preview(
          access(c),
          c.req.valid('param').id,
          c.req.valid('json'),
          c.req.valid('json').billId,
        ),
      }),
  );
  router.get(
    '/bills',
    describe('ListBills'),
    apiValidator('query', listSchema),
    async (c) =>
      c.json(await service.list(access(c), 'bills', c.req.valid('query'))),
  );
  router.post(
    '/bills',
    describe('CreateBill'),
    apiValidator('json', billCreateSchema),
    async (c) =>
      c.json(
        { data: await service.createBill(access(c), c.req.valid('json')) },
        201,
      ),
  );
  router.get(
    '/bills/:id',
    describe('Bill'),
    apiValidator('param', params),
    apiValidator('query', pages),
    async (c) =>
      c.json({
        data: await service.billDetail(
          access(c),
          c.req.valid('param').id,
          c.req.valid('query').linePage,
          c.req.valid('query').ledgerPage,
          c.req.valid('query').auditPage,
        ),
      }),
  );
  router.patch(
    '/bills/:id',
    describe('EditBill'),
    apiValidator('param', params),
    apiValidator('json', billEditSchema),
    async (c) =>
      c.json({
        data: await service.editBill(
          access(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      }),
  );
  router.post(
    '/bills/:id/:action',
    describe('BillAction'),
    apiValidator(
      'param',
      params.extend({ action: z.enum(['issue', 'void', 'applyDeposit']) }),
    ),
    apiValidator('json', operationSchema),
    async (c) =>
      c.json({
        data: await service.billAction(
          access(c),
          c.req.valid('param').id,
          c.req.valid('param').action,
          c.req.valid('json'),
        ),
      }),
  );
  router.get(
    '/receipts',
    describe('ListReceipts'),
    apiValidator('query', listSchema),
    async (c) =>
      c.json(await service.list(access(c), 'receipts', c.req.valid('query'))),
  );
  router.post(
    '/receipts',
    describe('RecordReceipt'),
    apiValidator('json', receiptSchema),
    async (c) =>
      c.json(
        { data: await service.recordReceipt(access(c), c.req.valid('json')) },
        201,
      ),
  );
  router.get(
    '/receipts/:id',
    describe('Receipt'),
    apiValidator('param', params),
    apiValidator('query', pages),
    async (c) =>
      c.json({
        data: await service.receiptDetail(
          access(c),
          c.req.valid('param').id,
          c.req.valid('query').ledgerPage,
          c.req.valid('query').auditPage,
        ),
      }),
  );
  router.post(
    '/receipts/:id/:action',
    describe('ReceiptAction'),
    apiValidator(
      'param',
      params.extend({
        action: z.enum([
          'allocate',
          'reverseAllocation',
          'refund',
          'reverseRefund',
          'void',
        ]),
      }),
    ),
    apiValidator('json', operationSchema),
    async (c) =>
      c.json({
        data: await service.operateReceipt(
          access(c),
          c.req.valid('param').id,
          c.req.valid('param').action,
          c.req.valid('json'),
        ),
      }),
  );
  return new Hono().route('/', router);
});
