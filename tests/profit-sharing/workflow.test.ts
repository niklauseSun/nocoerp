// @vitest-environment node
import { definePermissionSet } from '@nocobase/authorization';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server';
import { authorizationToken } from '@nocobase/app-plugin-authorization';
import { defineRecordAccess } from '@nocobase/authorization/core';
import { buildFilter } from '@nocobase/repository-input';
import { resources } from '../../server/hyl/resources.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
} from '@nocobase/app-plugin-authentication/testing';
import { createStandaloneServer } from '../../server/standalone.js';
import type { Row } from '../../server/hyl/schema.js';
import type {
  Bill,
  Receipt,
  ReceiptEntry,
} from '../../server/billing/model.js';
const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    logging: { enabled: false },
  },
});
test('automatic bill and operating split, corrections, recovery and single settlement payout ledger', async ({
  testApp,
  request,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  async function call<T>(
    path: string,
    body?: unknown,
    method = body ? 'POST' : 'GET',
    status = 200,
  ): Promise<T> {
    const response = await admin.fetch(path, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await response.json()) as { data: T };
    if (response.status !== status)
      throw Error(`${path} ${response.status} ${JSON.stringify(json)}`);
    return json.data;
  }
  for (const path of [
    '/cashierOrders',
    '/cashierRefunds',
    '/cashierReconciliations',
    '/cashierReconciliationPreview?day=2026-10-18',
  ])
    expect((await request(path)).status).toBe(401);
  const merchant = await call<Row>(
    '/merchants',
    {
      name: 'Cashier test',
      unit: 'C1',
      contact: 'Test',
      phone: '0',
      bank: 'test',
      accountName: 'test',
      account: '0',
    },
    'POST',
    201,
  );
  const contracts: Row[] = [],
    bills: Bill[] = [];
  for (const [i, rent] of ['2066.67', '1200'].entries()) {
    const contract = await call<Row>(
      '/contracts',
      {
        merchantId: merchant.id,
        title: 'Cashier ' + i,
        start: i === 0 ? '2026-08-17' : '2026-09-16',
        end: i === 0 ? '2026-08-31' : '2026-09-30',
        cycle: 'month',
        method: 'fixed',
        basis: 'receipts',
        rate: '0',
        fixedFee: i ? '200' : '0',
        minimum: '0',
        rent,
        depositTarget: i === 0 ? '100' : '0',
        includeActivity: true,
        includeCash: true,
        includeHospitality: false,
      },
      'POST',
      201,
    );
    contracts.push(contract);
    const previewValues = {
      enabled: true,
      effectiveFrom: String(contract.payload.start),
      billFeeTypes: ['rent'],
      recipients: [
        {
          key: randomUUID(),
          kind: 'project',
          name: 'Project',
          accountLabel: 'P',
          rate: '80',
        },
        {
          key: randomUUID(),
          kind: 'partner',
          name: 'Partner',
          accountLabel: 'Q',
          rate: '20',
        },
      ],
      notes: '',
    };
    const previewRule = await call<{
      sample: Record<string, string>;
      version: number;
    }>(`/contracts/${contract.id}/previewSplitRule`, previewValues);
    expect(Object.values(previewRule.sample).sort()).toEqual(['2000', '8000']);
    await call(
      `/contracts/${contract.id}/previewSplitRule`,
      {
        ...previewValues,
        recipients: previewValues.recipients.map((r) => ({ ...r, rate: '70' })),
      },
      'POST',
      400,
    );
    await call(
      `/contracts/${contract.id}/splitRules`,
      {
        requestId: randomUUID(),
        expectedVersion: 0,
        enabled: true,
        effectiveFrom: String(contract.payload.start),
        billFeeTypes: ['rent', 'property'],
        recipients: [
          {
            key: randomUUID(),
            kind: 'project',
            name: 'Project',
            accountLabel: 'PROJECT',
            rate: '80',
          },
          {
            key: randomUUID(),
            kind: 'partner',
            name: 'Partner',
            accountLabel: 'PARTNER',
            rate: '20',
          },
        ],
        notes: '',
      },
      'PUT',
    );
    await call(
      `/contracts/${contract.id}/billingConfig`,
      {
        requestId: randomUUID(),
        expectedVersion: 0,
        effectiveFrom: i === 0 ? '2026-08-17' : '2026-09-16',
        rentChannel: 'bill',
        property: { enabled: false, method: 'fixed', price: '0' },
        utilities: {},
        meters: [],
      },
      'PUT',
    );
    const bill = await call<Bill>(
      '/bills',
      {
        requestId: randomUUID(),
        contractId: contract.id,
        expectedContractVersion: contract.version,
        configVersion: 1,
        month: i === 0 ? '2026-08' : '2026-09',
        part: 'month',
        dueDate: i === 0 ? '2026-08-31' : '2026-09-30',
        fees: ['rent'],
        readings: [],
        others: [],
      },
      'POST',
      201,
    );
    bills.push(
      await call<Bill>(`/bills/${bill.id}/issue`, {
        requestId: randomUUID(),
        expectedVersion: bill.version,
      }),
    );
    await call(`/contracts/${contract.id}/leaseActions/terminate`, {
      requestId: randomUUID(),
      expectedVersion: 0,
      actualEnd: String(contract.payload.end),
      reason: 'test',
      handover: 'test',
      evidence: 'test',
    });
  }
  const [a, b] = contracts;
  const detail = async (id: string) => call<any>('/splitOrders/' + id);
  const orderFor = async (sourceId: string) => {
    const rows = await call<any[]>('/splitOrders?sourceId=' + sourceId);
    expect(rows).toHaveLength(1);
    return detail(rows[0].id);
  };
  async function checkout(index: number, amount: string) {
    const bill = await call<Bill>('/bills/' + bills[index].id),
      lease = await call<{ version: number }>(
        `/contracts/${contracts[index].id}/leaseSummary`,
      );
    const saved = await call<any>('/cashierOrders', {
      requestId: randomUUID(),
      merchantId: merchant.id,
      date: '2026-10-18',
      targets: [
        {
          billId: bill.id,
          contractId: bill.contractId,
          expectedBillVersion: bill.version,
          expectedLeaseVersion: lease.version,
          amount,
          deposit: '0',
        },
      ],
      payments: [
        {
          key: randomUUID(),
          method: 'bank',
          amount,
          reference: randomUUID(),
          evidence: 'test',
          splits: [{ contractId: bill.contractId, amount }],
        },
      ],
    });
    await call(`/cashierOrders/${saved.id}/post`, {
      requestId: randomUUID(),
      expectedVersion: saved.version,
      reason: 'test',
      evidence: 'test',
    });
  }
  await checkout(0, '600');
  let order = await orderFor(bills[0].id);
  expect(
    order.payload.snapshot.lines.find((r: any) => r.kind === 'partner')
      .targetCents,
  ).toBe('12000');
  await checkout(0, '400');
  order = await orderFor(bills[0].id);
  const partner = order.payload.snapshot.lines.find(
    (r: any) => r.kind === 'partner',
  );
  expect(partner.targetCents).toBe('20000');
  await call(`/splitOrders/${order.id}/review`, {
    requestId: randomUUID(),
    expectedVersion: order.version,
    sourceHash: order.sourceHash,
    evidence: 'review',
  });
  order = await detail(order.id);
  const failed = {
    requestId: randomUUID(),
    expectedVersion: order.version,
    sourceHash: order.sourceHash,
    recipientKey: partner.key,
    amount: '50',
    date: '2026-10-18',
    result: 'failed',
    failureReason: 'bank rejected',
  };
  await call(`/splitOrders/${order.id}/execute`, failed);
  expect((await detail(order.id)).netPaidCents).toBe('0');
  for (let i = 0; i < 20; i++)
    await call(`/splitOrders/${order.id}/execute`, {
      ...failed,
      requestId: randomUUID(),
      amount: String(i + 1),
    });
  const attemptsPage = await call<any>(
    `/splitOrders/${order.id}?attempts=2&attemptsOrder=amountCents`,
  );
  expect(attemptsPage.attempts.meta.total).toBe(21);
  expect(attemptsPage.attempts.data).toHaveLength(1);
  expect(attemptsPage.attempts.data[0].payload.amount).toBe('50');

  for (const amount of ['50', '150']) {
    order = await detail(order.id);
    const input = {
      requestId: randomUUID(),
      expectedVersion: order.version,
      sourceHash: order.sourceHash,
      recipientKey: partner.key,
      amount,
      date: '2026-10-18',
      result: 'success',
      reference: randomUUID(),
      evidence: 'test',
    };
    const paid = await call<any>(`/splitOrders/${order.id}/execute`, input);
    expect(await call(`/splitOrders/${order.id}/execute`, input)).toEqual(paid);
  }
  order = await detail(order.id);
  expect(order.status).toBe('completed');
  expect(order.netPaidCents).toBe('20000');
  const receipt = await call<Receipt & { entries: ReceiptEntry[] }>(
      '/receipts/' + order.payload.snapshot.sources[0].id,
    ),
    allocation = receipt.entries.find(
      (e) => e.kind === 'allocate' && !('reversed' in e && e.reversed),
    )!;
  const refund = {
    requestId: randomUUID(),
    date: '2026-10-18',
    reference: randomUUID(),
    reason: 'refund100',
    evidence: 'test',
    sources: [
      {
        receiptId: receipt.id,
        expectedVersion: receipt.version,
        amount: '100',
        method: 'bank',
        allocations: [
          {
            entryId: allocation.id,
            amount: '100',
            expectedBillVersion: (await call<Bill>('/bills/' + bills[0].id))
              .version,
          },
        ],
      },
    ],
  };
  await call('/cashierRefunds', refund);
  order = await detail(order.id);
  expect(order.recoveryCents).toBe('2000');
  expect(order.status).toBe('adjustmentPending');
  await call(`/splitOrders/${order.id}/review`, {
    requestId: randomUUID(),
    expectedVersion: order.version,
    evidence: 'review refund',
  });
  for (const amount of ['5', '15']) {
    order = await detail(order.id);
    await call(`/splitOrders/${order.id}/recover`, {
      requestId: randomUUID(),
      expectedVersion: order.version,
      recipientKey: partner.key,
      amount,
      date: '2026-10-18',
      reference: randomUUID(),
      evidence: 'received',
      reason: 'recover after refund',
    });
  }
  order = await detail(order.id);
  expect(order.netPaidCents).toBe('18000');
  expect(order.recoveryCents).toBe('0');
  expect(order.status).toBe('completed');
  await checkout(1, '600');
  for (const [kind, body] of [
    [
      'revenueReports',
      {
        merchantId: merchant.id,
        date: '2026-09-17',
        source: 'bank',
        reference: randomUUID(),
        receipts: '1000',
        refunds: '0',
        activity: '0',
        cash: '0',
        hospitality: '0',
        collected: '1000',
        evidence: 'test',
      },
    ],
    [
      'expenses',
      {
        merchantId: merchant.id,
        date: '2026-09-17',
        category: 'other',
        amount: '50',
        responsibility: 'company',
        reference: randomUUID(),
        evidence: 'test',
      },
    ],
  ] as const) {
    let r = await call<Row>('/' + kind, body, 'POST', 201);
    r = await call<Row>(`/${kind}/${r.id}/submit`, {
      expectedVersion: r.version,
    });
    await call(`/${kind}/${r.id}/approve`, { expectedVersion: r.version });
  }
  let settlement = await call<Row>(
    '/settlements',
    {
      merchantId: merchant.id,
      contractId: b.id,
      month: '2026-09',
      part: 'month',
    },
    'POST',
    201,
  );
  settlement = await call<Row>(`/settlements/${settlement.id}/review`, {
    expectedVersion: settlement.version,
  });
  settlement = await call<Row>(`/settlements/${settlement.id}/confirm`, {
    expectedVersion: settlement.version,
    confirmation: 'offline',
    confirmedBy: 'merchant',
    evidence: 'test',
  });
  let operating = await orderFor(settlement.id);
  expect(operating.payload.snapshot.remainingCents).toBe('87000');
  expect(operating.payload.snapshot.shareBaseCents).toBe('10000');
  await call(`/splitOrders/${operating.id}/review`, {
    requestId: randomUUID(),
    expectedVersion: operating.version,
    evidence: 'review',
  });
  operating = await detail(operating.id);
  const pay = {
    requestId: randomUUID(),
    expectedVersion: operating.version,
    sourceHash: operating.sourceHash,
    recipientKey: 'merchant',
    amount: '500',
    date: '2026-10-18',
    reference: randomUUID(),
    evidence: 'test',
    result: 'success',
    expectedSettlementVersion: settlement.version,
  };
  await call(`/splitOrders/${operating.id}/execute`, pay);
  settlement = await call<Row>('/settlements/' + settlement.id);
  expect(settlement.status).toBe('partial');
  await call(`/settlements/${settlement.id}/payments`, {
    expectedVersion: settlement.version,
    amount: '350',
    date: '2026-10-18',
    reference: randomUUID(),
    evidence: 'test',
  });
  operating = await detail(operating.id);
  expect(
    operating.payload.snapshot.lines.find((r: any) => r.key === 'merchant')
      .remainingCents,
  ).toBe('0');
  expect(operating.remainingCents).toBe('2000');
  expect((await call<Row>('/settlements/' + settlement.id)).status).toBe(
    'paid',
  );
  // Two writers use the same source version; exactly one may consume the remainder.
  const race = await detail(operating.id),
    recipient = race.payload.snapshot.lines.find(
      (r: any) => r.kind === 'partner',
    );
  const raceBodies = [0, 1].map(() => ({
    requestId: randomUUID(),
    expectedVersion: race.version,
    recipientKey: recipient.key,
    amount: '20',
    date: '2026-10-18',
    result: 'success',
    reference: randomUUID(),
    evidence: 'race',
  }));
  const raceStatuses = await Promise.all(
    raceBodies.map((body) =>
      admin
        .fetch(`/splitOrders/${race.id}/execute`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://localhost',
          },
          body: JSON.stringify(body),
        })
        .then((r) => r.status),
    ),
  );
  expect(raceStatuses.sort()).toEqual([200, 409]);
  expect((await detail(race.id)).remainingCents).toBe('0');
  // Stale source hashes are rejected even when the order version is current.
  const latest = await detail(race.id);
  await call(
    `/splitOrders/${race.id}/review`,
    {
      requestId: randomUUID(),
      expectedVersion: latest.version,
      sourceHash: '0'.repeat(64),
      evidence: 'wrong source',
    },
    'POST',
    409,
  );
  // Failed mutations must not alter the source or create transfer rows.
  const before = await detail(operating.id);
  await call(
    `/splitOrders/${operating.id}/execute`,
    {
      ...pay,
      requestId: randomUUID(),
      expectedVersion: before.version,
      recipientKey: partner.key,
      amount: '99999',
    },
    'POST',
    400,
  );
  expect((await detail(operating.id)).version).toBe(before.version);
  await call(
    `/splitOrders/${operating.id}/review`,
    {
      requestId: randomUUID(),
      expectedVersion: before.version - 1,
      evidence: 'stale',
    },
    'POST',
    409,
  );
  await call(
    `/splitOrders/${order.id}/cancel`,
    {
      requestId: randomUUID(),
      expectedVersion: order.version,
      evidence: 'cancel',
      reason: 'funded source must remain',
    },
    'POST',
    400,
  );
  const users = testApp.application.container.resolve(
      userManagementServiceToken,
    ),
    authz = testApp.application.container.resolve(authorizationToken),
    password = randomBytes(24).toString('hex');
  const scoped = await users.create({
    name: 'Split scoped',
    email: `${randomUUID()}@example.test`,
    password,
  });
  authz.recordAccess.define(
    defineRecordAccess('split.onlyA', (access) =>
      access
        .title({ key: 'split.title', ns: 'nocoerp' })
        .collections('hylContracts')
        .resolver(async () => buildFilter((f) => f.string('id').eq(a.id))),
    ),
  );
  await authz.permissionSets.create(
    definePermissionSet('split-scoped')
      .grant(
        resources.contracts.reference().grant({
          splitRead: { records: 'split.onlyA' },
          read: { records: 'split.onlyA' },
          billingRead: { records: 'split.onlyA' },
          receiptRead: { records: 'split.onlyA' },
        }),
      )
      .build(),
  );
  await authz.permissionSets.assign({
    permissionSet: 'split-scoped',
    subject: { type: 'user', id: scoped.id },
  });
  const member = await signIn(testApp, { email: scoped.email, password });
  expect((await member.fetch('/splitOrders/' + order.id)).status).toBe(200);
  expect((await member.fetch('/splitOrders/' + operating.id)).status).toBe(404);
  const visible = (await (await member.fetch('/splitOrders')).json()) as {
    data: { id: string }[];
    meta: { total: number };
  };
  expect(visible.data.map((r) => r.id)).toEqual([order.id]);
  expect(visible.meta.total).toBe(1);
  authz.recordAccess.define(
    defineRecordAccess('split.both', (access) =>
      access
        .title({ key: 'split.title', ns: 'nocoerp' })
        .collections('hylContracts')
        .resolver(async () =>
          buildFilter((f) =>
            f.or([f.string('id').eq(a.id), f.string('id').eq(b.id)]),
          ),
        ),
    ),
  );
  const viewer = await users.create({
    name: 'Read both configure A',
    email: `${randomUUID()}@example.test`,
    password,
  });
  await authz.permissionSets.create(
    definePermissionSet('split-read-both')
      .grant(
        resources.contracts.reference().grant({
          splitRead: { records: 'split.both' },
          read: { records: 'split.both' },
          splitConfigure: { records: 'split.onlyA' },
        }),
      )
      .build(),
  );
  await authz.permissionSets.assign({
    permissionSet: 'split-read-both',
    subject: { type: 'user', id: viewer.id },
  });
  const mixed = await signIn(testApp, { email: viewer.email, password });
  const ruleA = (await call<any[]>(`/splitRules?contractId=${a.id}`))[0],
    ruleB = (await call<any[]>(`/splitRules?contractId=${b.id}`))[0];
  const readableB = (await (
    await mixed.fetch('/splitRules/' + ruleB.id)
  ).json()) as { data: { allowedActions: string[] } };
  expect(readableB.data.allowedActions).toEqual([]);
  const configurableA = (await (
    await mixed.fetch('/splitRules/' + ruleA.id)
  ).json()) as { data: { allowedActions: string[] } };
  expect(configurableA.data.allowedActions).toEqual(['splitConfigure']);
  const renewalValues = {
    merchantId: merchant.id,
    title: 'Renewal split',
    start: '2026-10-01',
    end: '2026-10-31',
    cycle: 'month',
    method: 'fixed',
    basis: 'receipts',
    rate: '0',
    fixedFee: '0',
    minimum: '0',
    rent: '1200',
    depositTarget: '0',
    includeActivity: true,
    includeCash: true,
    includeHospitality: false,
  };
  const originContract = await call<Row>(
    '/contracts',
    renewalValues,
    'POST',
    201,
  );
  const originValues = {
    enabled: true,
    effectiveFrom: '2026-10-01',
    billFeeTypes: ['rent'],
    recipients: [
      {
        key: randomUUID(),
        kind: 'project',
        name: 'P',
        accountLabel: 'P',
        rate: '80',
      },
      {
        key: randomUUID(),
        kind: 'partner',
        name: 'Q',
        accountLabel: 'Q',
        rate: '20',
      },
    ],
    notes: '',
  };
  const originRule = await call<{ id: string }>(
    `/contracts/${originContract.id}/splitRules`,
    { ...originValues, requestId: randomUUID(), expectedVersion: 0 },
    'PUT',
  );
  const renewal = await call<{ successorId: string }>(
    `/contracts/${originContract.id}/leaseActions/renew`,
    {
      requestId: randomUUID(),
      expectedVersion: 0,
      amount: '0',
      reason: 'renew',
      evidence: 'test',
      values: { ...renewalValues, start: '2026-11-01', end: '2026-11-30' },
    },
  );
  const renewals = await call<{ id: string }[]>(
    `/contracts/${originContract.id}/splitRenewals`,
  );
  expect(renewals.map((r) => r.id)).toEqual([renewal.successorId]);
  const copied = await call<{ version: number }>(
    `/contracts/${renewal.successorId}/splitRules`,
    {
      ...originValues,
      copyFromRuleId: originRule.id,
      effectiveFrom: '2026-11-01',
      requestId: randomUUID(),
      expectedVersion: 0,
    },
    'PUT',
  );
  expect(copied.version).toBe(1);
  await call(
    `/contracts/${b.id}/previewSplitRule`,
    {
      ...originValues,
      copyFromRuleId: originRule.id,
      effectiveFrom: '2026-09-16',
    },
    'POST',
    400,
  );
  const deniedUser = await users.create({
    name: 'No split grants',
    email: `${randomUUID()}@example.test`,
    password,
  });
  const denied = await signIn(testApp, { email: deniedUser.email, password });
  for (const path of [
    '/splitOrders',
    '/splitRules',
    '/splitOrders/' + order.id,
  ])
    expect((await denied.fetch(path)).status).toBe(403);
  expect((await request('/splitOrders')).status).toBe(401);
});
test('all new route families authenticate before validation or lookup', async ({
  request,
}) => {
  const id = randomUUID();
  for (const [method, path] of [
    ['GET', '/splitRules'],
    ['GET', '/splitRules/' + id],
    ['GET', `/contracts/${id}/splitRules`],
    ['GET', `/contracts/${id}/splitRenewals`],
    ['PUT', `/contracts/${id}/splitRules`],
    ['POST', `/contracts/${id}/previewSplitRule`],
    ['GET', '/splitOrders'],
    ['GET', '/splitOrders/' + id],
    ['POST', '/splitOrders'],
    ['POST', '/splitOrders/preview'],
    ...['review', 'execute', 'recover', 'reverse', 'cancel'].map((action) => [
      'POST',
      `/splitOrders/${id}/${action}`,
    ]),
  ])
    expect(
      (
        await request(path, {
          method,
          headers: { 'content-type': 'application/json' },
          ...(method === 'GET' ? {} : { body: '{}' }),
        })
      ).status,
    ).toBe(401);
});
