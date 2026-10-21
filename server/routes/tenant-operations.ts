import { bodyLimit } from 'hono/body-limit';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  defineApiRoutes,
  describeRoute,
  apiValidator,
  apiErrorHandler,
  apiErrorResponses,
  dataResponse,
  resolver,
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
import { TenantOperations } from '../tenant-operations/service.js';
import {
  querySchema,
  followupSchema,
  importSchema,
  matchSchema,
  pageSchema,
  followupRecordSchema,
  bankRecordSchema,
  matchRecordSchema,
  matchBatchSchema,
  resolutionSchema,
} from '../tenant-operations/model.js';
import { previewImportSchema } from '../tenant-operations/bank-import.js';
import { csv, xlsx, pdf, statementRows } from '../tenant-operations/export.js';
import { money } from '../hyl/calculation.js';
import { fail } from '../hyl/service.js';
import zh from '../locales/operations-zh-CN.js';
import en from '../locales/operations-en-US.js';
const output = z.enum(['csv', 'xlsx', 'pdf']);
const description = (id: string, schema: z.ZodType = z.unknown()) =>
  describeRoute({
    tags: ['Tenant operations'],
    operationId: id,
    summary: id,
    responses: { 200: dataResponse(schema), ...apiErrorResponses },
  });
export default defineApiRoutes<Application>((app) => {
  const r = new Hono<AuthEnv & AuthorizationEnv>(),
    s = new TenantOperations(app.container.resolve(hylToken));
  r.onError((error, c) => {
    if (
      ['23505', 'UNIQUE_CONSTRAINT'].includes(
        (error as Error & { code?: string }).code ?? '',
      ) ||
      /unique constraint|duplicate key/i.test(error.message)
    ) {
      try {
        fail('DUPLICATE_REFERENCE', 'ALREADY_EXISTS');
      } catch (mapped) {
        return apiErrorHandler(mapped, c);
      }
    }
    return apiErrorHandler(error, c);
  });
  const access = (c: Context<AuthEnv & AuthorizationEnv>) => ({
    actor: String(c.get('auth')!.user.id),
    authorization: c.get('authz'),
  });
  for (const p of [
    '/tenantOperations',
    '/tenantOperations/export',
    '/tenantOperations/statements/:id/export',
    '/tenantOperations/followups',
    '/tenantOperations/followups/:kind/:id',
    '/tenantOperations/reconciliation/import',
    '/tenantOperations/reconciliation/:id',
    '/tenantOperations/reconciliation/confirm',
    '/tenantOperations/reconciliation/previewImport',
    '/tenantOperations/reconciliation/confirmBatch',
    '/tenantOperations/reconciliation/resolve',
    '/tenantOperations/reconciliation/batchPreview',
  ])
    r.use(
      p,
      app.container.resolve(authenticationToken).required(),
      app.container.resolve(authorizationToken).middleware(),
    );
  for (const path of [
    '/tenantOperations/followups',
    '/tenantOperations/reconciliation/import',
    '/tenantOperations/reconciliation/confirm',
    '/tenantOperations/reconciliation/previewImport',
    '/tenantOperations/reconciliation/confirmBatch',
    '/tenantOperations/reconciliation/resolve',
  ])
    r.use(
      path,
      bodyLimit({
        maxSize: 2 * 1024 * 1024,
        onError: () => {
          fail('BODY_TOO_LARGE', 'INVALID_ARGUMENT');
        },
      }),
    );
  r.get(
    '/tenantOperations',
    describeRoute({
      tags: ['Tenant operations'],
      operationId: 'tenantOperations',
      summary: 'Authorized tenant operations by month and current date',
      responses: {
        200: {
          description: 'Full scoped totals and paginated items',
          content: { 'application/json': { schema: resolver(pageSchema) } },
        },
        ...apiErrorResponses,
      },
    }),
    apiValidator('query', querySchema),
    async (c) => c.json(await s.list(access(c), c.req.valid('query'))),
  );
  r.get(
    '/tenantOperations/followups/:kind/:id',
    description('tenantOperationFollowups'),
    apiValidator(
      'param',
      z.object({
        kind: z.enum(['bill', 'contracts', 'settlements', 'bank']),
        id: z.uuid(),
      }),
    ),
    async (c) => {
      const p = c.req.valid('param');
      return c.json({ data: await s.followups(access(c), p.kind, p.id) });
    },
  );
  r.post(
    '/tenantOperations/followups',
    description('tenantOperationFollowupCreate', followupRecordSchema),
    apiValidator('json', followupSchema),
    async (c) =>
      c.json({ data: await s.followup(access(c), c.req.valid('json')) }),
  );
  r.post(
    '/tenantOperations/reconciliation/import',
    description('tenantBankImport', z.array(bankRecordSchema)),
    apiValidator('json', importSchema),
    async (c) =>
      c.json({ data: await s.import(access(c), c.req.valid('json')) }),
  );
  r.post(
    '/tenantOperations/reconciliation/previewImport',
    description('tenantBankImportPreview'),
    apiValidator('json', previewImportSchema),
    async (c) =>
      c.json({ data: await s.previewImport(access(c), c.req.valid('json')) }),
  );
  r.post(
    '/tenantOperations/reconciliation/confirmBatch',
    description('tenantBankConfirmBatch'),
    apiValidator('json', matchBatchSchema),
    async (c) =>
      c.json({ data: await s.matchBatch(access(c), c.req.valid('json')) }),
  );
  r.post(
    '/tenantOperations/reconciliation/resolve',
    description('tenantBankResolution'),
    apiValidator('json', resolutionSchema),
    async (c) =>
      c.json({ data: await s.resolveBank(access(c), c.req.valid('json')) }),
  );
  r.get(
    '/tenantOperations/reconciliation/batchPreview',
    description('tenantBankBatchPreview'),
    apiValidator(
      'query',
      z.object({
        rowIds: z
          .string()
          .max(4000)
          .transform((v) => v.split(','))
          .pipe(z.array(z.uuid()).min(1).max(100)),
      }),
    ),
    async (c) => {
      const items = [];
      for (const id of c.req.valid('query').rowIds)
        items.push(await s.matchDetail(access(c), id));
      return c.json({ data: { items } });
    },
  );
  r.get(
    '/tenantOperations/reconciliation/:id',
    description('tenantBankMatch'),
    apiValidator('param', z.object({ id: z.uuid() })),
    async (c) =>
      c.json({ data: await s.matchDetail(access(c), c.req.valid('param').id) }),
  );
  r.post(
    '/tenantOperations/reconciliation/confirm',
    description('tenantBankConfirm', matchRecordSchema),
    apiValidator('json', matchSchema),
    async (c) =>
      c.json({ data: await s.match(access(c), c.req.valid('json')) }),
  );
  r.get(
    '/tenantOperations/export',
    description('tenantOperationsExport'),
    apiValidator(
      'query',
      querySchema.extend({
        format: output.default('xlsx'),
        locale: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
      }),
    ),
    async (c) => {
      const { format, locale, ...q } = c.req.valid('query'),
        data = await s.selected(access(c), q),
        labels = locale === 'zh-CN' ? zh : en;
      const rows = [
        [labels.title, data.month],
        [
          labels.name,
          labels.date,
          labels.status,
          labels.amount,
          labels.detail,
          labels.statement.fee,
        ],
        ...data.items
          .filter(
            (i) =>
              (!q.status || i.status === q.status) &&
              [i.name, i.date, i.detail]
                .join(' ')
                .toLocaleLowerCase()
                .includes(q.q.toLocaleLowerCase()),
          )
          .map((i) => [
            i.name,
            i.date,
            (q.view === 'statements'
              ? labels.statementStatuses[
                  i.status as keyof typeof labels.statementStatuses
                ]
              : labels.statuses[i.status as keyof typeof labels.statuses]) ??
              i.status,
            i.status === 'missing' ? '' : money(BigInt(i.amountCents)),
            i.detail,
            i.feeCents === undefined ? '' : money(BigInt(i.feeCents)),
          ]),
      ];
      const body =
        format === 'csv'
          ? csv(rows)
          : format === 'pdf'
            ? await pdf(rows)
            : xlsx(rows);
      return new Response(
        typeof body === 'string' ? body : new Uint8Array(body),
        {
          headers: {
            'Content-Type':
              format === 'pdf'
                ? 'application/pdf'
                : format === 'xlsx'
                  ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                  : 'text/csv;charset=utf-8',
            'Content-Disposition': `attachment; filename="operations-${data.month}.${format}"`,
            'Cache-Control': 'private, no-store',
          },
        },
      );
    },
  );
  r.get(
    '/tenantOperations/statements/:id/export',
    description('tenantStatementExport'),
    apiValidator('param', z.object({ id: z.uuid() })),
    apiValidator(
      'query',
      z.object({
        format: output.default('pdf'),
        locale: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
      }),
    ),
    async (c) => {
      const { format, locale } = c.req.valid('query'),
        d = await s.hyl.detail(
          access(c),
          'settlements',
          c.req.valid('param').id,
        ),
        labels = locale === 'zh-CN' ? zh.statement : en.statement;
      const rows = statementRows(
          d,
          d.payments.map((p) => ({ payload: p as Record<string, unknown> })),
          labels,
          d.events,
        ),
        body =
          format === 'csv'
            ? csv(rows)
            : format === 'pdf'
              ? await pdf(rows)
              : xlsx(rows);
      return new Response(
        typeof body === 'string' ? body : new Uint8Array(body),
        {
          headers: {
            'Content-Type':
              format === 'pdf'
                ? 'application/pdf'
                : format === 'xlsx'
                  ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                  : 'text/csv;charset=utf-8',
            'Content-Disposition': `attachment; filename="statement-${d.id}.${format}"`,
            'Cache-Control': 'private, no-store',
          },
        },
      );
    },
  );
  return new Hono().route('/', r);
});
