// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
} from '@nocobase/app-plugin-authentication/testing';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { authorizationToken } from '@nocobase/app-plugin-authorization';
import { createStandaloneServer } from '../../server/standalone.js';
import { messageToken } from '../../server/providers/messages.js';
import { hylToken } from '../../server/providers/hyl.js';
import { plusDays } from '../../server/messages/sources.js';
import { today } from '../../server/inspections/calendar.js';
const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    logging: { enabled: false },
  },
});
test('personal reminders: four business domains, persistent inbox, dedupe, resolve, privacy and fencing', async ({
  testApp,
  request,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  async function call(
    path: string,
    body?: unknown,
    status = 200,
    session = admin,
    method = body ? 'POST' : 'GET',
  ): Promise<any> {
    const r = await session.fetch(path, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const j: any = await r.json();
    if (r.status !== status)
      throw Error(path + ':' + r.status + ' ' + JSON.stringify(j));
    return j.data;
  }
  for (const p of [
    'messagePreferences',
    'messageTodos',
    'messageTodos/' + randomUUID(),
  ])
    expect((await request('/' + p)).status).toBe(401);
  const original = await call('/messagePreferences');
  expect(original.enabled).toBe(false);
  expect(original).not.toHaveProperty('userId');
  expect(original).not.toHaveProperty('scanToken');
  await call('/messagePreferences', {
    expectedVersion: 0,
    values: {
      enabled: true,
      contracts: true,
      bills: true,
      repairs: true,
      purchases: true,
      contractDays: 30,
      billDays: 7,
      locale: 'zh-CN',
    },
  });
  const project = await call(
      '/assets',
      { name: 'Reminder project', type: 'project' },
      201,
    ),
    m = await call(
      '/merchants',
      {
        name: 'Reminder merchant',
        unit: 'A1',
        contact: 'Demo',
        phone: '0',
        accountName: 'Demo',
        bank: 'Demo',
        account: '0',
      },
      201,
    ),
    day = today();
  const contract = await call(
    '/contracts',
    {
      merchantId: m.id,
      title: 'Expiry reminder',
      start: plusDays(day, -10),
      end: plusDays(day, 10),
      cycle: 'month',
      method: 'fixed',
      basis: 'receipts',
      rate: '0',
      fixedFee: '0',
      minimum: '0',
      rent: '100',
      includeActivity: true,
      includeCash: true,
      includeHospitality: false,
      depositTarget: '0',
    },
    201,
  );
  await call(
    '/contracts/' + contract.id + '/billingConfig',
    {
      requestId: randomUUID(),
      expectedVersion: 0,
      effectiveFrom: plusDays(day, -10),
      rentChannel: 'bill',
      property: { enabled: false, method: 'fixed', price: '0' },
      utilities: {},
      meters: [],
    },
    200,
    admin,
    'PUT',
  );
  const bill = await call(
    '/bills',
    {
      requestId: randomUUID(),
      contractId: contract.id,
      expectedContractVersion: contract.version,
      configVersion: 1,
      month: day.slice(0, 7),
      part: 'month',
      dueDate: day,
      fees: ['rent'],
      readings: [],
      others: [],
    },
    201,
  );
  await call('/bills/' + bill.id + '/issue', {
    requestId: randomUUID(),
    expectedVersion: bill.version,
  });
  const repair = await call('/repairOrders', {
    requestId: randomUUID(),
    values: {
      title: 'Reminder repair',
      description: 'Inspect',
      category: 'electrical',
      priority: 'normal',
      reporterName: 'Demo',
      reporterPhone: '0',
      assetId: project.id,
      occurredOn: day,
    },
  });
  const purchase = await call('/purchaseRequests', {
    requestId: randomUUID(),
    values: {
      title: 'Reminder purchase',
      assetId: project.id,
      neededOn: day,
      reason: 'Demo',
      items: [{ name: 'Lamp', unit: 'each', quantity: 1, unitPrice: '10' }],
    },
  });
  await call('/purchaseRequests/' + purchase.id + '/actions', {
    requestId: randomUUID(),
    expectedVersion: purchase.version,
    action: 'submit',
    note: 'For review',
  });
  let check = await call('/messageChecks', {});
  expect(check.created).toBe(4);
  expect(check.sent).toBe(4);
  expect(check.failed).toBe(0);
  const todos = await call('/messageTodos');
  expect(new Set(todos.map((x: any) => x.kind))).toEqual(
    new Set(['contracts', 'bills', 'repairs', 'purchases']),
  );
  await vi.waitFor(
    async () =>
      expect((await call('/notificationInApp/messages')).length).toBe(4),
    { timeout: 10000 },
  );
  const inbox = await call('/notificationInApp/messages');
  expect(inbox).toHaveLength(4);
  expect(
    inbox.every(
      (x: any) =>
        !x.body.includes(m.payload.name) && !x.body.includes(contract.id),
    ),
  ).toBe(true);
  const unread = await call('/notificationInApp/messages/unreadCount');
  expect(unread.count).toBe(4);
  await call('/notificationInApp/messages/' + inbox[0].id + '/markRead', {});
  expect((await call('/notificationInApp/messages/unreadCount')).count).toBe(3);
  expect(
    (await call('/notificationInApp/messages')).find(
      (x: any) => x.id === inbox[0].id,
    ).readAt,
  ).toBeTruthy();
  await call('/notificationInApp/messages/' + inbox[0].id + '/markUnread', {});
  expect((await call('/notificationInApp/messages/unreadCount')).count).toBe(4);
  expect((await call('/messageTodos')).length).toBe(4);
  check = await call('/messageChecks', {});
  expect(check.sent).toBe(0);
  expect(check.created).toBe(0);
  const parallel = await Promise.all([
    call('/messageChecks', {}),
    call('/messageChecks', {}),
  ]);
  expect(parallel.reduce((n, r) => n + r.sent, 0)).toBe(0);
  expect((await call('/notificationInApp/messages')).length).toBe(4);
  const repaired = todos.find((x: any) => x.kind === 'repairs'),
    service = testApp.application.container.resolve(messageToken),
    hyl = testApp.application.container.resolve(hylToken);
  // Simulate plugin acceptance followed by an app crash before persisting the acknowledgement.
  await hyl.db
    .connection()
    .repository('hylMessageTodos')
    .updateMany({
      filter: { id: repaired.id },
      values: { notificationId: '' },
    });
  check = await call('/messageChecks', {});
  expect(check.sent).toBe(0);
  expect((await call('/notificationInApp/messages')).length).toBe(4);
  const row = await call('/messageTodos/' + repaired.id);
  expect(row.notificationId).toBeTruthy();
  expect(row.deliveryStatus).toBe('completed');
  await call('/messageTodos/' + repaired.id + '/retry', {}, 400);
  const snapshot = (await service.notifications.getNotification(
    row.notificationId,
  ))!;
  const statusSpy = vi
    .spyOn(service.notifications, 'getNotification')
    .mockResolvedValue({
      ...snapshot,
      status: 'unknown',
      deliveries: snapshot.deliveries.map((d) => ({
        ...d,
        status: 'unknown' as const,
      })),
    });
  expect((await call('/messageTodos/' + row.id)).canRetry).toBe(false);
  await call('/messageTodos/' + row.id + '/retry', {}, 400);
  statusSpy.mockRestore();

  // Only the assignee may process: dispatch changes the pending condition and keeps the old message as history.
  const actor = (await call('/repairAssignees'))[0];
  await call('/repairOrders/' + repair.id + '/actions', {
    requestId: randomUUID(),
    expectedVersion: repair.version,
    action: 'assign',
    assigneeId: actor.id,
    dueOn: day,
    note: 'Dispatched',
  });
  check = await call('/messageChecks', {});
  expect(check.resolved).toBe(1);
  expect((await call('/messageTodos/' + repaired.id)).status).toBe('resolved');
  const users = testApp.application.container.resolve(
      userManagementServiceToken,
    ),
    password = randomBytes(24).toString('hex'),
    u = await users.create({
      name: 'No permissions',
      email: randomUUID() + '@example.test',
      password,
    }),
    limited = await signIn(testApp, { email: u.email, password });
  expect(await call('/messageTodos', undefined, 200, limited)).toEqual([]);
  await call('/messageTodos/' + row.id, undefined, 404, limited);
  await call('/messageTodos/' + row.id + '/retry', {}, 404, limited);
  expect(
    (
      await call(
        '/notificationInApp/messages/unreadCount',
        undefined,
        200,
        limited,
      )
    ).count,
  ).toBe(0);
  const stolen = await limited.fetch(
    '/notificationInApp/messages/' + inbox[0].id + '/markRead',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: '{}',
    },
  );
  expect(stolen.status).toBe(404);
  await call(
    '/messagePreferences',
    {
      expectedVersion: 0,
      values: {
        enabled: true,
        contracts: true,
        bills: true,
        repairs: true,
        purchases: true,
        contractDays: 30,
        billDays: 7,
        locale: 'en-US',
      },
    },
    200,
    limited,
  );
  expect((await call('/messageChecks', {}, 200, limited)).created).toBe(0);
  // Lease excludes concurrent settings writes / checks and rejects an expired worker's commit.
  const adminId = (await hyl.db
    .connection()
    .repository<{ userId: string }>('hylMessageTodos')
    .findOne({ filter: { id: row.id } }))!.userId;
  const authz = testApp.application.container.resolve(authorizationToken),
    access = {
      actor: adminId,
      authorization: authz.for({
        principal: { type: 'user', id: adminId },
        subjects: [
          { type: 'authenticated', id: '*' },
          ...(await authz.subjects.resolveFor({ type: 'user', id: adminId })),
        ],
      }),
    };
  const failedStatus = vi
    .spyOn(service.notifications, 'getNotification')
    .mockResolvedValue({
      ...snapshot,
      status: 'failed',
      deliveries: snapshot.deliveries.map((d) => ({
        ...d,
        status: 'failed' as const,
      })),
    });
  const retryProbe = vi
    .spyOn(service.notifications, 'retryDelivery')
    .mockRejectedValue(new Error('original-delivery-probe'));
  const liveTodo = (await call('/messageTodos'))[0];
  await expect(service.retry(access, liveTodo.id)).rejects.toThrow(
    'original-delivery-probe',
  );
  expect(retryProbe).toHaveBeenCalledWith({
    deliveryId: snapshot.deliveries[0].id,
    reason: 'Recipient requested retry',
  });
  retryProbe.mockRestore();
  failedStatus.mockRestore();
  const lease = await service.acquire(access);
  expect(lease).toBeTruthy();
  expect((await call('/messageChecks', {})).busy).toBe(true);
  const prefs = await call('/messagePreferences');
  const values = { ...prefs };
  for (const k of [
    'version',
    'createdAt',
    'updatedAt',
    'lastCheckedAt',
    'lastError',
  ])
    delete values[k];
  await call(
    '/messagePreferences',
    { expectedVersion: prefs.version, values },
    409,
  );
  await hyl.db
    .connection()
    .repository('hylMessagePreferences')
    .updateMany({
      filter: { userId: adminId },
      values: { scanToken: 'new-owner', leaseUntil: '' },
    });
  await expect(service.fence(hyl.db.connection(), lease!)).rejects.toThrow();
  await hyl.db
    .connection()
    .repository('hylMessagePreferences')
    .updateMany({
      filter: { userId: adminId },
      values: { scanToken: '', leaseUntil: '' },
    });
  await call('/messagePreferences', {
    expectedVersion: prefs.version,
    values: { ...values, enabled: false },
  });
  expect(await call('/messageTodos')).toEqual([]);
  await vi.waitFor(
    async () =>
      expect((await call('/notificationInApp/messages')).length).toBe(5),
    { timeout: 10000 },
  );
  await call(
    '/messagePreferences',
    { expectedVersion: prefs.version, values },
    409,
  );
  // Restore an identical condition: same todo row, new generation and a new message exactly once.
  await call('/messagePreferences', {
    expectedVersion: prefs.version + 1,
    values,
  });
  check = await call('/messageChecks', {});
  expect(check.created).toBe(4);
  expect(
    (await call('/messageTodos')).every((x: any) => x.generation === 2),
  ).toBe(true);
  const deny = vi.spyOn(service.sources, 'inspect').mockRejectedValue(
    new (await import('@nocobase/app-server/router')).ApiError({
      status: 'PERMISSION_DENIED',
      message: 'Denied',
    }),
  );
  expect(await call('/messageTodos')).toEqual([]);
  await call('/messageTodos/' + row.id, undefined, 404);
  deny.mockRestore();
  const hostile = await admin.fetch('/messageChecks', {
    method: 'POST',
    headers: {
      origin: 'https://evil.example',
      'content-type': 'application/json',
    },
    body: '{}',
  });
  expect(hostile.status).toBe(403);
});
