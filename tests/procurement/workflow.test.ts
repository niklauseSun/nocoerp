import { authorizationToken } from '@nocobase/app-plugin-authorization';
import { definePermissionSet } from '@nocobase/authorization/permission-sets';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { procurementResource } from '../../server/procurement/resources.js';
import { assetResource } from '../../server/assets/resources.js';
// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
} from '@nocobase/app-plugin-authentication/testing';
import { createStandaloneServer } from '../../server/standalone.js';
import { today } from '../../server/inspections/calendar.js';
const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    logging: { enabled: false },
  },
});
test('procurement partial acceptance, payment, reversal, settlement and idempotency', async ({
  testApp,
  request,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  async function call(
    path: string,
    body?: unknown,
    status = 200,
  ): Promise<any> {
    const r = await admin.fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const j = (await r.json()) as any;
    if (r.status !== status)
      throw Error(path + ':' + r.status + ' ' + JSON.stringify(j));
    return j.data;
  }
  for (const p of [
    'purchaseSuppliers',
    'purchaseRequests',
    'purchaseOrders',
    'purchaseReceipts',
    'purchasePayments',
    'purchaseLedger',
    'procurementAssets',
    'procurementSummary',
  ])
    expect((await request('/' + p)).status).toBe(401);
  const project = await call(
    '/assets',
    { name: 'Purchase project', type: 'project' },
    201,
  );
  const supplier = await call('/purchaseSuppliers', {
    requestId: randomUUID(),
    values: {
      projectId: project.id,
      name: 'Demo supplier',
      contact: 'Alice',
      phone: '123',
      supplyScope: 'Repair parts',
    },
  });
  const actor = (await call('/repairAssignees'))[0];
  let repair = await call('/repairOrders', {
    requestId: randomUUID(),
    values: {
      title: 'Parts repair',
      description: 'Replace lamps',
      category: 'electrical',
      priority: 'normal',
      reporterName: 'Demo',
      reporterPhone: '0',
      assetId: project.id,
      occurredOn: today(),
    },
  });
  repair = await call('/repairOrders/' + repair.id + '/actions', {
    requestId: randomUUID(),
    expectedVersion: repair.version,
    action: 'assign',
    assigneeId: actor.id,
    dueOn: today(),
    note: 'Assigned',
  });
  repair = await call('/repairOrders/' + repair.id + '/actions', {
    requestId: randomUUID(),
    expectedVersion: repair.version,
    action: 'start',
    note: 'Started',
  });
  const create = {
    requestId: randomUUID(),
    values: {
      title: 'Parts',
      assetId: project.id,
      repairId: repair.id,
      neededOn: today(),
      reason: 'Repair',
      items: [{ name: 'Lamp', unit: 'each', quantity: 10, unitPrice: '12.50' }],
    },
  };
  let req = await call('/purchaseRequests', create);
  expect((await call('/purchaseRequests', create)).id).toBe(req.id);
  const act = async (
    kind: string,
    r: any,
    action: string,
    values = {},
    status = 200,
  ) =>
    call(
      '/purchase' + kind + '/' + r.id + '/actions',
      {
        requestId: randomUUID(),
        expectedVersion: r.version,
        action,
        ...values,
      },
      status,
    );
  req = await act('Requests', req, 'submit', { note: 'Submitted' });
  req = await act('Requests', req, 'approve', { note: 'Approved' });
  req = await act('Requests', req, 'convert', {
    supplierId: supplier.id,
    note: 'Ordered',
  });
  let order = await call('/purchaseOrders/' + req.payload.orderId);
  order = await act('Orders', order, 'issue', { note: 'Issued' });
  await act(
    'Orders',
    order,
    'pay',
    {
      amount: '1',
      day: today(),
      reference: 'No advance',
      channel: 'bank',
      evidence: 'Simulated',
    },
    400,
  );
  async function receive(quantity: number) {
    const r = await call('/purchaseReceipts', {
      requestId: randomUUID(),
      expectedOrderVersion: order.version,
      values: {
        orderId: order.id,
        day: today(),
        evidence: 'Counted',
        lines: [{ itemId: 'item-1', delivered: quantity, accepted: quantity }],
      },
    });
    let out = await act('Receipts', r, 'submit', { note: 'Check' });
    out = await act('Receipts', out, 'accept', { note: 'Accepted' });
    order = await call('/purchaseOrders/' + order.id);
    return out;
  }
  await call(
    '/repairOrders/' + repair.id + '/actions',
    {
      requestId: randomUUID(),
      expectedVersion: repair.version,
      action: 'complete',
      note: 'Blocked until parts accepted',
      evidence: 'Demo',
      cost: '0',
    },
    400,
  );
  await receive(4);
  expect(order.acceptedCents).toBe('5000');
  order = await act('Orders', order, 'pay', {
    amount: '20',
    day: today(),
    reference: 'P1',
    channel: 'bank',
    evidence: 'Simulated',
  });
  expect(order.outstandingCents).toBe('3000');
  const payment = await call(
    '/purchasePayments/' + order.payload.lastPaymentId,
  );
  await act(
    'Orders',
    order,
    'pay',
    {
      amount: '31',
      day: today(),
      reference: 'P2',
      channel: 'bank',
      evidence: 'Simulated',
    },
    400,
  );
  await receive(6);
  expect(order.acceptedCents).toBe('12500');
  repair = await call('/repairOrders/' + repair.id + '/actions', {
    requestId: randomUUID(),
    expectedVersion: repair.version,
    action: 'complete',
    note: 'Parts installed',
    evidence: 'Demo',
    cost: '0',
  });
  expect(repair.status).toBe('pendingAcceptance');
  order = await act('Orders', order, 'pay', {
    amount: '105',
    day: today(),
    reference: 'P2',
    channel: 'bank',
    evidence: 'Simulated',
  });
  order = await act('Orders', order, 'settle', { note: 'All settled' });
  expect(order.status).toBe('settled');
  await act('Payments', payment, 'reverse', {
    day: today(),
    note: 'Wrong transfer',
  });
  order = await call('/purchaseOrders/' + order.id);
  expect(order.status).toBe('issued');
  expect(order.outstandingCents).toBe('2000');
  order = await act('Orders', order, 'pay', {
    amount: '20',
    day: today(),
    reference: 'P3',
    channel: 'bank',
    evidence: 'Correction',
  });
  order = await act('Orders', order, 'settle', { note: 'Settled' });
  expect(order.paidCents).toBe('12500');
  const summary = await call('/procurementSummary');
  expect(summary).toEqual({
    acceptedCents: '12500',
    paidCents: '12500',
    outstandingCents: '0',
  });
  const ledger = await call('/purchaseLedger');
  expect(ledger).toHaveLength(6);
  await act('Orders', order, 'settle', { note: 'Again' }, 400);
  const users = testApp.application.container.resolve(
      userManagementServiceToken,
    ),
    authz = testApp.application.container.resolve(authorizationToken),
    password = randomBytes(24).toString('hex'),
    u = await users.create({
      name: 'Purchase reader',
      email: randomUUID() + '@example.test',
      password,
    });
  let limited = await signIn(testApp, { email: u.email, password });
  for (const path of [
    '/purchaseSuppliers',
    '/purchaseRequests',
    '/purchaseOrders',
    '/purchaseReceipts',
    '/purchasePayments',
    '/purchaseLedger',
    '/procurementSummary',
    '/procurementAssets',
  ])
    expect((await limited.fetch(path)).status).toBe(403);
  await authz.permissionSets.create(
    definePermissionSet('purchase-reader')
      .grant(
        procurementResource
          .reference()
          .grant({ read: { assets: 'allRecords' } }),
      )
      .grant(
        assetResource.reference().grant({ read: { records: 'allRecords' } }),
      )
      .build(),
  );
  await authz.permissionSets.assign({
    permissionSet: 'purchase-reader',
    subject: { type: 'user', id: u.id },
  });
  limited = await signIn(testApp, { email: u.email, password });
  expect(
    ((await (await limited.fetch('/purchaseOrders')).json()) as any).meta.total,
  ).toBe(0);
  expect((await limited.fetch('/purchaseOrders/' + order.id)).status).toBe(403);
  expect(
    (await limited.fetch('/purchaseSuppliers/' + supplier.id)).status,
  ).toBe(200);
  expect((await limited.fetch('/purchaseLedger')).status).toBe(403);
  expect(
    (
      await limited.fetch('/purchaseSuppliers/' + supplier.id + '/actions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost',
        },
        body: JSON.stringify({
          requestId: randomUUID(),
          expectedVersion: supplier.version,
          action: 'suspend',
          note: 'Denied',
        }),
      })
    ).status,
  ).toBe(403);
  const lastPayment = await call(
    '/purchasePayments/' + order.payload.lastPaymentId,
  );
  await act('Payments', lastPayment, 'reverse', {
    day: today(),
    note: 'Concurrent correction',
  });
  order = await call('/purchaseOrders/' + order.id);
  const attempts = await Promise.all(
    ['P4', 'P5'].map((reference) =>
      admin.fetch('/purchaseOrders/' + order.id + '/actions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost',
        },
        body: JSON.stringify({
          requestId: randomUUID(),
          expectedVersion: order.version,
          action: 'pay',
          day: today(),
          amount: '20',
          reference,
          channel: 'bank',
          evidence: 'Concurrent simulated payment',
        }),
      }),
    ),
  );
  expect(attempts.map((r) => r.status).sort()).toEqual([200, 409]);
  expect((await call('/procurementSummary')).outstandingCents).toBe('0');
});
