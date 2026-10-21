// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
  type TestSession,
} from '@nocobase/app-plugin-authentication/testing';
import { authorizationToken } from '@nocobase/app-plugin-authorization';
import { definePermissionSet } from '@nocobase/authorization/permission-sets';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { resources } from '../../server/hyl/resources.js';
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
function api(session: TestSession) {
  return async function call<T = Row>(
    path: string,
    body?: unknown,
    status = 200,
    method = body ? 'POST' : 'GET',
  ): Promise<T> {
    const r = await session.fetch(path, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = (await r.json()) as { data: T };
    if (r.status !== status)
      throw new Error(`${path}: ${r.status} ${JSON.stringify(data)}`);
    return data.data;
  };
}
const values = {
  start: '2026-08-17',
  end: '2026-09-30',
  cycle: 'month',
  method: 'fixed',
  basis: 'receipts',
  rate: '0',
  fixedFee: '0',
  minimum: '0',
  rent: '0',
  includeActivity: true,
  includeCash: true,
  includeHospitality: false,
};
const baseInput = {
  month: '2026-08',
  part: 'month',
  dueDate: '2026-08-31',
  fees: ['rent'],
  readings: [],
  others: [],
  zeroReason: 'Zero rent',
  zeroEvidence: 'Test',
  acknowledgeGaps: false,
};
const cfg = {
  effectiveFrom: '2026-08-17',
  rentChannel: 'bill',
  property: { enabled: false, method: 'fixed', price: '0' },
  utilities: {},
  meters: [],
};
test('zero utility evidence and missing final readings control closure, no rent is withheld twice', async ({
  testApp,
}) => {
  const s = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS),
    call = api(s);
  const m = await call(
    '/merchants',
    {
      name: 'Zero meter',
      unit: 'Test',
      contact: 'T',
      phone: '0',
      accountName: 'T',
      bank: 'T',
      account: '0',
    },
    201,
  );
  const project = await call(
    '/assets',
    { name: 'P', type: 'project', area: '100', lettableArea: '100' },
    201,
  );
  const street = await call(
    '/assets',
    {
      name: 'S',
      type: 'street',
      parentId: project.id,
      area: '100',
      lettableArea: '100',
    },
    201,
  );
  const asset = await call(
    '/assets',
    {
      name: 'Stall',
      type: 'stall',
      parentId: street.id,
      area: '10',
      lettableArea: '10',
    },
    201,
  );
  const contract = await call(
      '/contracts',
      { ...values, merchantId: m.id, assetIds: [asset.id] },
      201,
    ),
    base = `/contracts/${contract.id}`;
  await call(
    `${base}/billingConfig`,
    {
      ...cfg,
      requestId: randomUUID(),
      expectedVersion: 0,
      utilities: { water: '3.5' },
      meters: [
        {
          assetId: asset.id,
          meterCode: 'W1',
          feeType: 'water',
          activeFrom: values.start,
          openingReading: '100',
          openingEvidence: 'Installed',
        },
      ],
    },
    200,
    'PUT',
  );
  await call(
    '/expenses',
    {
      merchantId: m.id,
      date: '2026-08-20',
      category: 'water',
      amount: '1',
      responsibility: 'company',
      reference: 'expense',
      evidence: 'Test',
    },
    400,
  );
  await call(`${base}/leaseActions/terminate`, {
    requestId: randomUUID(),
    expectedVersion: 0,
    actualEnd: '2026-08-31',
    reason: 'End',
    handover: 'Keys',
    evidence: 'Test',
  });
  const input = {
    ...baseInput,
    fees: ['rent', 'water'],
    readings: [
      {
        assetId: asset.id,
        meterCode: 'W1',
        feeType: 'water',
        start: '2026-08-17',
        end: '2026-08-31',
        previous: '100',
        current: '100',
        multiplier: '1',
        evidence: 'No usage',
      },
    ],
  };
  await call(
    '/bills',
    {
      ...input,
      zeroEvidence: '',
      zeroReason: '',
      contractId: contract.id,
      expectedContractVersion: contract.version,
      configVersion: 1,
      requestId: randomUUID(),
    },
    400,
  );
  await call(
    `${base}/leaseActions/closeLease`,
    {
      requestId: randomUUID(),
      expectedVersion: 1,
      reason: 'Close',
      evidence: 'Test',
    },
    400,
  );
  let bill = await call<Bill>(
    '/bills',
    {
      ...input,
      contractId: contract.id,
      expectedContractVersion: contract.version,
      configVersion: 1,
      requestId: randomUUID(),
    },
    201,
  );
  expect(bill.amountCents).toBe('0');
  bill = await call<Bill>(`/bills/${bill.id}/issue`, {
    requestId: randomUUID(),
    expectedVersion: 0,
  });
  const result = await call<{ lease: { status: string } }>(
    `${base}/leaseActions/closeLease`,
    {
      requestId: randomUUID(),
      expectedVersion: 1,
      reason: 'Close',
      evidence: 'Test',
    },
  );
  expect(result.lease.status).toBe('closed');
  await call(
    `/bills/${bill.id}/void`,
    {
      requestId: randomUUID(),
      expectedVersion: bill.version,
      reason: 'Test',
      evidence: 'Test',
    },
    400,
  );
});
test('allocation/refund reversals, atomic rollback and scoped permission isolation', async ({
  testApp,
  request,
}) => {
  const s = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS),
    call = api(s);
  const users = testApp.application.container.resolve(
      userManagementServiceToken,
    ),
    password = randomBytes(24).toString('hex');
  const u = await users.create({
    name: 'Scoped',
    email: `${randomUUID()}@example.test`,
    password,
  });
  const m = await call(
    '/merchants',
    {
      name: 'Own',
      unit: 'Test',
      contact: 'T',
      phone: '0',
      accountName: 'T',
      bank: 'T',
      account: '0',
      userId: u.id,
    },
    201,
  );
  const m2 = await call(
    '/merchants',
    {
      name: 'Other',
      unit: 'Test',
      contact: 'T',
      phone: '0',
      accountName: 'T',
      bank: 'T',
      account: '0',
    },
    201,
  );
  const c = await call(
      '/contracts',
      { ...values, merchantId: m.id, rent: '310' },
      201,
    ),
    other = await call(
      '/contracts',
      { ...values, merchantId: m2.id, rent: '310' },
      201,
    );
  for (const row of [c, other])
    await call(
      `/contracts/${row.id}/billingConfig`,
      { ...cfg, requestId: randomUUID(), expectedVersion: 0 },
      200,
      'PUT',
    );
  const create = async (row: Row) => {
    const b = await call<Bill>(
      '/bills',
      {
        ...baseInput,
        contractId: row.id,
        expectedContractVersion: row.version,
        configVersion: 1,
        requestId: randomUUID(),
      },
      201,
    );
    return call<Bill>(`/bills/${b.id}/issue`, {
      requestId: randomUUID(),
      expectedVersion: b.version,
    });
  };
  let b = await create(c);
  const b2 = await create(other);
  const settlement = await call<Row>(
    '/settlements',
    { merchantId: m.id, contractId: c.id, month: '2026-08', part: 'month' },
    201,
  );
  expect((settlement.payload.amounts as Record<string, string>).rent).toBe(
    '0.00',
  );
  expect(settlement.payload.rentChannel).toBe('bill');
  const authz = testApp.application.container.resolve(authorizationToken);
  await authz.permissionSets.create(
    definePermissionSet('bill-scoped')
      .grant(
        resources.contracts.reference().grant({
          billingRead: { records: 'hyl.ownMerchant' },
          receiptRead: { records: 'hyl.ownMerchant' },
          receiptAllocate: { records: 'hyl.ownMerchant' },
        }),
      )
      .build(),
  );
  await authz.permissionSets.assign({
    permissionSet: 'bill-scoped',
    subject: { type: 'user', id: u.id },
  });
  const member = await signIn(testApp, { email: u.email, password });
  expect((await member.fetch(`/bills/${b2.id}`)).status).toBe(404);
  expect((await member.fetch(`/bills/${b.id}`)).status).toBe(200);
  expect((await member.fetch(`/contracts/${c.id}/billingConfig`)).status).toBe(
    200,
  );
  const denied = await users.create({
    name: 'Denied',
    email: `${randomUUID()}@example.test`,
    password,
  });
  const deny = await signIn(testApp, { email: denied.email, password });
  expect((await deny.fetch('/bills')).status).toBe(403);
  expect((await deny.fetch('/receipts')).status).toBe(403);
  let r = await call<Receipt>(
    '/receipts',
    {
      requestId: randomUUID(),
      contractId: c.id,
      expectedLeaseVersion: 0,
      date: '2026-08-31',
      amount: '200',
      method: 'bank',
      reference: 'R1',
      evidence: 'Test',
    },
    201,
  );
  const endpoints: [string, string, unknown?][] = [
    ['GET', '/billingOverview'],
    ['GET', `/contracts/${c.id}/billingSummary`],
    ['GET', `/contracts/${c.id}/billingConfig`],
    [
      'PUT',
      `/contracts/${c.id}/billingConfig`,
      { ...cfg, requestId: randomUUID(), expectedVersion: 1 },
    ],
    ['POST', `/contracts/${c.id}/previewBill`, baseInput],
    ['GET', `/bills/${b.id}`],
    ['GET', `/receipts/${r.id}`],
    [
      'POST',
      '/bills',
      {
        ...baseInput,
        requestId: randomUUID(),
        contractId: c.id,
        expectedContractVersion: 0,
        configVersion: 1,
      },
    ],
    [
      'PATCH',
      `/bills/${b.id}`,
      {
        ...baseInput,
        requestId: randomUUID(),
        expectedVersion: b.version,
        configVersion: 1,
      },
    ],
    ...['issue', 'void', 'applyDeposit'].map((a): [string, string, unknown] => [
      'POST',
      `/bills/${b.id}/${a}`,
      { requestId: randomUUID(), expectedVersion: b.version },
    ]),
    [
      'POST',
      '/receipts',
      {
        requestId: randomUUID(),
        contractId: c.id,
        expectedLeaseVersion: 0,
        date: '2026-08-31',
        amount: '1',
        method: 'bank',
        reference: 'deny',
        evidence: 'Test',
      },
    ],
    ...['allocate', 'reverseAllocation', 'refund', 'reverseRefund', 'void'].map(
      (a): [string, string, unknown] => [
        'POST',
        `/receipts/${r.id}/${a}`,
        { requestId: randomUUID(), expectedVersion: r.version },
      ],
    ),
  ];
  for (const [method, path, body] of endpoints) {
    const options = {
      method,
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    };
    expect((await request(path, options)).status, `anonymous ${path}`).toBe(
      401,
    );
    expect((await deny.fetch(path, options)).status, `denied ${path}`).toBe(
      403,
    );
  }
  await call(
    `/receipts/${r.id}/allocate`,
    {
      requestId: randomUUID(),
      expectedVersion: 0,
      allocations: [
        { billId: b.id, expectedBillVersion: b.version, amount: '50' },
        { billId: b2.id, expectedBillVersion: b2.version, amount: '50' },
      ],
    },
    404,
  );
  expect((await call<Receipt>(`/receipts/${r.id}`)).unusedCents).toBe('20000');
  expect((await call<Bill>(`/bills/${b.id}`)).remainingCents).toBe('15000');
  const requestBody = {
    requestId: randomUUID(),
    expectedVersion: 0,
    allocations: [
      { billId: b.id, expectedBillVersion: b.version, amount: '50' },
    ],
  };
  r = await call<Receipt>(`/receipts/${r.id}/allocate`, requestBody);
  await call(`/receipts/${r.id}/allocate`, requestBody);
  expect((await call<Bill>(`/bills/${b.id}`)).remainingCents).toBe('10000');
  const entry = (
    await testApp.database
      .repository<ReceiptEntry>('hylReceiptEntries')
      .findMany({ filter: { receiptId: r.id } })
  )[0]!;
  r = await call<Receipt>(`/receipts/${r.id}/reverseAllocation`, {
    requestId: randomUUID(),
    expectedVersion: r.version,
    sourceId: entry.id,
    reason: 'Correction',
    evidence: 'Test',
  });
  expect(r.unusedCents).toBe('20000');
  b = await call<Bill>(`/bills/${b.id}`);
  expect(b.remainingCents).toBe('15000');
  r = await call<Receipt>(`/receipts/${r.id}/refund`, {
    requestId: randomUUID(),
    expectedVersion: r.version,
    amount: '20',
    date: '2026-08-31',
    reference: 'F1',
    reason: 'Test',
    evidence: 'Test',
  });
  const refund = (
    await testApp.database
      .repository<ReceiptEntry>('hylReceiptEntries')
      .findMany({ filter: { receiptId: r.id, kind: 'refund' } })
  )[0]!;
  r = await call<Receipt>(`/receipts/${r.id}/reverseRefund`, {
    requestId: randomUUID(),
    expectedVersion: r.version,
    sourceId: refund.id,
    reason: 'Test',
    evidence: 'Test',
  });
  expect(r.unusedCents).toBe('20000');
  await call(
    '/receipts',
    {
      requestId: randomUUID(),
      contractId: c.id,
      expectedLeaseVersion: 0,
      date: '2026-08-31',
      amount: '200',
      method: 'bank',
      reference: 'R1',
      evidence: 'Test',
    },
    409,
    'POST',
  );
  const concurrent = await Promise.all(
    ['C1', 'C2'].map((reference) =>
      s.fetch(`/receipts/${r.id}/allocate`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost',
        },
        body: JSON.stringify({
          requestId: randomUUID(),
          expectedVersion: r.version,
          allocations: [
            { billId: b.id, expectedBillVersion: b.version, amount: '100' },
          ],
          reference,
        }),
      }),
    ),
  );
  expect(concurrent.map((x) => x.status).sort()).toEqual([200, 409]);
});
test('tariff revisions own only future enabled intervals and preserve issued rate snapshots', async ({
  testApp,
}) => {
  const session = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS),
    call = api(session);
  const merchant = await call(
    '/merchants',
    {
      name: 'Tariff test',
      unit: 'T',
      contact: 'T',
      phone: '0',
      accountName: 'T',
      bank: 'T',
      account: '0',
    },
    201,
  );
  const contract = await call(
      '/contracts',
      { ...values, end: '2026-11-30', merchantId: merchant.id },
      201,
    ),
    base = `/contracts/${contract.id}`;
  await call(
    `${base}/billingConfig`,
    { ...cfg, requestId: randomUUID(), expectedVersion: 0 },
    200,
    'PUT',
  );
  const first = await call<Bill>(
    '/bills',
    {
      ...baseInput,
      contractId: contract.id,
      expectedContractVersion: contract.version,
      configVersion: 1,
      requestId: randomUUID(),
    },
    201,
  );
  await call<Bill>(`/bills/${first.id}/issue`, {
    requestId: randomUUID(),
    expectedVersion: first.version,
  });
  await call(
    `${base}/billingConfig`,
    {
      ...cfg,
      effectiveFrom: '2026-09-01',
      property: { enabled: true, method: 'fixed', price: '310' },
      requestId: randomUUID(),
      expectedVersion: 1,
    },
    200,
    'PUT',
  );
  const input = {
    ...baseInput,
    month: '2026-09',
    dueDate: '2026-09-30',
    fees: ['property'],
  };
  let sept = await call<Bill>(
    '/bills',
    {
      ...input,
      contractId: contract.id,
      expectedContractVersion: contract.version,
      configVersion: 2,
      requestId: randomUUID(),
    },
    201,
  );
  sept = await call<Bill>(`/bills/${sept.id}/issue`, {
    requestId: randomUUID(),
    expectedVersion: sept.version,
  });
  expect(sept.amountCents).toBe('31000');
  await call(
    `${base}/billingConfig`,
    {
      ...cfg,
      effectiveFrom: '2026-10-01',
      property: { enabled: true, method: 'fixed', price: '620' },
      requestId: randomUUID(),
      expectedVersion: 2,
    },
    200,
    'PUT',
  );
  const october = await call<{ total: string }>(`${base}/previewBill`, {
    ...input,
    month: '2026-10',
    dueDate: '2026-10-31',
  });
  expect(october.total).toBe('620.00');
  expect((await call<Bill>(`/bills/${sept.id}`)).amountCents).toBe('31000');
  await call(
    `${base}/billingConfig`,
    {
      ...cfg,
      effectiveFrom: '2026-11-01',
      requestId: randomUUID(),
      expectedVersion: 3,
    },
    200,
    'PUT',
  );
  const expense = (date: string, reference: string) => ({
    merchantId: merchant.id,
    date,
    category: 'property',
    amount: '1',
    responsibility: 'company',
    reference,
    evidence: 'Test',
  });
  await call('/expenses', expense('2026-08-20', 'AUG-EXPENSE'), 201);
  await call('/expenses', expense('2026-11-02', 'NOV-EXPENSE'), 201);
  await call('/expenses', expense('2026-09-02', 'SEPT-DUPLICATE'), 400);
  await call(
    `${base}/billingConfig`,
    {
      ...cfg,
      effectiveFrom: '2026-11-01',
      rentChannel: 'settlement',
      requestId: randomUUID(),
      expectedVersion: 4,
    },
    400,
    'PUT',
  );
});
