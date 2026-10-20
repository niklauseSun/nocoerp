// @vitest-environment node
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
} from '@nocobase/app-plugin-authentication/testing';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { authorizationToken } from '@nocobase/app-plugin-authorization';
import { definePermissionSet } from '@nocobase/authorization/permission-sets';
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createStandaloneServer } from '../../server/standalone.js';
import { hylToken } from '../../server/providers/hyl.js';
import { approvalToken } from '../../server/providers/approvals.js';
import { resources } from '../../server/hyl/resources.js';
import { actionSchema, type Row } from '../../server/hyl/schema.js';
import { dayOf } from '../../server/cashier/reports.js';
import { SettlementBatches } from '../../server/tenant-operations/batches.js';
import { MessageSources } from '../../server/messages/sources.js';
import { defaults } from '../../server/messages/service.js';
import type { ServiceRecord } from '../../server/tenant-operations/delivery-model.js';
const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    logging: { enabled: false },
  },
});
test('TEST P2 batches, original financial workflow, service lifecycle, source isolation and integration boundaries', async ({
  testApp,
  request,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS),
    app = testApp.application,
    hyl = app.container.resolve(hylToken),
    approvals = app.container.resolve(approvalToken);
  const users = await hyl.users.list({
      search: DEFAULT_ADMIN_CREDENTIALS.email,
      page: 1,
      pageSize: 10,
    }),
    access = await approvals.accessFor(users.items[0].id);
  const password = randomBytes(24).toString('hex'),
    tenant = await app.container.resolve(userManagementServiceToken).create({
      name: 'TEST 租户岗位',
      email: 'test-delivery-tenant@example.test',
      password,
    }),
    stranger = await app.container.resolve(userManagementServiceToken).create({
      name: 'TEST 无权限岗位',
      email: 'test-delivery-stranger@example.test',
      password,
    });
  const own = await signIn(testApp, { email: tenant.email, password }),
    other = await signIn(testApp, { email: stranger.email, password });
  const authz = app.container.resolve(authorizationToken);
  await authz.permissionSets.create(
    definePermissionSet('TEST-delivery-tenant')
      .grant(
        resources.merchants
          .reference()
          .grant({ read: { records: 'hyl.ownMerchant' } }),
      )
      .build(),
  );
  await authz.permissionSets.assign({
    permissionSet: 'TEST-delivery-tenant',
    subject: { type: 'user', id: tenant.id },
  });
  const write = async (path: string, body: unknown, session = admin) =>
    session.fetch(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(body),
    });
  const read = async <T>(r: Response) => {
    const json = (await r.json()) as { data: T; error?: unknown };
    if (r.status !== 200) throw Error(JSON.stringify(json));
    expect(r.status).toBe(200);
    return json.data;
  };
  for (const path of [
    '/tenantOperations/batches',
    '/tenantOperations/serviceRecords',
    '/tenantOperations/integrations',
  ]) {
    expect((await request(path)).status).toBe(401);
    expect((await other.fetch(path)).status).toBe(403);
  }
  for (const path of [
    '/tenantOperations/batches',
    '/tenantOperations/batches/preview',
    '/tenantOperations/batches/' + randomUUID() + '/run',
    '/tenantOperations/serviceRecords',
    '/tenantOperations/serviceRecords/' + randomUUID() + '/actions',
    '/tenantOperations/integrations/check',
  ]) {
    expect(
      (
        await request(path, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://localhost',
          },
          body: '{}',
        })
      ).status,
    ).toBe(401);
  }
  const today = dayOf(new Date().toISOString()),
    month = today.slice(0, 7);
  const merchants: Row[] = [],
    contracts: Row[] = [],
    reports: Row[] = [];
  for (let i = 0; i < 3; i++) {
    const merchant = await hyl.save(access, 'merchants', {
      name: `TEST-P2商户${i}`,
      unit: 'TEST测试铺位',
      contact: 'TEST',
      phone: '0',
      accountName: 'TEST户名',
      bank: 'TEST非真实银行',
      account: '1234567890123456',
      userId: i === 0 ? tenant.id : '',
      notes: 'TEST 非真实业务',
    });
    const contract = await hyl.save(access, 'contracts', {
      merchantId: merchant.id,
      title: `TEST-P2合同${i}`,
      start: today,
      end: today,
      cycle: 'month',
      method: 'commission',
      basis: 'receipts',
      rate: '10',
      fixedFee: '0',
      minimum: '0',
      rent: '0',
      includeActivity: true,
      includeCash: true,
      includeHospitality: false,
    });
    let report = await hyl.save(access, 'revenueReports', {
      merchantId: merchant.id,
      date: today,
      source: 'bank',
      receipts: '100',
      refunds: '0',
      collected: '100',
      activity: '0',
      cash: '0',
      hospitality: '0',
      reference: `TEST-P2-${i}`,
      evidence: 'TEST合成凭证',
      notes: 'TEST',
    });
    report = await hyl.act(
      access,
      'revenueReports',
      report.id,
      'submit',
      actionSchema.parse({ expectedVersion: report.version }),
    );
    report = await hyl.act(
      access,
      'revenueReports',
      report.id,
      'approve',
      actionSchema.parse({ expectedVersion: report.version }),
    );
    merchants.push(merchant);
    contracts.push(contract);
    reports.push(report);
  }
  const preview = await read<{ items: { id: string; canGenerate: boolean }[] }>(
    await write('/tenantOperations/batches/preview', { month, part: 'month' }),
  );
  expect(
    preview.items
      .filter((i) => contracts.some((c) => c.id === i.id))
      .every((i) => i.canGenerate),
  ).toBe(true);
  const batchInput = {
    requestId: randomUUID(),
    month,
    part: 'month',
    contractIds: contracts.map((c) => c.id),
  };
  const batch = await read<{ id: string }>(
    await write('/tenantOperations/batches', batchInput),
  );
  expect((await write('/tenantOperations/batches', batchInput)).status).toBe(
    200,
  );
  const detail = await read<{ items: { id: string; contractId: string }[] }>(
    await admin.fetch('/tenantOperations/batches/' + batch.id),
  );
  reports[1] = await hyl.act(
    access,
    'revenueReports',
    reports[1].id,
    'return',
    actionSchema.parse({
      expectedVersion: reports[1].version,
      reason: 'TEST制造失败项',
    }),
  );
  type BD = {
    status: string;
    items: {
      id: string;
      settlementId: string;
      contractId: string;
      settlementStatus: string;
      payload: { attempts: { outcome: string }[] };
    }[];
  };
  const neverAttempted = await read<BD>(
    await write('/tenantOperations/batches/' + batch.id + '/run', {
      action: 'retry',
      itemIds: detail.items.map((i) => i.id),
    }),
  );
  expect(
    neverAttempted.items.every(
      (i) => !i.settlementId && i.payload.attempts.length === 0,
    ),
  ).toBe(true);
  const generated = await read<BD>(
    await write('/tenantOperations/batches/' + batch.id + '/run', {
      action: 'generate',
      itemIds: detail.items
        .filter((i) => contracts.slice(0, 2).some((c) => c.id === i.contractId))
        .map((i) => i.id),
    }),
  );
  expect(generated.items.filter((i) => !!i.settlementId)).toHaveLength(1);
  expect(generated.status).toBe('failed');
  reports[1] = await hyl.act(
    access,
    'revenueReports',
    reports[1].id,
    'submit',
    actionSchema.parse({ expectedVersion: reports[1].version }),
  );
  reports[1] = await hyl.act(
    access,
    'revenueReports',
    reports[1].id,
    'approve',
    actionSchema.parse({ expectedVersion: reports[1].version }),
  );
  let retried = await read<BD>(
    await write('/tenantOperations/batches/' + batch.id + '/run', {
      action: 'retry',
      itemIds: detail.items.map((i) => i.id),
    }),
  );
  expect(retried.status).toBe('partial');
  expect(
    retried.items.find((i) => i.contractId === contracts[2].id)?.payload
      .attempts,
  ).toHaveLength(0);
  retried = await read<BD>(
    await write('/tenantOperations/batches/' + batch.id + '/run', {
      action: 'generate',
      itemIds: detail.items.map((i) => i.id),
    }),
  );
  expect(retried.status).toBe('completed');
  expect(
    retried.items.filter((i) => i.payload.attempts.length === 1),
  ).toHaveLength(2);
  await write('/tenantOperations/batches/' + batch.id + '/run', {
    action: 'retry',
    itemIds: detail.items.map((i) => i.id),
  });
  expect(await hyl.db.repository('hylSettlements').count()).toBe(3);
  const reviewed = await read<BD>(
    await write('/tenantOperations/batches/' + batch.id + '/run', {
      action: 'review',
      itemIds: detail.items.map((i) => i.id),
    }),
  );
  expect(
    reviewed.items.every((i) => i.settlementStatus === 'confirmation'),
  ).toBe(true);
  for (const item of reviewed.items) {
    const r = await hyl.get(access, 'settlements', item.settlementId);
    await hyl.act(
      access,
      'settlements',
      r.id,
      'confirm',
      actionSchema.parse({
        expectedVersion: r.version,
        confirmation: 'offline',
        confirmedBy: 'TEST合成商户',
        evidence: 'TEST非真实签收',
      }),
    );
  }
  const payRows = await new SettlementBatches(hyl).paymentRows(
    access,
    batch.id,
  );
  expect(
    payRows.items.every((i) => i.amountCents === '9000' && i.eligible),
  ).toBe(true);
  const settlement = await hyl.get(access, 'settlements', payRows.items[0].id);
  await hyl.act(
    access,
    'settlements',
    settlement.id,
    'pay',
    actionSchema.parse({
      expectedVersion: settlement.version,
      amount: '20',
      date: today,
      reference: 'TEST-PARTIAL-PAYOUT',
      evidence: 'TEST无真实转账',
    }),
  );
  expect(
    (await new SettlementBatches(hyl).paymentRows(access, batch.id)).items.some(
      (i) => i.amountCents === '7000',
    ),
  ).toBe(true);
  expect(
    (
      await admin.fetch(
        '/tenantOperations/batches/' + batch.id + '/paymentExport',
      )
    ).status,
  ).toBe(200);
  expect(
    (await own.fetch('/tenantOperations/batches/' + batch.id)).status,
  ).toBe(403);
  expect(
    (
      await own.fetch(
        '/tenantOperations/batches/' + batch.id + '/paymentExport',
      )
    ).status,
  ).toBe(403);
  const noticeInput = {
    requestId: randomUUID(),
    merchantId: merchants[0].id,
    type: 'notice',
    title: 'TEST公告 非真实业务',
    body: 'TEST通知正文',
    start: today,
    dueDate: today,
    notes: 'TEST',
  };
  const notice = await read<ServiceRecord>(
    await write('/tenantOperations/serviceRecords', noticeInput),
  );
  expect(
    (await own.fetch('/tenantOperations/serviceRecords/' + notice.id)).status,
  ).toBe(404);
  const act = async (
    id: string,
    action: string,
    session = admin,
    extra: Record<string, unknown> = {},
  ) => {
    const d = await read<ServiceRecord>(
      await session.fetch('/tenantOperations/serviceRecords/' + id),
    );
    return read<ServiceRecord>(
      await write(
        '/tenantOperations/serviceRecords/' + id + '/actions',
        {
          requestId: randomUUID(),
          expectedVersion: d.version,
          action,
          ...extra,
        },
        session,
      ),
    );
  };
  await act(notice.id, 'publish');
  const preferences = { ...defaults(tenant.id), enabled: true };
  const tenantAccess = await approvals.accessFor(tenant.id);
  const candidates = await new MessageSources(hyl).inspect(
    tenantAccess,
    'bills',
    'tenantService',
    notice.id,
    preferences,
  );
  expect(candidates.candidates[0].reason).toBe('tenantNotice');
  await act(notice.id, 'read', own);
  const acknowledged = await read<{ completedActions: string[] }>(
    await own.fetch('/tenantOperations/serviceRecords/' + notice.id),
  );
  expect(acknowledged.completedActions).toEqual(['read']);
  const bodySearch = await own.fetch(
    '/tenantOperations/serviceRecords?q=' + encodeURIComponent('通知正文'),
  );
  expect(
    ((await bodySearch.json()) as { data: { items: unknown[] } }).data.items,
  ).toHaveLength(1);
  expect(
    (
      await new MessageSources(hyl).inspect(
        tenantAccess,
        'bills',
        'tenantService',
        notice.id,
        preferences,
      )
    ).candidates,
  ).toHaveLength(0);
  await act(notice.id, 'withdraw');
  expect(
    (await own.fetch('/tenantOperations/serviceRecords/' + notice.id)).status,
  ).toBe(404);
  const complaint = await read<ServiceRecord>(
    await write(
      '/tenantOperations/serviceRecords',
      {
        ...noticeInput,
        requestId: randomUUID(),
        type: 'complaint',
        title: 'TEST投诉 非真实诉求',
      },
      own,
    ),
  );
  expect(complaint.status).toBe('submitted');
  expect(
    (
      await write(
        '/tenantOperations/serviceRecords',
        { ...noticeInput, requestId: randomUUID() },
        own,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await write(
        '/tenantOperations/serviceRecords',
        {
          ...noticeInput,
          requestId: randomUUID(),
          merchantId: merchants[1].id,
          type: 'complaint',
        },
        own,
      )
    ).status,
  ).toBe(404);
  await act(complaint.id, 'accept', admin, {
    text: 'TEST受理',
    dueDate: today,
  });
  const stale = await read<ServiceRecord>(
    await admin.fetch('/tenantOperations/serviceRecords/' + complaint.id),
  );
  await act(complaint.id, 'reply', admin, { text: 'TEST处理回复' });
  expect(
    (
      await write(
        '/tenantOperations/serviceRecords/' + complaint.id + '/actions',
        {
          requestId: randomUUID(),
          expectedVersion: stale.version,
          action: 'close',
          text: 'TEST过期版本',
        },
      )
    ).status,
  ).toBe(409);
  await act(complaint.id, 'close', admin, { text: 'TEST已完成' });
  await act(complaint.id, 'feedback', own, { text: 'TEST反馈', rating: 5 });
  const closed = await read<ServiceRecord & { events: unknown[] }>(
    await own.fetch('/tenantOperations/serviceRecords/' + complaint.id),
  );
  expect(closed.status).toBe('closed');
  expect(closed.payload.rating).toBe(5);
  expect(closed.events).toHaveLength(5);
  expect(
    (closed as ServiceRecord & { completedActions: string[] }).completedActions,
  ).toEqual(['feedback']);
  for (const type of ['payments', 'invoices', 'platform', 'miniapp']) {
    const checkInput = { requestId: randomUUID(), type };
    const result = await read<{
      payload: { remoteVerified: boolean; financialMutation: boolean };
    }>(await write('/tenantOperations/integrations/check', checkInput));
    expect(result.payload).toMatchObject({
      remoteVerified: false,
      financialMutation: false,
    });
    expect(
      (await write('/tenantOperations/integrations/check', checkInput)).status,
    ).toBe(200);
    expect(
      (
        await write(
          '/tenantOperations/integrations/check',
          { requestId: randomUUID(), type },
          own,
        )
      ).status,
    ).toBe(403);
  }
  expect(await hyl.db.repository('hylPayments').count()).toBe(1);
});
