import { authorizationToken } from '@nocobase/app-plugin-authorization';
import { definePermissionSet } from '@nocobase/authorization/permission-sets';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { assetResource } from '../../server/assets/resources.js';
import { repairResource } from '../../server/repairs/resources.js';
// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
} from '@nocobase/app-plugin-authentication/testing';
import { createStandaloneServer } from '../../server/standalone.js';
const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    logging: { enabled: false },
  },
});
test('repair lifecycle, linked records, rework, replay, scope and terminal protection', async ({
  testApp,
  request,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  async function call(
    path: string,
    body?: unknown,
    method = body ? 'POST' : 'GET',
    status = 200,
  ): Promise<any> {
    const r = await admin.fetch(path, {
        method,
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      json = (await r.json()) as any;
    if (r.status !== status)
      throw Error(path + ':' + r.status + ' ' + JSON.stringify(json));
    return json.data;
  }
  expect((await request('/repairOrders')).status).toBe(401);
  expect((await request('/repairAssignees')).status).toBe(401);
  const project = await call(
      '/assets',
      { name: 'Repair project', type: 'project' },
      'POST',
      201,
    ),
    street = await call(
      '/assets',
      { name: 'Repair street', type: 'street', parentId: project.id },
      'POST',
      201,
    ),
    asset = await call(
      '/assets',
      {
        name: 'Repair unit',
        type: 'unit',
        parentId: street.id,
        area: '10',
        lettableArea: '10',
      },
      'POST',
      201,
    );
  const merchant = await call(
    '/merchants',
    {
      name: 'Repair merchant',
      unit: 'E',
      contact: 'test',
      phone: '0',
      bank: 'test',
      accountName: 'test',
      account: '0',
    },
    'POST',
    201,
  );
  await call(
    '/merchants/' + merchant.id + '/assets',
    {
      requestId: randomUUID(),
      assetId: asset.id,
      start: '2026-10-01',
      end: '2026-10-31',
      area: '10',
    },
    'POST',
    201,
  );
  const contract = await call(
    '/contracts',
    {
      merchantId: merchant.id,
      title: 'Repair lease',
      assetIds: [asset.id],
      start: '2026-10-01',
      end: '2026-10-31',
      cycle: 'month',
      method: 'fixed',
      basis: 'receipts',
      rate: '0',
      fixedFee: '0',
      minimum: '0',
      rent: '0',
      depositTarget: '0',
      includeActivity: true,
      includeCash: true,
      includeHospitality: false,
    },
    'POST',
    201,
  );
  const assignees = await call('/repairAssignees');
  const assignee =
    assignees.find((u: any) => u.name === 'Super Admin') ?? assignees[0];
  const values = {
    title: '漏水修复',
    description: '水管接头持续渗水',
    category: 'plumbing',
    priority: 'high',
    reporterName: '演示报修人',
    reporterPhone: '13800000000',
    location: '水槽下',
    evidence: '现场描述',
    assetId: asset.id,
    merchantId: merchant.id,
    contractId: contract.id,
    occurredOn: '2026-10-17',
  };
  const requestId = randomUUID();
  let order = await call('/repairOrders', { requestId, values });
  expect(order.status).toBe('reported');
  expect(order.payload.assetName).toBe('Repair unit');
  expect((await call('/repairOrders', { requestId, values })).id).toBe(
    order.id,
  );
  await call(
    '/repairOrders',
    { requestId, values: { ...values, title: 'different' } },
    'POST',
    409,
  );
  await call(
    '/repairOrders',
    {
      requestId: randomUUID(),
      values: { ...values, occurredOn: '2026-09-30' },
    },
    'POST',
    400,
  );
  const act = async (
    action: string,
    data: Record<string, unknown> = {},
    status = 200,
    version = order.version,
  ) => {
    const r = await call(
      '/repairOrders/' + order.id + '/actions',
      { requestId: randomUUID(), expectedVersion: version, action, ...data },
      'POST',
      status,
    );
    if (status === 200) order = r;
    return r;
  };
  await act('complete', { note: 'No', evidence: 'No', cost: '1' }, 400);
  await act(
    'assign',
    { assigneeId: assignee.id, dueOn: '2026-10-16', note: 'invalid' },
    400,
  );
  await act(
    'assign',
    { assigneeId: 'missing', dueOn: '2026-10-18', note: 'invalid' },
    400,
  );
  const oldVersion = order.version;
  await act('assign', {
    assigneeId: assignee.id,
    dueOn: '2026-10-18',
    note: '派单',
  });
  await act('start', { note: 'stale' }, 409, oldVersion);
  await act('start', { note: '现场检查' });
  expect(order.status).toBe('processing');
  await act('progress', { note: '更换密封圈' });
  await act('complete', {
    note: '第一次处理完成',
    evidence: '记录一',
    cost: '85.50',
  });
  expect(order.status).toBe('pendingAcceptance');
  expect(order.costCents).toBe('8550');
  await act('reject', { note: '仍有渗水' });
  expect(order.status).toBe('processing');
  await act('complete', {
    note: '更换接头完成',
    evidence: '记录二',
    cost: '120.25',
  });
  const acceptRequest = {
    requestId: randomUUID(),
    expectedVersion: order.version,
    action: 'accept',
    note: '通水检查无渗漏',
  };
  order = await call('/repairOrders/' + order.id + '/actions', acceptRequest);
  const replay = await call(
    '/repairOrders/' + order.id + '/actions',
    acceptRequest,
  );
  expect(replay.version).toBe(order.version);
  await act('close', { note: '商户确认交付' });
  expect(order.status).toBe('closed');
  await act('cancel', { note: 'terminal' }, 400);
  const detail = await call('/repairOrders/' + order.id);
  expect(detail.events.meta.total).toBe(9);
  expect(detail.allowedActions).toEqual([]);
  expect(detail.events.data.some((e: any) => e.action === 'reject')).toBe(true);
  const list = await admin.fetch(
    '/repairOrders?q=' + encodeURIComponent('漏水'),
  );
  const listJson = (await list.json()) as any;
  expect(listJson.meta.total).toBe(1);
  const users = testApp.application.container.resolve(
      userManagementServiceToken,
    ),
    authz = testApp.application.container.resolve(authorizationToken),
    password = randomBytes(24).toString('hex');
  const denied = await users.create({
    name: 'Repair no role',
    email: randomUUID() + '@example.test',
    password,
  });
  const deniedSession = await signIn(testApp, {
    email: denied.email,
    password,
  });
  expect((await deniedSession.fetch('/repairOrders')).status).toBe(403);
  expect((await deniedSession.fetch('/repairOrders/' + order.id)).status).toBe(
    403,
  );
  expect((await deniedSession.fetch('/repairAssignees')).status).toBe(403);
  await authz.permissionSets.create(
    definePermissionSet('repair-asset-reader')
      .grant(
        repairResource.reference().grant({
          read: { assets: 'allRecords' },
          process: { assets: 'allRecords' },
        }),
      )
      .grant(
        assetResource.reference().grant({ read: { records: 'allRecords' } }),
      )
      .build(),
  );
  await authz.permissionSets.assign({
    permissionSet: 'repair-asset-reader',
    subject: { type: 'user', id: denied.id },
  });
  const scoped = await signIn(testApp, { email: denied.email, password });
  const hidden = (await (await scoped.fetch('/repairOrders')).json()) as any;
  expect(hidden.meta.total).toBe(0);
  expect((await scoped.fetch('/repairOrders/' + order.id)).status).toBe(403);
  let publicOrder = await call('/repairOrders', {
    requestId: randomUUID(),
    values: { ...values, merchantId: '', contractId: '' },
  });
  const publicId = publicOrder.id;
  publicOrder = await call('/repairOrders/' + publicId + '/actions', {
    requestId: randomUUID(),
    expectedVersion: publicOrder.version,
    action: 'assign',
    assigneeId: assignee.id,
    dueOn: '2026-10-18',
    note: 'public area',
  });
  expect(
    (
      await scoped.fetch('/repairOrders/' + publicId + '/actions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost',
        },
        body: JSON.stringify({
          requestId: randomUUID(),
          expectedVersion: publicOrder.version,
          action: 'start',
          note: 'wrong technician',
        }),
      })
    ).status,
  ).toBe(403);
  const candidates = await Promise.all(
    [1, 2].map(() =>
      admin.fetch('/repairOrders/' + publicId + '/actions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost',
        },
        body: JSON.stringify({
          requestId: randomUUID(),
          expectedVersion: publicOrder.version,
          action: 'cancel',
          note: 'duplicate report',
        }),
      }),
    ),
  );
  expect(candidates.map((r) => r.status).sort()).toEqual([200, 409]);
});
