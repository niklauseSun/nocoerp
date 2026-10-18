// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
} from '@nocobase/app-plugin-authentication/testing';
import { createStandaloneServer } from '../../server/standalone.js';
import type { Bill, Receipt } from '../../server/billing/model.js';
import type { Row } from '../../server/hyl/schema.js';
const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    logging: { enabled: false },
  },
});
test('bill rent once, deposit, partial/multi-bill allocations, refunds, reversals and rent-only closure', async ({
  testApp,
  request,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const call = async <T>(
    path: string,
    body?: unknown,
    method = 'POST',
    status = 200,
  ): Promise<T> => {
    const r = await admin.fetch(path, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await r.json()) as { data: T };
    if (r.status !== status)
      throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(json)}`);
    return json.data;
  };
  const m = await call<Row>(
    '/merchants',
    {
      name: 'Billing test',
      unit: 'A1',
      contact: 'Test',
      phone: '000',
      accountName: 'Test',
      bank: 'Test',
      account: '000',
    },
    'POST',
    201,
  );
  const contract = await call<Row>(
    '/contracts',
    {
      merchantId: m.id,
      title: 'Rent-only',
      start: '2026-08-17',
      end: '2026-09-30',
      cycle: 'month',
      method: 'fixed',
      basis: 'receipts',
      rate: '0',
      fixedFee: '0',
      minimum: '0',
      rent: '3100',
      includeActivity: true,
      includeCash: true,
      includeHospitality: false,
      depositTarget: '200',
    },
    'POST',
    201,
  );
  const base = `/contracts/${contract.id}`;
  expect((await request('/bills')).status).toBe(401);
  await call(
    `${base}/billingConfig`,
    {
      requestId: randomUUID(),
      expectedVersion: 0,
      effectiveFrom: '2026-08-17',
      rentChannel: 'bill',
      property: { enabled: true, method: 'fixed', price: '310' },
      utilities: {},
      meters: [],
    },
    'PUT',
  );
  await call(`${base}/leaseActions/receive`, {
    requestId: randomUUID(),
    expectedVersion: 0,
    amount: '200',
    date: '2026-08-17',
    reference: 'deposit',
    evidence: 'Test',
  });
  await call(`${base}/leaseActions/terminate`, {
    requestId: randomUUID(),
    expectedVersion: 1,
    actualEnd: '2026-08-31',
    reason: 'Test',
    handover: 'Test',
    evidence: 'Test',
  });
  const input = {
    month: '2026-08',
    part: 'month',
    dueDate: '2026-08-31',
    fees: ['rent', 'property'],
    readings: [],
    others: [
      {
        title: 'Other charge',
        amount: '100',
        reference: 'other-1',
        reason: 'Test',
        evidence: 'Test',
      },
    ],
  };
  const create = {
    ...input,
    contractId: contract.id,
    expectedContractVersion: contract.version,
    configVersion: 1,
    requestId: randomUUID(),
  };
  let bill = await call<Bill>('/bills', create, 'POST', 201);
  expect(bill.amountCents).toBe('175000');
  expect((await call<Bill>('/bills', create, 'POST', 201)).id).toBe(bill.id);
  await call('/bills', { ...create, requestId: randomUUID() }, 'POST', 400);
  bill = await call<Bill>(`/bills/${bill.id}/issue`, {
    requestId: randomUUID(),
    expectedVersion: bill.version,
  });
  bill = await call<Bill>(`/bills/${bill.id}/applyDeposit`, {
    requestId: randomUUID(),
    expectedVersion: bill.version,
    expectedLeaseVersion: 2,
    amount: '200',
    date: '2026-08-31',
    reason: 'Test',
    evidence: 'Test',
  });
  expect(bill.remainingCents).toBe('155000');
  let receipt = await call<Receipt>(
    '/receipts',
    {
      requestId: randomUUID(),
      contractId: contract.id,
      expectedLeaseVersion: 3,
      amount: '1000',
      date: '2026-08-31',
      method: 'bank',
      reference: 'cash-1',
      evidence: 'Test',
    },
    'POST',
    201,
  );
  receipt = await call<Receipt>(`/receipts/${receipt.id}/allocate`, {
    requestId: randomUUID(),
    expectedVersion: receipt.version,
    allocations: [
      { billId: bill.id, expectedBillVersion: bill.version, amount: '600' },
    ],
  });
  expect(receipt.unusedCents).toBe('40000');
  const detail = await call<Bill>(`/bills/${bill.id}`, undefined, 'GET');
  expect(detail.remainingCents).toBe('95000');
  await call<Receipt>(`/receipts/${receipt.id}/allocate`, {
    requestId: randomUUID(),
    expectedVersion: receipt.version,
    allocations: [
      { billId: bill.id, expectedBillVersion: detail.version, amount: '400' },
    ],
  });
  const other = await call<Bill>(
    '/bills',
    {
      ...create,
      fees: [],
      others: [
        {
          title: 'Other2',
          amount: '50',
          reference: 'other-2',
          reason: 'Test',
          evidence: 'Test',
        },
      ],
      requestId: randomUUID(),
    },
    'POST',
    201,
  );
  const issued2 = await call<Bill>(`/bills/${other.id}/issue`, {
    requestId: randomUUID(),
    expectedVersion: other.version,
  });
  const current = await call<Bill>(`/bills/${bill.id}`, undefined, 'GET');
  let receipt2 = await call<Receipt>(
    '/receipts',
    {
      requestId: randomUUID(),
      contractId: contract.id,
      expectedLeaseVersion: 3,
      amount: '800',
      date: '2026-08-31',
      method: 'bank',
      reference: 'cash-2',
      evidence: 'Test',
    },
    'POST',
    201,
  );
  receipt2 = await call<Receipt>(`/receipts/${receipt2.id}/allocate`, {
    requestId: randomUUID(),
    expectedVersion: receipt2.version,
    allocations: [
      { billId: bill.id, expectedBillVersion: current.version, amount: '550' },
      {
        billId: issued2.id,
        expectedBillVersion: issued2.version,
        amount: '50',
      },
    ],
  });
  expect(receipt2.unusedCents).toBe('20000');
  await call(
    `${base}/leaseActions/closeLease`,
    {
      requestId: randomUUID(),
      expectedVersion: 3,
      reason: 'Test',
      evidence: 'Test',
    },
    'POST',
    400,
  );
  receipt2 = await call<Receipt>(`/receipts/${receipt2.id}/refund`, {
    requestId: randomUUID(),
    expectedVersion: receipt2.version,
    amount: '200',
    date: '2026-08-31',
    reference: 'refund-1',
    reason: 'Test',
    evidence: 'Test',
  });
  expect(receipt2.unusedCents).toBe('0');
  const closed = await call<{ lease: { status: string } }>(
    `${base}/leaseActions/closeLease`,
    {
      requestId: randomUUID(),
      expectedVersion: 3,
      reason: 'Test',
      evidence: 'Test',
    },
  );
  expect(closed.lease.status).toBe('closed');
  expect(
    (
      await call<Bill & { displayStatus: string }>(
        `/bills/${bill.id}`,
        undefined,
        'GET',
      )
    ).displayStatus,
  ).toBe('paid');
  await call(
    `/receipts/${receipt2.id}/refund`,
    {
      requestId: randomUUID(),
      expectedVersion: receipt2.version,
      amount: '1',
      date: '2026-08-31',
      reference: 'blocked',
      reason: 'Test',
      evidence: 'Test',
    },
    'POST',
    400,
  );
});
