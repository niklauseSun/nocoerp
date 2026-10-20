// @vitest-environment node
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
} from '@nocobase/app-plugin-authentication/testing';
import { authorizationToken } from '@nocobase/app-plugin-authorization';
import { definePermissionSet } from '@nocobase/authorization/permission-sets';
import { resources } from '../../server/hyl/resources.js';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { approvalToken } from '../../server/providers/approvals.js';
import { runFinanceDemo } from '../../cli/lib/finance-demo.js';
import { FinanceService } from '../../server/finance/service.js';
import { querySchema as financeQuery } from '../../server/finance/model.js';
import { dayOf } from '../../server/cashier/reports.js';
import { createStandaloneServer } from '../../server/standalone.js';
const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    logging: { enabled: false },
  },
});
test('TEST operations rejects anonymous/unauthorized access; validates imports and preserves audit rows', async ({
  testApp,
  request,
}) => {
  expect((await request('/tenantOperations')).status).toBe(401);
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS),
    password = randomBytes(24).toString('hex');
  const user = await testApp.application.container
      .resolve(userManagementServiceToken)
      .create({
        name: 'TEST no grants',
        email: 'test-operations@example.test',
        password,
      }),
    limited = await signIn(testApp, { email: user.email, password });
  const denied = await limited.fetch('/tenantOperations');
  expect(denied.status).toBe(403);
  for (const view of [
    'reporting',
    'statements',
    'arrears',
    'leases',
    'vacancy',
    'business',
    'reconciliation',
  ]) {
    const r = await admin.fetch('/tenantOperations?month=2026-10&view=' + view);
    expect(r.status).toBe(200);
  }
  const post = (path: string, body: unknown) =>
    admin.fetch(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(body),
    });
  const payload = {
    requestId: randomUUID(),
    account: 'TEST bank account',
    rows: [
      {
        externalId: 'TEST-001',
        reference: 'TEST no ledger',
        date: '2026-10-20',
        amountCents: '10000',
        method: 'bank',
      },
    ],
  };
  const previewInput = {
    text: '流水,日期,参考,收入,支出\nTEST-PREVIEW,2026-10-20,TEST-NOT-REAL,100.00,',
    mapping: {
      externalId: '流水',
      date: '日期',
      reference: '参考',
      income: '收入',
      expense: '支出',
      unit: 'yuan',
      defaultMethod: 'bank',
    },
  };
  expect(
    (
      await request('/tenantOperations/reconciliation/previewImport', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(previewInput),
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await limited.fetch('/tenantOperations/reconciliation/previewImport', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost',
        },
        body: JSON.stringify(previewInput),
      })
    ).status,
  ).toBe(403);
  const preview = await post(
    '/tenantOperations/reconciliation/previewImport',
    previewInput,
  );
  expect(preview.status).toBe(200);
  expect(
    ((await preview.json()) as { data: { rows: { amountCents: string }[] } })
      .data.rows[0].amountCents,
  ).toBe('10000');
  const first = await post('/tenantOperations/reconciliation/import', payload);
  expect(first.status).toBe(200);
  const retry = await post('/tenantOperations/reconciliation/import', payload);
  expect(retry.status).toBe(200);
  expect(
    (
      await post('/tenantOperations/reconciliation/import', {
        ...payload,
        requestId: randomUUID(),
      })
    ).status,
  ).toBe(409);
  const data = (await first.json()) as { data: { id: string }[] };
  const detail = await admin.fetch(
    '/tenantOperations/reconciliation/' + data.data[0].id,
  );
  expect(detail.status).toBe(200);
  expect(
    (await limited.fetch('/tenantOperations/reconciliation/' + data.data[0].id))
      .status,
  ).toBe(404);
  expect(
    (
      await post('/tenantOperations/reconciliation/confirm', {
        requestId: randomUUID(),
        rowId: data.data[0].id,
        eventId: 'made-up',
        reason: 'TEST invalid match',
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await admin.fetch(
        '/tenantOperations/export?month=2026-10&view=business&format=xlsx',
      )
    ).status,
  ).toBe(200);
  const approvals = testApp.application.container.resolve(approvalToken),
    users = await approvals.hyl.users.list({
      search: DEFAULT_ADMIN_CREDENTIALS.email,
      page: 1,
      pageSize: 10,
    }),
    access = await approvals.accessFor(users.items[0].id);
  await runFinanceDemo(approvals.hyl, access);
  const month = dayOf(new Date().toISOString()).slice(0, 7),
    snapshot = await new FinanceService(approvals.hyl).snapshot(
      access,
      financeQuery.parse({
        from: month + '-01',
        to:
          month +
          '-' +
          new Date(
            Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
          ).getUTCDate(),
      }),
    ),
    event = snapshot.lines.cash.find((e) => e.method === 'bank')!;
  expect(event).toBeDefined();
  const real = await post('/tenantOperations/reconciliation/import', {
    requestId: randomUUID(),
    account: 'TEST MATCH ONLY',
    rows: [
      {
        externalId: 'TEST MATCH 2',
        date: event.date,
        reference: event.reference,
        amountCents: event.amountCents,
        method: event.method,
      },
    ],
  });
  const imported = (await real.json()) as { data: { id: string }[] },
    rowId = imported.data[0].id;
  const batch = {
    requestId: randomUUID(),
    items: [{ rowId, eventId: event.id }],
    reason: 'TEST exact original ledger match',
  };
  const bulk = await post(
    '/tenantOperations/reconciliation/confirmBatch',
    batch,
  );
  expect(bulk.status).toBe(200);
  expect(
    ((await bulk.json()) as { data: { status: string }[] }).data[0].status,
  ).toBe('matched');
  const repeatedBulk = await post(
    '/tenantOperations/reconciliation/confirmBatch',
    batch,
  );
  expect(repeatedBulk.status).toBe(200);
  expect(
    ((await repeatedBulk.json()) as { data: { status: string }[] }).data[0]
      .status,
  ).toBe('matched');
  const matched = await post('/tenantOperations/reconciliation/confirm', {
    requestId: randomUUID(),
    rowId,
    eventId: event.id,
    reason: 'TEST exact original ledger match',
  });
  expect(matched.status).toBe(403);
  const resolutionInput = {
    requestId: randomUUID(),
    rowId,
    conclusion: 'investigating',
    note: 'TEST已核对样例，非真实到账证明',
    nextDate: '2026-10-22',
  };
  expect(
    (await post('/tenantOperations/reconciliation/resolve', resolutionInput))
      .status,
  ).toBe(200);
  expect(
    (await post('/tenantOperations/reconciliation/resolve', resolutionInput))
      .status,
  ).toBe(200);
  expect(
    (
      await post('/tenantOperations/reconciliation/resolve', {
        ...resolutionInput,
        note: 'TEST改写历史',
      })
    ).status,
  ).toBe(409);
  const again = await admin.fetch('/tenantOperations/reconciliation/' + rowId);
  expect(
    ((await again.json()) as { data: { match: unknown } }).data.match,
  ).toBeTruthy();
  const resolutionDetail = await admin.fetch(
    '/tenantOperations/reconciliation/' + rowId,
  );
  expect(
    ((await resolutionDetail.json()) as { data: { resolutions: unknown[] } })
      .data.resolutions,
  ).toHaveLength(1);
  const statements = await admin.fetch(
      '/tenantOperations?view=statements&month=' + month,
    ),
    list = (await statements.json()) as { data: { items: { id: string }[] } };
  expect(list.data.items.length).toBeGreaterThan(0);
  for (const format of ['xlsx', 'pdf']) {
    const exported = await admin.fetch(
      '/tenantOperations/statements/' +
        list.data.items[0].id +
        '/export?format=' +
        format,
    );
    expect(exported.status).toBe(200);
    expect(
      (
        await limited.fetch(
          '/tenantOperations/statements/' +
            list.data.items[0].id +
            '/export?format=' +
            format,
        )
      ).status,
    ).toBe(403);
  }
  const authz = testApp.application.container.resolve(authorizationToken);
  await authz.permissionSets.create(
    definePermissionSet('TEST-tenant-ops-own')
      .grant(
        resources.merchants
          .reference()
          .grant({ read: { records: 'hyl.ownMerchant' } }),
      )
      .grant(
        resources.contracts
          .reference()
          .grant({ read: { records: 'hyl.ownMerchant' } }),
      )
      .grant(
        resources.revenueReports.reference().grant({
          read: { records: 'hyl.ownMerchant' },
          write: { records: 'hyl.ownMerchant' },
        }),
      )
      .grant(
        resources.settlements
          .reference()
          .grant({ read: { records: 'hyl.ownMerchant' } }),
      )
      .build(),
  );
  await authz.permissionSets.assign({
    permissionSet: 'TEST-tenant-ops-own',
    subject: { type: 'user', id: user.id },
  });
  // An unrelated tenant has module grants but cannot see the DEMO tenant's totals, statement or evidence.
  const own = await limited.fetch(
    '/tenantOperations?view=reporting&month=' + month,
  );
  expect(own.status).toBe(200);
  expect(
    ((await own.json()) as { data: { items: unknown[] } }).data.items,
  ).toEqual([]);
  expect(
    (
      await limited.fetch(
        '/tenantOperations/statements/' +
          list.data.items[0].id +
          '/export?format=xlsx',
      )
    ).status,
  ).toBe(404);
  const records = await approvals.hyl.db
    .repository<{ id: string }>('hylRevenueReports')
    .findMany();
  expect(records.length).toBeGreaterThan(0);
  const reportId = records[0].id;
  expect(
    (await limited.fetch('/reportingEvidence/revenueReports/' + reportId))
      .status,
  ).toBe(404);
  const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
      'base64',
    ),
    form = new FormData();
  form.append(
    'file',
    new File([png], 'TEST-evidence.png', { type: 'image/png' }),
  );
  const uploaded = await admin.fetch(
    '/reportingFiles/uploadOne?kind=revenueReports&recordId=' + reportId,
    { method: 'POST', headers: { origin: 'http://localhost' }, body: form },
  );
  expect(uploaded.status).toBe(201);
  const files = await admin.fetch(
      '/reportingEvidence/revenueReports/' + reportId,
    ),
    fileList = (await files.json()) as {
      data: { id: string; contentUrl: string }[];
    };
  expect(fileList.data).toHaveLength(1);
  const content = 'http://localhost' + fileList.data[0].contentUrl;
  expect((await admin.fetch(content)).status).toBe(200);
  expect((await request(content)).status).toBe(401);
  expect((await limited.fetch(content)).status).toBe(404);
  const note = await post('/tenantOperations/followups', {
    requestId: randomUUID(),
    kind: 'bank',
    sourceId: rowId,
    note: 'TEST差异跟进，仅测试',
    nextDate: '2026-10-22',
  });
  expect(note.status).toBe(200);
  const notes = await admin.fetch('/tenantOperations/followups/bank/' + rowId);
  expect(
    ((await notes.json()) as { data: { items: unknown[] } }).data.items,
  ).toHaveLength(1);
});
