import {
  listItems,
  detailItems,
  previewResponse,
  operationResponse,
  backfillPreviewResponse,
  configPreviewResponse,
  configurationResponse,
  configResponse,
  sourceResponse,
} from '../invoicing/responses.js';
import { Hono, type Context } from 'hono';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  describeRoute,
  apiValidator,
  apiErrorHandler,
  dataResponse,
  listResponse,
  apiErrorResponses,
  apiErrorResponse,
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
import { InvoiceService } from '../invoicing/service.js';
import {
  listInput,
  configValues,
  configInput,
  sourceInput,
  backfillInput,
  issueValues,
  issueInput,
  redValues,
  redInput,
} from '../invoicing/model.js';
const param = z.object({ id: z.uuid() });
const describe = (name: string, schema: z.ZodType, list = false) =>
  describeRoute({
    tags: ['Payment invoicing'],
    operationId: 'invoice' + name,
    summary: 'Simulated invoicing ' + name,
    responses: {
      200: list ? listResponse(schema) : dataResponse(schema),
      ...apiErrorResponses,
      400: apiErrorResponse(400, 'Invalid input or precondition'),
      403: apiErrorResponse(403, 'Action forbidden'),
      404: apiErrorResponse(404, 'Unavailable or outside scope'),
      409: apiErrorResponse(409, 'Version, source or request conflict'),
    },
  });
const childKeys = [
  'lines',
  'cash',
  'deposits',
  'invoices',
  'history',
  'credits',
  'members',
  'attempts',
];
const pages = z
  .record(z.string(), z.string().max(100))
  .default({})
  .superRefine((values, ctx) => {
    for (const [key, value] of Object.entries(values)) {
      if (childKeys.includes(key) && !/^[1-9]\d{0,8}$/.test(value))
        ctx.addIssue({ code: 'custom', path: [key], message: 'Invalid page' });
      if (
        childKeys.some((k) => key === k + 'Order') &&
        !/^-?(id|createdAt|issuedAt|grossCents|paidCents|netIssuedCents|availableCents|requiredRedCents|netCents|taxCents|remainingCents|amountCents|version|revision)$/.test(
          value,
        )
      )
        ctx.addIssue({ code: 'custom', path: [key], message: 'Invalid order' });
    }
  })
  .transform((values) =>
    Object.fromEntries(
      Object.entries(values).filter(
        ([key]) =>
          childKeys.includes(key) || childKeys.some((k) => key === k + 'Order'),
      ),
    ),
  );
export default defineApiRoutes<Application>((app) => {
  const service = new InvoiceService(app.container.resolve(hylToken)),
    router = new Hono<AuthEnv & AuthorizationEnv>(),
    auth = app.container.resolve(authenticationToken),
    authz = app.container.resolve(authorizationToken);
  const access = (c: Context<AuthEnv & AuthorizationEnv>) => ({
    actor: String(c.get('auth')?.user.id),
    authorization: c.get('authz'),
  });
  router.onError(apiErrorHandler);
  for (const path of [
    '/invoiceSources',
    '/invoiceSources/:id',
    '/invoiceConfigs',
    '/invoiceConfigs/:id',
    '/invoices',
    '/invoices/:id',
    '/invoices/:id/previewRed',
    '/invoices/:id/red',
    '/contracts/:id/invoiceConfig',
    '/contracts/:id/previewInvoiceConfig',
  ])
    router.use(path, auth.required(), authz.middleware());
  for (const [path, kind] of [
    ['invoiceSources', 'sources'],
    ['invoiceConfigs', 'configs'],
    ['invoices', 'invoices'],
  ] as const) {
    router.get(
      '/' + path,
      describe('List' + kind, listItems[kind], true),
      apiValidator('query', listInput),
      async (c) =>
        c.json(await service.list(access(c), kind, c.req.valid('query'))),
    );
  }
  router.post(
    '/invoiceSources/preview',
    describe('PreviewBackfill', backfillPreviewResponse),
    apiValidator('json', sourceInput),
    async (c) =>
      c.json({
        data: await service.previewBackfill(
          access(c),
          c.req.valid('json').billId,
        ),
      }),
  );
  router.post(
    '/invoiceSources',
    describe('Backfill', sourceResponse.nullable()),
    apiValidator('json', backfillInput),
    async (c) =>
      c.json({ data: await service.backfill(access(c), c.req.valid('json')) }),
  );
  router.post(
    '/invoices/preview',
    describe('PreviewIssue', previewResponse),
    apiValidator('json', issueValues),
    async (c) =>
      c.json({
        data: await service.previewIssue(access(c), c.req.valid('json')),
      }),
  );
  router.post(
    '/invoices',
    describe('Issue', operationResponse),
    apiValidator('json', issueInput),
    async (c) =>
      c.json({ data: await service.issue(access(c), c.req.valid('json')) }),
  );
  router.post(
    '/invoices/:id/previewRed',
    describe('PreviewRed', previewResponse),
    apiValidator('param', param),
    apiValidator('json', redValues),
    async (c) =>
      c.json({
        data: await service.previewRed(
          access(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      }),
  );
  router.post(
    '/invoices/:id/red',
    describe('Red', operationResponse),
    apiValidator('param', param),
    apiValidator('json', redInput),
    async (c) =>
      c.json({
        data: await service.red(
          access(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      }),
  );
  router.get(
    '/contracts/:id/invoiceConfig',
    describe('ContractConfig', configurationResponse),
    apiValidator('param', param),
    async (c) =>
      c.json({
        data: await service.configuration(access(c), c.req.valid('param').id),
      }),
  );
  router.post(
    '/contracts/:id/previewInvoiceConfig',
    describe('PreviewConfig', configPreviewResponse),
    apiValidator('param', param),
    apiValidator('json', configValues),
    async (c) =>
      c.json({
        data: await service.previewConfig(
          access(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      }),
  );
  router.put(
    '/contracts/:id/invoiceConfig',
    describe('SaveConfig', configResponse),
    apiValidator('param', param),
    apiValidator('json', configInput),
    async (c) =>
      c.json({
        data: await service.saveConfig(
          access(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      }),
  );
  for (const [path, kind] of [
    ['invoiceSources', 'sources'],
    ['invoiceConfigs', 'configs'],
    ['invoices', 'invoices'],
  ] as const)
    router.get(
      '/' + path + '/:id',
      describe('Get' + kind, detailItems[kind]),
      apiValidator('param', param),
      apiValidator('query', pages),
      async (c) =>
        c.json({
          data: await service.detail(
            access(c),
            kind,
            c.req.valid('param').id,
            c.req.valid('query'),
          ),
        }),
    );
  return new Hono().route('/', router);
});
