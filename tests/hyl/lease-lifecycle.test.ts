// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
} from '@nocobase/app-plugin-authentication/testing';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { createStandaloneServer } from '../../server/standalone.js';
import type { Row } from '../../server/hyl/schema.js';
import type { Lease, Entry } from '../../server/leases/model.js';
const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    logging: { enabled: false },
  },
});
test('deposit, paired renewal, termination intersection, deductions, supplemental collection, reversal and closure', async ({
  testApp,
  request,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const post = async <T = Row>(
    path: string,
    values: unknown,
    expected = 200,
  ): Promise<T> => {
    const response = await admin.fetch(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(values),
    });
    const json = (await response.json()) as { data: T };
    if (response.status !== expected)
      throw new Error(`${path}: ${response.status} ${JSON.stringify(json)}`);
    expect(response.status).toBe(expected);
    return json.data;
  };
  const merchant = await post(
    '/merchants',
    {
      name: 'Lifecycle test',
      unit: 'Test',
      contact: 'Test',
      phone: '000',
      accountName: 'Test',
      bank: 'Test',
      account: '000',
    },
    201,
  );
  const values = {
    title: 'Lease',
    depositTarget: '1000',
    merchantId: merchant.id,
    start: '2026-09-01',
    end: '2026-09-30',
    cycle: 'month',
    method: 'fixed',
    basis: 'receipts',
    rate: '0',
    fixedFee: '0',
    minimum: '0',
    rent: '300',
    includeActivity: true,
    includeCash: true,
    includeHospitality: false,
  };
  const contract = await post('/contracts', values, 201);
  const base = `/contracts/${contract.id}`;
  expect((await request(`${base}/leaseSummary`)).status).toBe(401);
  const users = testApp.application.container.resolve(
      userManagementServiceToken,
    ),
    password = randomBytes(24).toString('hex');
  const user = await users.create({
    name: 'Denied',
    email: `${randomUUID()}@example.test`,
    password,
  });
  const denied = await signIn(testApp, { email: user.email, password });
  expect((await denied.fetch(`${base}/leaseSummary`)).status).toBe(403);
  expect(
    (
      await denied.fetch(`${base}/leaseActions/receive`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost',
        },
        body: JSON.stringify({
          requestId: randomUUID(),
          expectedVersion: 0,
          amount: '1',
        }),
      })
    ).status,
  ).toBe(403);
  type Result = { entry: Entry; lease: Lease; successorId: string };
  let version = 0;
  const act = async (
    action: string,
    body: Record<string, unknown> = {},
    expected = 200,
  ) => {
    const result = await post<Result>(
      `${base}/leaseActions/${action}`,
      {
        requestId: randomUUID(),
        expectedVersion: version,
        reason: 'Test',
        date: '2026-10-17',
        evidence: 'Test evidence',
        title: 'Independent charge',
        ...body,
      },
      expected,
    );
    if (result?.lease) version = result.lease.version;
    return result;
  };
  const receiveBody = {
    requestId: randomUUID(),
    expectedVersion: 0,
    amount: '1000',
    date: '2026-09-01',
    reference: 'receipt-1',
    evidence: 'Mock only',
  };
  const receive = await act('receive', receiveBody);
  const replay = await act('receive', receiveBody);
  expect(replay.entry.id).toBe(receive.entry.id);
  await act('receive', { ...receiveBody, amount: '1001' }, 409);
  await act(
    'refund',
    {
      amount: '1001',
      date: '2026-09-01',
      reference: 'refund-too-high',
      evidence: 'Mock',
    },
    400,
  );
  const renewed = await act('renew', {
    amount: '600',
    values: { ...values, start: '2026-10-01', end: '2026-10-31' },
  });
  expect(renewed.successorId).toBeTruthy();
  const summary = async (id = contract.id) =>
    (
      (await (await admin.fetch(`/contracts/${id}/leaseSummary`)).json()) as {
        data: { balance: string; entries: Entry[] };
      }
    ).data;
  expect((await summary()).balance).toBe('400.00');
  expect((await summary(renewed.successorId)).balance).toBe('600.00');
  const transfer = (await summary()).entries.find(
    (e) => e.kind === 'transferOut',
  )!;
  await act('reverse', { sourceId: transfer.id });
  expect((await summary()).balance).toBe('1000.00');
  expect((await summary(renewed.successorId)).balance).toBe('0.00');
  // A separate lease exercises early termination without a future renewal dependency.
  const m2 = await post(
    '/merchants',
    {
      name: 'Termination test',
      unit: 'Test',
      contact: 'Test',
      phone: '000',
      accountName: 'Test',
      bank: 'Test',
      account: '000',
    },
    201,
  );
  const c2 = await post(
    '/contracts',
    {
      ...values,
      merchantId: m2.id,
      start: '2026-08-17',
      end: '2026-08-31',
      rent: '3100',
    },
    201,
  );
  const op = async (
    action: string,
    version: number,
    body: Record<string, unknown> = {},
  ) =>
    post<Result>(`/contracts/${c2.id}/leaseActions/${action}`, {
      requestId: randomUUID(),
      expectedVersion: version,
      reason: 'Test',
      date: '2026-10-17',
      evidence: 'Test evidence',
      title: 'Independent charge',
      ...body,
    });
  await op('receive', 0, {
    amount: '500',
    date: '2026-08-17',
    reference: 'deposit',
    evidence: 'Mock',
  });
  await op('terminate', 1, {
    actualEnd: '2026-08-20',
    handover: 'Keys returned',
  });
  const settlement = await post(
    '/settlements',
    { merchantId: m2.id, contractId: c2.id, month: '2026-08', part: 'month' },
    201,
  );
  expect(settlement.payload.end).toBe('2026-08-20');
  expect((settlement.payload.amounts as Record<string, string>).rent).toBe(
    '400.00',
  );
  let bill = await post(`/settlements/${settlement.id}/review`, {
    expectedVersion: settlement.version,
  });
  bill = await post(`/settlements/${bill.id}/confirm`, {
    expectedVersion: bill.version,
    confirmation: 'offline',
    confirmedBy: 'Mock merchant',
    evidence: 'Test',
  });
  expect(bill.status).toBe('due');
  await op('deduct', 2, { amount: '250', sourceId: bill.id });
  await op('collect', 3, {
    amount: '150',
    sourceId: bill.id,
    date: '2026-08-20',
    reference: 'supplement',
    evidence: 'Mock',
  });
  await op('refund', 4, {
    amount: '250',
    date: '2026-08-20',
    reference: 'refund',
    evidence: 'Mock',
  });
  const closed = await op('closeLease', 5);
  expect(closed.lease.status).toBe('closed');
  await post(
    `/contracts/${c2.id}/leaseActions/receive`,
    { requestId: randomUUID(), expectedVersion: 6, amount: '1' },
    400,
  );
  // A legitimate later lease and its report must not prevent old financial clearance.
  await post(
    '/contracts',
    { ...values, merchantId: m2.id, start: '2026-08-21', end: '2026-08-31' },
    201,
  );
  await post(
    '/revenueReports',
    {
      merchantId: m2.id,
      date: '2026-08-21',
      source: 'cash',
      reference: randomUUID(),
      receipts: '0',
      refunds: '0',
      activity: '0',
      cash: '0',
      hospitality: '0',
      collected: '0',
      evidence: 'Later lease',
    },
    201,
  );
  await op('reopenLease', 6);
  const closedSummary = await summary(c2.id);
  expect(closedSummary.balance).toBe('0.00');
  const collect = closedSummary.entries.find((e) => e.kind === 'collect')!;
  await op('reverseCollection', 7, { sourceId: collect.id });
  const refreshed = await admin.fetch(`/contracts/${c2.id}/leaseSummary`);
  const data = (await refreshed.json()) as {
    data: { settlements: { debtRemaining: string; status: string }[] };
  };
  expect(data.data.settlements[0]?.debtRemaining).toBe('150.00');
  expect(data.data.settlements[0]?.status).toBe('due');
  await op('collect', 8, {
    sourceId: bill.id,
    amount: '150',
    date: '2026-08-20',
    reference: 'restored-collection',
    evidence: 'Test',
  });
  expect((await op('closeLease', 9)).lease.status).toBe('closed');
  const filtered = (await (
    await admin.fetch('/contracts?from=2026-08-21&to=2026-08-31')
  ).json()) as { data: Row[] };
  expect(filtered.data.some((r) => r.id === c2.id)).toBe(false);
});
