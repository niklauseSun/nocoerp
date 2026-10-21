// @vitest-environment node
import { authorizationToken } from '@nocobase/app-plugin-authorization';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { definePermissionSet } from '@nocobase/authorization/permission-sets';
import { resources } from '../../server/hyl/resources.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
  type TestSession,
} from '@nocobase/app-plugin-authentication/testing';
import { createStandaloneServer } from '../../server/standalone.js';
import type { Row } from '../../server/hyl/schema.js';
const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    logging: { enabled: false },
    i18n: { defaultLocale: 'zh-CN' },
  },
});
async function write(
  session: TestSession,
  path: string,
  values: unknown,
  method = 'POST',
): Promise<Row> {
  const response = await session.fetch(path, {
    method,
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify(values),
  });
  const body = (await response.json()) as { data: Row; error?: unknown };
  if (response.status >= 300)
    throw new Error(`${path}: ${response.status} ${JSON.stringify(body)}`);
  return body.data;
}
test('runs merchant-to-payment workflow and rejects unsafe operations', async ({
  testApp,
  request,
}) => {
  expect((await request('/merchants')).status).toBe(401);
  expect((await request('/hylDashboard')).status).toBe(401);
  const dashboard = async (session: TestSession, month?: string) => {
    const response = await session.fetch(
      `/hylDashboard${month ? `?month=${month}` : ''}`,
    );
    expect(response.status).toBe(200);
    return (
      (await response.json()) as {
        data: {
          month: string;
          analytics: {
            previousMonth: string;
            comparison: {
              previousAmount: string;
              changeAmount: string;
              changePercent: string | null;
              previousReportCount: number;
            };
            daily: { date: string; amount: string }[];
            reportCount: number;
            rankedMerchantCount: number;
            ranking: {
              merchantId: string;
              name: string | null;
              amount: string;
              reportCount: number;
              comparison: {
                previousAmount: string;
                changeAmount: string;
                changePercent: string | null;
                previousReportCount: number;
              };
            }[];
          };
          merchants: number | null;
          revenue: string | null;
          pendingReports: number | null;
          unsettled: string | null;
          unpaid: string | null;
        };
      }
    ).data;
  };
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const merchant = await write(admin, '/merchants', {
    code: 'test-m1',
    name: '测试商户',
    unit: 'A01',
    contact: '测试',
    phone: '13000000000',
    accountName: '测试商户',
    bank: '测试银行',
    account: '123456',
    userId: '',
  });
  const users = testApp.application.container.resolve(
    userManagementServiceToken,
  );
  const authz = testApp.application.container.resolve(authorizationToken);
  const password = randomBytes(24).toString('hex');
  const member = await users.create({
    name: 'Scope test',
    email: 'scope@example.test',
    password,
  });
  const limited = await signIn(testApp, { email: member.email, password });
  expect((await limited.fetch('/merchants')).status).toBe(403);
  expect((await limited.fetch('/hylDashboard')).status).toBe(403);
  await authz.permissionSets.create(
    definePermissionSet('hyl-test-partial')
      .grant({
        resource: { type: 'page', id: 'hyl-merchants' },
        actions: [{ action: 'access' }],
      })
      .grant(
        resources.merchants
          .reference()
          .grant({ read: { records: 'allRecords' } }),
      )
      .grant(
        resources.contracts
          .reference()
          .grant({ read: { records: 'allRecords' } }),
      )
      .grant(
        resources.revenueReports.reference().grant({
          read: { records: 'allRecords' },
          write: { records: 'hyl.ownMerchant' },
        }),
      )
      .build(),
  );
  await authz.permissionSets.assign({
    permissionSet: 'hyl-test-partial',
    subject: { type: 'user', id: member.id },
  });
  let contract = await write(admin, '/contracts', {
    number: 'test-c1',
    merchantId: merchant.id,
    start: '2026-10-01',
    end: '2026-12-31',
    cycle: 'month',
    method: 'commission',
    basis: 'receipts',
    rate: '10',
    fixedFee: '0',
    minimum: '0',
    rent: '1000',
    includeActivity: true,
    includeCash: true,
    includeHospitality: false,
  });
  // Start from a fresh SQLite database: cold authorization and ownMerchant scope
  // resolution must complete before a write holds the single transaction connection.
  contract = await write(
    admin,
    `/contracts/${contract.id}`,
    { expectedVersion: contract.version, values: contract.payload },
    'PATCH',
  );
  expect(contract.version).toBe(1);
  let revenue = await write(admin, '/revenueReports', {
    merchantId: merchant.id,
    date: '2026-10-10',
    source: 'cash',
    reference: 'test-r1',
    receipts: '10000',
    refunds: '500',
    activity: '500',
    cash: '0',
    hospitality: '0',
    collected: '9500',
    evidence: '测试凭证',
  });
  const deniedCreate = await limited.fetch('/revenueReports', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify({ ...revenue.payload, reference: 'denied-foreign' }),
  });
  expect(deniedCreate.status).toBe(403);
  expect(
    await testApp.database
      .repository('hylRevenueReports')
      .count({ filter: { number: 'denied-foreign' } }),
  ).toBe(0);
  const settlementInput = {
    merchantId: merchant.id,
    contractId: contract.id,
    month: '2026-10',
    part: 'month',
  };
  const rejected = await admin.fetch('/settlements', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify(settlementInput),
  });
  expect(rejected.status).toBe(400);
  revenue = await write(admin, `/revenueReports/${revenue.id}/submit`, {
    expectedVersion: revenue.version,
  });
  expect((await dashboard(admin)).pendingReports).toBe(1);
  await write(admin, `/revenueReports/${revenue.id}/approve`, {
    expectedVersion: revenue.version,
  });
  for (const [responsibility, amount, reference] of [
    ['company', '500', 'test-e1'],
    ['merchant', '200', 'test-e2'],
  ]) {
    let expense = await write(admin, '/expenses', {
      merchantId: merchant.id,
      date: '2026-10-10',
      category: 'materials',
      amount,
      responsibility,
      reference,
      evidence: '测试费用凭证',
    });
    expense = await write(
      admin,
      `/expenses/${expense.id}`,
      {
        expectedVersion: expense.version,
        values: { ...expense.payload, evidence: '更新费用凭证' },
      },
      'PATCH',
    );
    expect(expense.payload.evidence).toBe('更新费用凭证');
    expense = await write(admin, `/expenses/${expense.id}/submit`, {
      expectedVersion: expense.version,
    });
    await write(admin, `/expenses/${expense.id}/approve`, {
      expectedVersion: expense.version,
    });
  }
  expect((await admin.fetch('/hylDashboard?month=2026-13')).status).toBe(400);
  const october = await dashboard(admin, '2026-10');
  expect(october.analytics.daily).toHaveLength(31);
  expect(october.analytics.ranking).toMatchObject([
    {
      merchantId: merchant.id,
      name: '测试商户',
      amount: '10000.00',
      reportCount: 1,
    },
  ]);
  expect(october.analytics.reportCount).toBe(1);
  expect(
    october.analytics.daily.reduce(
      (sum, day) => sum + Math.round(Number(day.amount) * 100),
      0,
    ),
  ).toBe(1000000);
  const february = await dashboard(admin, '2024-02');
  expect(february.analytics.daily).toHaveLength(29);
  expect(february.analytics.reportCount).toBe(0);
  expect(february.revenue).toBe('0.00');
  expect(february.unsettled).toBe('10000.00');
  const beforeSettlement = await dashboard(admin);
  expect(beforeSettlement).toMatchObject({
    merchants: 1,
    pendingReports: 0,
    unsettled: '10000.00',
    unpaid: '0.00',
  });
  expect(beforeSettlement.revenue).toBe(
    beforeSettlement.month === '2026-10' ? '10000.00' : '0.00',
  );
  expect((await dashboard(limited)).unpaid).toBeNull();
  const sourceList = await admin.fetch('/revenueReports?view=unsettled');
  expect(
    ((await sourceList.json()) as { meta: { total: number } }).meta.total,
  ).toBe(1);
  expect((await admin.fetch('/merchants?view=unpaid')).status).toBe(400);
  expect((await admin.fetch('/revenueReports?view=monthRevenue')).status).toBe(
    400,
  );
  expect(
    (await admin.fetch('/revenueReports?view=monthRevenue&month=2026-13'))
      .status,
  ).toBe(400);
  const monthList = await admin.fetch(
    '/revenueReports?view=monthRevenue&month=2026-10',
  );
  expect(
    ((await monthList.json()) as { meta: { total: number } }).meta.total,
  ).toBe(1);
  let settlement = await write(admin, '/settlements', settlementInput);
  const byContract = await admin.fetch(
    '/settlements?q=' + encodeURIComponent(contract.number),
  );
  expect(
    ((await byContract.json()) as { data: { id: string }[] }).data.map(
      (row) => row.id,
    ),
  ).toContain(settlement.id);
  const noMatch = await admin.fetch('/settlements?q=NO-SUCH-CONTRACT-SEARCH');
  expect(
    ((await noMatch.json()) as { meta: { total: number } }).meta.total,
  ).toBe(0);
  expect(await dashboard(admin)).toMatchObject({
    unsettled: '0.00',
    unpaid: '0.00',
  });
  expect((settlement.payload.amounts as Record<string, string>).payable).toBe(
    '7050.00',
  );
  expect(
    (
      await admin.fetch('/settlements', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost',
        },
        body: JSON.stringify(settlementInput),
      })
    ).status,
  ).toBe(409);
  settlement = await write(admin, `/settlements/${settlement.id}/review`, {
    expectedVersion: settlement.version,
  });
  settlement = await write(admin, `/settlements/${settlement.id}/confirm`, {
    expectedVersion: settlement.version,
    confirmation: 'offline',
    confirmedBy: '商户负责人',
    evidence: '线下签字单测试',
  });
  settlement = await write(admin, `/settlements/${settlement.id}/payments`, {
    expectedVersion: settlement.version,
    amount: '3000',
    date: '2026-10-20',
    reference: 'bank-test-1',
  });
  expect(settlement.status).toBe('partial');
  expect((await dashboard(admin)).unpaid).toBe('4050.00');
  const unpaidList = await admin.fetch('/settlements?view=unpaid');
  expect(
    ((await unpaidList.json()) as { meta: { total: number } }).meta.total,
  ).toBe(1);
  const overpaid = await admin.fetch(`/settlements/${settlement.id}/payments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify({
      expectedVersion: settlement.version,
      amount: '5000',
      date: '2026-10-20',
      reference: 'bank-overpaid',
    }),
  });
  expect(overpaid.status).toBe(400);
  settlement = await write(admin, `/settlements/${settlement.id}/payments`, {
    expectedVersion: settlement.version,
    amount: '4050',
    date: '2026-10-21',
    reference: 'bank-test-2',
  });
  expect(settlement.status).toBe('paid');
  expect((await dashboard(admin)).unpaid).toBe('0.00');
  const late = await admin.fetch('/revenueReports', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify({ ...revenue.payload, reference: 'late-source' }),
  });
  expect(late.status).toBe(409);
  const duplicatePayment = await admin.fetch(
    `/settlements/${settlement.id}/payments`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify({
        expectedVersion: settlement.version,
        amount: '1',
        date: '2026-10-21',
        reference: 'bank-test-1',
      }),
    },
  );
  expect(duplicatePayment.status).toBe(409);

  const detail = await admin.fetch(`/settlements/${settlement.id}`);
  expect(detail.status).toBe(200);
  const result = (await detail.json()) as { data: { payments: unknown[] } };
  expect(result.data.payments).toHaveLength(2);
  const owner = await users.create({
    name: 'Merchant scope test',
    email: 'owner@example.test',
    password,
    roleScopes: { app: ['hyl-merchant'] },
  });
  const ownerSession = await signIn(testApp, { email: owner.email, password });
  expect((await ownerSession.fetch(`/merchants/${merchant.id}`)).status).toBe(
    404,
  );
  const owned = await write(admin, '/merchants', {
    ...merchant.payload,
    code: 'owned-m',
    name: '自有测试商户',
    userId: owner.id,
  });
  expect(await dashboard(ownerSession)).toMatchObject({
    merchants: 1,
    revenue: '0.00',
    unsettled: '0.00',
    unpaid: '0.00',
  });
  const ownedContract = await write(admin, '/contracts', {
    ...contract.payload,
    number: 'owned-c',
    merchantId: owned.id,
    rate: '0',
    rent: '0',
  });
  let ownedRevenue = await write(ownerSession, '/revenueReports', {
    ...revenue.payload,
    reference: 'owned-r',
    merchantId: owned.id,
    receipts: '100',
    refunds: '0',
    collected: '100',
  });
  ownedRevenue = await write(
    ownerSession,
    `/revenueReports/${ownedRevenue.id}`,
    {
      expectedVersion: ownedRevenue.version,
      values: { ...ownedRevenue.payload, evidence: '商户补充凭证' },
    },
    'PATCH',
  );
  expect(ownedRevenue.payload.evidence).toBe('商户补充凭证');
  ownedRevenue = await write(
    ownerSession,
    `/revenueReports/${ownedRevenue.id}/submit`,
    { expectedVersion: ownedRevenue.version },
  );
  const forbiddenReview = await ownerSession.fetch(
    `/revenueReports/${ownedRevenue.id}/approve`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify({ expectedVersion: ownedRevenue.version }),
    },
  );
  expect(forbiddenReview.status).toBe(403);
  await write(admin, `/revenueReports/${ownedRevenue.id}/approve`, {
    expectedVersion: ownedRevenue.version,
  });
  expect((await dashboard(ownerSession)).unsettled).toBe('600.00');
  const generateOwned = () =>
    admin.fetch('/settlements', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify({
        ...settlementInput,
        merchantId: owned.id,
        contractId: ownedContract.id,
      }),
    });
  const concurrent = await Promise.all([generateOwned(), generateOwned()]);
  expect(concurrent.map((r) => r.status).sort()).toEqual([201, 409]);
  let ownedSettlement = (
    (await concurrent.find((r) => r.status === 201)!.json()) as { data: Row }
  ).data;
  ownedSettlement = await write(
    admin,
    `/settlements/${ownedSettlement.id}/review`,
    { expectedVersion: ownedSettlement.version },
  );
  ownedSettlement = await write(
    ownerSession,
    `/settlements/${ownedSettlement.id}/dispute`,
    { expectedVersion: ownedSettlement.version, reason: '核对凭证' },
  );
  expect(ownedSettlement.status).toBe('disputed');
  await write(admin, `/settlements/${ownedSettlement.id}/cancel`, {
    expectedVersion: ownedSettlement.version,
    reason: '核对后重新生成',
  });
  ownedSettlement = ((await (await generateOwned()).json()) as { data: Row })
    .data;
  ownedSettlement = await write(
    admin,
    `/settlements/${ownedSettlement.id}/review`,
    { expectedVersion: ownedSettlement.version },
  );
  ownedSettlement = await write(
    ownerSession,
    `/settlements/${ownedSettlement.id}/confirm`,
    { expectedVersion: ownedSettlement.version, confirmation: 'online' },
  );
  expect(ownedSettlement.status).toBe('payable');
  const concurrentPayments = await Promise.all(
    ['parallel-a', 'parallel-b'].map((reference) =>
      admin.fetch(`/settlements/${ownedSettlement.id}/payments`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost',
        },
        body: JSON.stringify({
          expectedVersion: ownedSettlement.version,
          amount: '60',
          date: '2026-10-21',
          reference,
        }),
      }),
    ),
  );
  expect(concurrentPayments.map((r) => r.status).sort()).toEqual([200, 409]);
  const ownerList = await ownerSession.fetch('/merchants');
  expect(
    ((await ownerList.json()) as { meta: { total: number } }).meta.total,
  ).toBe(1);
  await testApp.database.repository<Row>('hylRevenueReports').createMany({
    values: Array.from({ length: 105 }, (_, i) => ({
      ...ownedRevenue,
      id: randomUUID(),
      number: `dashboard-many-${i}`,
      status: 'approved',
      settlementId: null,
      amountCents: '1',
      payload: {
        ...ownedRevenue.payload,
        receipts: '0.01',
        refunds: '0',
        activity: '0',
        cash: '0',
        hospitality: '0',
        collected: '0.01',
      },
    })),
  });
  expect((await dashboard(ownerSession)).unsettled).toBe('1.05');
  const scopedMonth = await dashboard(
    ownerSession,
    ownedRevenue.date.slice(0, 7),
  );
  expect(scopedMonth.analytics.reportCount).toBe(106);
  expect(scopedMonth.analytics.ranking).toMatchObject([
    {
      merchantId: owned.id,
      name: '自有测试商户',
      amount: scopedMonth.revenue,
      reportCount: 106,
    },
  ]);
  expect(scopedMonth.revenue).toBe('601.05');
  const merchantSources = await ownerSession.fetch(
    `/revenueReports?view=monthRevenue&month=${scopedMonth.month}&merchantId=${owned.id}`,
  );
  expect(
    ((await merchantSources.json()) as { meta: { total: number } }).meta.total,
  ).toBe(106);
  const otherSources = await ownerSession.fetch(
    `/revenueReports?view=monthRevenue&month=${scopedMonth.month}&merchantId=${merchant.id}`,
  );
  expect(
    ((await otherSources.json()) as { meta: { total: number } }).meta.total,
  ).toBe(0);
  const allUnsettled = await ownerSession.fetch(
    '/revenueReports?view=unsettled&pageSize=100',
  );
  const many = (await allUnsettled.json()) as {
    data: Row[];
    meta: { total: number };
  };
  expect(many.meta.total).toBe(105);
  expect(many.data).toHaveLength(100);
  // Report access alone never reveals restricted merchant names.
  await authz.permissionSets.create(
    definePermissionSet('hyl-test-report-only')
      .grant(
        resources.revenueReports
          .reference()
          .grant({ read: { records: 'allRecords' } }),
      )
      .build(),
  );
  const reporter = await users.create({
    name: 'Report only',
    email: 'report-only@example.test',
    password,
  });
  await authz.permissionSets.assign({
    permissionSet: 'hyl-test-report-only',
    subject: { type: 'user', id: reporter.id },
  });
  const reportSession = await signIn(testApp, {
    email: reporter.email,
    password,
  });
  const reportOnly = await dashboard(reportSession, '2026-10');
  expect(reportOnly.merchants).toBeNull();
  expect(reportOnly.analytics.ranking.length).toBeGreaterThan(0);
  expect(reportOnly.analytics.ranking.every((row) => row.name === null)).toBe(
    true,
  );
  // More than ten merchants: aggregate all, rank deterministically, display only top ten.
  await testApp.database.repository<Row>('hylRevenueReports').createMany({
    values: Array.from({ length: 12 }, (_, i) => ({
      ...ownedRevenue,
      id: randomUUID(),
      number: `ranking-${i}`,
      merchantId: `rank-${String(i).padStart(2, '0')}`,
      date: '2024-02-29',
      status: 'approved',
      settlementId: null,
      amountCents: '1',
      payload: {
        ...ownedRevenue.payload,
        date: '2024-02-29',
        receipts: '0.01',
        refunds: '0',
        activity: '0',
        cash: '0',
        hospitality: '0',
        collected: '0.01',
      },
    })),
  });
  await testApp.database.repository<Row>('hylRevenueReports').createMany({
    values: [
      { merchantId: 'rank-00', receipts: '0.02', status: 'approved' },
      { merchantId: 'rank-01', receipts: '0.01', status: 'approved' },
      { merchantId: 'previous-only', receipts: '0.01', status: 'approved' },
      { merchantId: 'rank-00', receipts: '90.00', status: 'pending' },
    ].map((v, i) => ({
      ...ownedRevenue,
      id: randomUUID(),
      number: `prior-${i}`,
      merchantId: v.merchantId,
      date: '2024-01-31',
      status: v.status,
      settlementId: null,
      amountCents: '1',
      payload: {
        ...ownedRevenue.payload,
        date: '2024-01-31',
        receipts: v.receipts,
        refunds: '0',
        activity: '0',
        cash: '0',
        hospitality: '0',
        collected: '0',
      },
    })),
  });
  const ranked = await dashboard(admin, '2024-02');
  expect(ranked.analytics.previousMonth).toBe('2024-01');
  expect(ranked.analytics.comparison).toEqual({
    previousAmount: '0.04',
    changeAmount: '0.08',
    changePercent: '200.00',
    previousReportCount: 3,
  });
  expect(ranked.analytics.ranking[0].comparison).toMatchObject({
    previousAmount: '0.02',
    changeAmount: '-0.01',
    changePercent: '-50.00',
  });
  expect(ranked.analytics.ranking[1].comparison.changePercent).toBe('0.00');
  expect(ranked.analytics.ranking[2].comparison.changePercent).toBeNull();
  const scopedFebruary = await dashboard(ownerSession, '2024-02');
  expect(scopedFebruary.analytics.comparison).toEqual({
    previousAmount: '0.00',
    changeAmount: '0.00',
    changePercent: null,
    previousReportCount: 0,
  });
  const march = await dashboard(admin, '2024-03');
  expect(march.analytics.comparison).toMatchObject({
    previousAmount: '0.12',
    changeAmount: '-0.12',
    changePercent: '-100.00',
  });
  expect(ranked.revenue).toBe('0.12');
  expect(ranked.analytics.rankedMerchantCount).toBe(12);
  expect(ranked.analytics.ranking).toHaveLength(10);
  expect(ranked.analytics.ranking.map((row) => row.merchantId)).toEqual(
    Array.from({ length: 10 }, (_, i) => `rank-${String(i).padStart(2, '0')}`),
  );
  expect(ranked.analytics.daily[28]).toEqual({
    date: '2024-02-29',
    amount: '0.12',
  });
  const docs = await admin.fetch('/swagger');
  expect(docs.status).toBe(200);
}, 60000);
