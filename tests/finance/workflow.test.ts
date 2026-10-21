// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
} from '@nocobase/app-plugin-authentication/testing';
import { createStandaloneServer } from '../../server/standalone.js';
import { approvalToken } from '../../server/providers/approvals.js';
import { runFinanceDemo } from '../../cli/lib/finance-demo.js';
import { authorizationToken } from '@nocobase/app-plugin-authorization';
import { definePermissionSet } from '@nocobase/authorization/permission-sets';
import { financeResource } from '../../server/finance/resources.js';
import { resources } from '../../server/hyl/resources.js';
import { assetResource } from '../../server/assets/resources.js';
import { procurementResource } from '../../server/procurement/resources.js';
import { buildFilter } from '@nocobase/repository-input';
const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    logging: { enabled: false },
  },
});
test('cash, debt, deposits and procurement reconcile through real domain workflows; reports enforce original-source scope', async ({
  testApp,
  request,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS),
    approvals = testApp.application.container.resolve(approvalToken),
    users = approvals.hyl.users,
    authz = testApp.application.container.resolve(authorizationToken),
    initial = (
      await users.list({
        search: DEFAULT_ADMIN_CREDENTIALS.email,
        page: 1,
        pageSize: 10,
      })
    ).items[0],
    access = await approvals.accessFor(initial.id);
  expect((await request('/financialReports')).status).toBe(401);
  expect((await request('/financialReports/event/unknown')).status).toBe(401);
  const demo = await runFinanceDemo(approvals.hyl, access);
  expect(demo.summary).toMatchObject({
    receivableCents: '0',
    merchantPayableCents: '0',
    supplierPayableCents: '0',
    depositCents: '20000',
    advanceCents: '0',
    netCents: '-90000',
  });
  expect(demo.independent).toMatchObject({
    receiptNetCents: '100000',
    depositCashCents: '40000',
    settlementPaidCents: '200000',
    purchaseNetCents: '-30000',
    differenceCents: '0',
  });
  const stage = (name: string) =>
    demo.steps.find((s) => s.stage === name)!.summary;
  expect(stage('issued').receivableCents).toBe('120000');
  expect(stage('depositDeducted')).toMatchObject({
    receivableCents: '100000',
    depositCents: '30000',
  });
  expect(stage('partialCashier').receivableCents).toBe('40000');
  expect(stage('topUpWithAdvance').advanceCents).toBe('10000');
  expect(stage('refund50').advanceCents).toBe('5000');
  expect(stage('refundReversed').advanceCents).toBe('10000');
  expect(stage('merchantPartial').merchantPayableCents).toBe('120000');
  expect(stage('supplierPartial').supplierPayableCents).toBe('20000');
  expect(stage('supplierReversal').supplierPayableCents).toBe('30000');
  const response = await admin.fetch(
      '/financialReports?projectId=' + demo.projectId + '&pageSize=1',
    ),
    body: any = await response.json();
  expect(response.status).toBe(200);
  expect(body.data.items[0].partyName).toBe('财务演示供应商');
  expect(body.data.items).toHaveLength(1);
  expect(body.meta.total).toBeGreaterThan(1);
  expect(body.data.summary.netCents).toBe('-90000');
  const detail = await admin.fetch(
    '/financialReports/event/' +
      encodeURIComponent(body.data.items[0].id) +
      '?projectId=' +
      demo.projectId,
  );
  expect(detail.status).toBe(200);
  for (const query of [
    'from=2026-02-30',
    'from=2026-10-30&to=2026-10-01',
    'pageSize=500',
    'order=payload',
    'view=bogus',
    'unknown=x',
  ])
    expect((await admin.fetch('/financialReports?' + query)).status).toBe(400);
  const password = randomBytes(24).toString('hex'),
    u = await users.create({
      name: 'financial report scope test',
      email: randomUUID() + '@example.test',
      password,
    }),
    limited = await signIn(testApp, { email: u.email, password });
  expect((await limited.fetch('/financialReports')).status).toBe(403);
  const key = 'finance-' + u.id;
  const scope = {
    type: 'recordAccess' as const,
    key: 'customFilter',
    params: {
      filter: buildFilter((f) => f.string('merchantId').eq(demo.contractId)),
    },
  };
  let set = definePermissionSet(key)
    .grant(
      financeResource
        .reference()
        .grant({ read: { contracts: 'allRecords', assets: 'allRecords' } }),
    )
    .grant(assetResource.reference().grant({ read: { records: 'allRecords' } }))
    .grant(
      procurementResource
        .reference()
        .grant({ financeRead: { assets: 'allRecords' } }),
    );
  for (const kind of ['contracts', 'merchants', 'settlements'] as const)
    set = set.grant(
      resources[kind]
        .reference()
        .grant(
          kind === 'contracts'
            ? Object.fromEntries(
                [
                  'read',
                  'billingRead',
                  'receiptRead',
                  'depositRead',
                  'cashierReconcileRead',
                  'splitRead',
                ].map((a) => [a, { records: 'allRecords' }]),
              )
            : { read: { records: 'allRecords' } },
        ),
    );
  await authz.permissionSets.create(set.build());
  await authz.permissionSets.assign({
    permissionSet: key,
    subject: { type: 'user', id: u.id },
  });
  const granted = await limited.fetch(
    '/financialReports?projectId=' + demo.projectId,
  );
  expect(granted.status).toBe(200);
  expect(((await granted.json()) as any).data.summary.netCents).toBe('-90000');
  // One original action has empty contract scope: no receipt/deposit/payment/settlement/contract identity may leak.
  const restricted = definePermissionSet(key)
    .grant(
      financeResource
        .reference()
        .grant({ read: { contracts: 'allRecords', assets: 'allRecords' } }),
    )
    .grant(assetResource.reference().grant({ read: { records: 'allRecords' } }))
    .grant(
      procurementResource
        .reference()
        .grant({ financeRead: { assets: 'allRecords' } }),
    );
  let narrow = restricted;
  for (const kind of ['contracts', 'merchants', 'settlements'] as const)
    narrow = narrow.grant(
      resources[kind]
        .reference()
        .grant(
          kind === 'contracts'
            ? Object.fromEntries(
                [
                  'read',
                  'billingRead',
                  'receiptRead',
                  'depositRead',
                  'cashierReconcileRead',
                  'splitRead',
                ].map((a) => [
                  a,
                  { records: a === 'receiptRead' ? scope : 'allRecords' },
                ]),
              )
            : { read: { records: 'allRecords' } },
        ),
    );
  await authz.permissionSets.update(key, narrow.build());
  const hidden = await limited.fetch(
      '/financialReports?projectId=' + demo.projectId,
    ),
    hiddenBody: any = await hidden.json();
  expect(hidden.status).toBe(200);
  expect(hiddenBody.data.summary.depositCents).toBe('0');
  expect(hiddenBody.data.summary.netCents).toBe('-30000');
  expect(JSON.stringify(hiddenBody)).not.toContain(demo.contractId);
  expect(JSON.stringify(hiddenBody)).not.toContain('财务演示商户');
  expect(
    (
      await limited.fetch(
        '/financialReports/deposit/' +
          demo.contractId +
          '?projectId=' +
          demo.projectId,
      )
    ).status,
  ).toBe(404);
});
