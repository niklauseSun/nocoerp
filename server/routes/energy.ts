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
import { hylToken } from '../providers/hyl.js';
import { EnergyService } from '../energy/service.js';
import {
  meterValues,
  assignmentValues,
  readingValues,
  handoverValues,
  stopValues,
  adoptValues,
  billingValues,
  operation,
  listInput,
} from '../energy/model.js';
const id = z.object({ id: z.uuid() }),
  money = z.string(),
  record = z
    .object({
      id: z.string(),
      number: z.string(),
      assetId: z.string(),
      projectId: z.string(),
      meterId: z.string(),
      contractId: z.string(),
      merchantId: z.string(),
      status: z.string(),
      version: z.number(),
      lifecycleVersion: z.number(),
      statusChangedAt: z.string(),
      start: z.string(),
      end: z.string(),
      actor: z.string(),
      payload: z.record(z.string(), z.json()),
      createdAt: z.string(),
      updatedAt: z.string(),
    })
    .loose()
    .meta({ ref: 'EnergyRecord' }),
  meta = z.object({
    page: z.number(),
    pageSize: z.number(),
    total: z.number(),
  }),
  page = z.object({
    data: z.array(record),
    meta,
    restricted: z.boolean().optional(),
  }),
  detail = record.extend({
    allowedActions: z.array(z.string()),
    assignments: page,
    readings: page,
    bills: page,
    audit: page,
  }),
  preview = z.object({ previewHash: z.string().nullable() }).loose(),
  bill = z
    .object({
      id: z.string(),
      number: z.string(),
      contractId: z.string(),
      status: z.string(),
      amountCents: money,
      remainingCents: money,
    })
    .loose(),
  billingPreview = z
    .object({
      canGenerate: z.boolean(),
      requiresZeroEvidence: z.boolean(),
      previewHash: z.string().nullable(),
      amountCents: money,
      lines: z.array(
        z
          .object({
            feeType: z.string(),
            assetId: z.string(),
            meterCode: z.string(),
            start: z.string(),
            end: z.string(),
            amountCents: money,
            payload: z.record(z.string(), z.json()),
          })
          .loose(),
      ),
    })
    .loose();
const describe = (name: string, schema: z.ZodType, list = false) =>
  describeRoute({
    tags: ['Energy metering'],
    operationId: 'energy' + name,
    summary: 'Energy metering ' + name,
    responses: {
      200: list ? listResponse(schema) : dataResponse(schema),
      ...apiErrorResponses,
      400: apiErrorResponse(400, 'Invalid input or lifecycle precondition'),
      403: apiErrorResponse(403, 'Action forbidden'),
      404: apiErrorResponse(404, 'Unavailable or outside scope'),
      409: apiErrorResponse(409, 'Source, version or request conflict'),
    },
  });
const pages = z
  .record(z.string(), z.string())
  .default({})
  .superRefine((values, ctx) => {
    for (const [key, value] of Object.entries(values)) {
      if (
        ['assignments', 'readings', 'bills', 'audit'].includes(key) &&
        !/^[1-9]\d{0,7}$/.test(value)
      )
        ctx.addIssue({ code: 'custom', path: [key], message: 'Invalid page' });
      if (
        key.endsWith('Order') &&
        !/^-?(updatedAt|createdAt|start|end|usageKey|version|number|amountCents|current|multiplier|openingReading|closingReading|installedOn|latestReading|latestReadingEnd)$/.test(
          value,
        )
      )
        ctx.addIssue({ code: 'custom', path: [key], message: 'Invalid order' });
    }
  });
export default defineApiRoutes<Application>((app) => {
  const service = new EnergyService(app.container.resolve(hylToken)),
    router = new Hono<AuthEnv & AuthorizationEnv>(),
    auth = app.container.resolve(authenticationToken),
    authz = app.container.resolve(authorizationToken),
    access = (c: Context<AuthEnv & AuthorizationEnv>) => ({
      actor: String(c.get('auth')?.user.id),
      authorization: c.get('authz'),
    });
  router.onError(apiErrorHandler);
  for (const path of [
    '/energyMeters',
    '/energyMeters/:id',
    '/energyMeters/:id/*',
    '/energyReadings',
    '/energyReadings/:id',
    '/energyReadings/:id/*',
    '/energyBillingSources',
    '/energyAssignments',
    '/energyLegacyMeters',
    '/energyBilling',
    '/energyBilling/preview',
  ])
    router.use(path, auth.required(), authz.middleware());
  router.get(
    '/energyLegacyMeters',
    describe(
      'LegacyCandidates',
      z.object({
        id: z.string(),
        meterCode: z.string(),
        assetId: z.string(),
        feeType: z.string(),
        start: z.string(),
        openingReading: z.string(),
        multiplier: z.string(),
        configVersion: z.number(),
        lastBillNumber: z.string(),
        lastBillEnd: z.string(),
        draftCount: z.number(),
        historyTotal: z.number(),
        history: z.array(
          z.object({
            id: z.string(),
            billNumber: z.string(),
            start: z.string(),
            end: z.string(),
            current: z.unknown(),
            amountCents: z.string(),
            status: z.string(),
          }),
        ),
      }),
      true,
    ),
    apiValidator('query', listInput.extend({ contractId: z.uuid() })),
    async (c) =>
      c.json(await service.legacyCandidates(access(c), c.req.valid('query'))),
  );
  for (const [path, kind] of [
    ['energyMeters', 'meters'],
    ['energyAssignments', 'assignments'],
    ['energyReadings', 'readings'],
    ['energyBillingSources', 'billing'],
  ] as const)
    router.get(
      '/' + path,
      describe('List' + kind, record, true),
      apiValidator('query', listInput),
      async (c) =>
        c.json(await service.list(access(c), kind, c.req.valid('query'))),
    );
  for (const [path, kind] of [
    ['energyMeters', 'meters'],
    ['energyReadings', 'readings'],
  ] as const)
    router.get(
      '/' + path + '/:id',
      describe('Get' + kind, detail),
      apiValidator('param', id),
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
  router.post(
    '/energyMeters',
    describe('CreateMeter', record),
    apiValidator('json', meterValues.extend(operation.shape).strict()),
    async (c) => {
      const b = c.req.valid('json'),
        {
          requestId,
          expectedVersion,
          previewHash,
          reason,
          expectedMeterVersion,
          ...v
        } = b;
      return c.json({
        data: await service.createMeter(access(c), v, {
          requestId,
          expectedVersion,
          previewHash,
          reason,
          expectedMeterVersion,
        }),
      });
    },
  );
  router.patch(
    '/energyMeters/:id',
    describe('EditMeter', record),
    apiValidator('param', id),
    apiValidator(
      'json',
      z.object({ values: meterValues, ...operation.shape }).strict(),
    ),
    async (c) =>
      c.json({
        data: await service.editMeter(
          access(c),
          c.req.valid('param').id,
          c.req.valid('json').values,
          c.req.valid('json'),
        ),
      }),
  );
  for (const [suffix, write] of [
    ['previewAssignment', false],
    ['assignments', true],
  ] as const)
    router.post(
      '/energyMeters/:id/' + suffix,
      describe(suffix, write ? record : preview),
      apiValidator('param', id),
      apiValidator(
        'json',
        z.object({ values: assignmentValues, ...operation.shape }).strict(),
      ),
      async (c) =>
        c.json({
          data: await service.assign(
            access(c),
            c.req.valid('param').id,
            c.req.valid('json').values,
            c.req.valid('json'),
            write,
          ),
        }),
    );
  for (const [suffix, write] of [
    ['previewHandover', false],
    ['handover', true],
  ] as const)
    router.post(
      '/energyMeters/:id/' + suffix,
      describe(suffix, preview),
      apiValidator('param', id),
      apiValidator(
        'json',
        z.object({ values: handoverValues, ...operation.shape }).strict(),
      ),
      async (c) =>
        c.json({
          data: await service.handover(
            access(c),
            c.req.valid('param').id,
            c.req.valid('json').values,
            c.req.valid('json'),
            write,
          ),
        }),
    );
  for (const [suffix, write] of [
    ['previewStop', false],
    ['stop', true],
  ] as const)
    router.post(
      '/energyMeters/:id/' + suffix,
      describe(suffix, write ? record : preview),
      apiValidator('param', id),
      apiValidator(
        'json',
        z.object({ values: stopValues, ...operation.shape }).strict(),
      ),
      async (c) =>
        c.json({
          data: await service.stop(
            access(c),
            c.req.valid('param').id,
            c.req.valid('json').values,
            c.req.valid('json'),
            write,
          ),
        }),
    );
  for (const [suffix, write] of [
    ['previewAdoption', false],
    ['adopt', true],
  ] as const)
    router.post(
      '/energyMeters/' + suffix,
      describe(suffix, write ? record : preview),
      apiValidator(
        'json',
        z.object({ values: adoptValues, ...operation.shape }).strict(),
      ),
      async (c) =>
        c.json({
          data: await service.adopt(
            access(c),
            c.req.valid('json').values,
            c.req.valid('json'),
            write,
          ),
        }),
    );
  router.post(
    '/energyReadings',
    describe('CreateReading', record),
    apiValidator(
      'json',
      z.object({ values: readingValues, ...operation.shape }).strict(),
    ),
    async (c) =>
      c.json({
        data: await service.saveReading(
          access(c),
          c.req.valid('json').values,
          c.req.valid('json'),
        ),
      }),
  );
  router.patch(
    '/energyReadings/:id',
    describe('EditReading', record),
    apiValidator('param', id),
    apiValidator(
      'json',
      z.object({ values: readingValues, ...operation.shape }).strict(),
    ),
    async (c) =>
      c.json({
        data: await service.saveReading(
          access(c),
          c.req.valid('json').values,
          c.req.valid('json'),
          c.req.valid('param').id,
        ),
      }),
  );
  router.post(
    '/energyReadings/:id/:action',
    describe('ReadingAction', record),
    apiValidator(
      'param',
      id.extend({ action: z.enum(['submit', 'approve', 'reject', 'void']) }),
    ),
    apiValidator(
      'json',
      operation.extend({ values: readingValues.optional() }).strict(),
    ),
    async (c) =>
      c.json({
        data: await service.readingAction(
          access(c),
          c.req.valid('param').id,
          c.req.valid('param').action,
          c.req.valid('json'),
          c.req.valid('json').values,
        ),
      }),
  );
  for (const [path, write] of [
    ['/energyBilling/preview', false],
    ['/energyBilling', true],
  ] as const)
    router.post(
      path,
      describe(
        write ? 'Generate' : 'PreviewBill',
        write ? bill : billingPreview,
      ),
      apiValidator(
        'json',
        z.object({ values: billingValues, ...operation.shape }).strict(),
      ),
      async (c) =>
        c.json({
          data: await service.generate(
            access(c),
            c.req.valid('json').values,
            c.req.valid('json'),
            write,
          ),
        }),
    );
  return new Hono().route('/', router);
});
