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
test('deposit receipt alone is excluded; bill deduction and its reversal update invoice quotas atomically', async ({
  testApp,
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
    if (r.status !== status) throw Error(JSON.stringify(json));
    return json.data;
  }
  const merchant = await call(
      '/merchants',
      {
        name: 'Deposit invoice test',
        unit: 'D',
        contact: 'test',
        phone: '0',
        bank: 'test',
        accountName: 'test',
        account: '0',
      },
      'POST',
      201,
    ),
    contract = await call(
      '/contracts',
      {
        merchantId: merchant.id,
        title: 'Deposit invoice',
        start: '2026-10-01',
        end: '2026-10-31',
        cycle: 'month',
        method: 'fixed',
        basis: 'receipts',
        rate: '0',
        fixedFee: '0',
        minimum: '0',
        rent: '100',
        depositTarget: '100',
        includeActivity: true,
        includeCash: true,
        includeHospitality: false,
      },
      'POST',
      201,
    ),
    base = '/contracts/' + contract.id;
  const party = { type: 'company', name: 'SIM', taxNo: 'SIM' };
  await call(
    base + '/invoiceConfig',
    {
      requestId: randomUUID(),
      expectedVersion: 0,
      values: {
        enabled: true,
        autoIssue: true,
        buyer: party,
        seller: party,
        fees: [{ feeType: 'rent', taxItemName: 'rent', rate: '0' }],
      },
    },
    'PUT',
  );
  await call(
    base + '/billingConfig',
    {
      requestId: randomUUID(),
      expectedVersion: 0,
      effectiveFrom: '2026-10-01',
      rentChannel: 'bill',
      property: { enabled: false, method: 'fixed', price: '0' },
      utilities: {},
      meters: [],
    },
    'PUT',
  );
  let bill = await call(
    '/bills',
    {
      requestId: randomUUID(),
      contractId: contract.id,
      expectedContractVersion: contract.version,
      configVersion: 1,
      month: '2026-10',
      part: 'month',
      dueDate: '2026-10-31',
      fees: ['rent'],
      readings: [],
      others: [],
    },
    'POST',
    201,
  );
  bill = await call('/bills/' + bill.id + '/issue', {
    requestId: randomUUID(),
    expectedVersion: bill.version,
  });
  await call(base + '/leaseActions/receive', {
    requestId: randomUUID(),
    expectedVersion: 0,
    amount: '100',
    date: '2026-10-18',
    reference: randomUUID(),
    evidence: 'test',
  });
  const sources = () => call('/invoiceSources?contractId=' + contract.id);
  expect((await sources())[0].paidCents).toBe('0');
  expect(await call('/invoices?contractId=' + contract.id)).toEqual([]);
  const deduction = await call(base + '/leaseActions/deduct', {
    requestId: randomUUID(),
    expectedVersion: 1,
    sourceId: bill.id,
    amount: '50',
    date: '2026-10-18',
    reason: 'test',
    evidence: 'test',
  });
  expect((await sources())[0].paidCents).toBe('5000');
  expect((await sources())[0].netIssuedCents).toBe('5000');
  expect(await call('/invoices?contractId=' + contract.id)).toHaveLength(1);
  await call(base + '/leaseActions/reverse', {
    requestId: randomUUID(),
    expectedVersion: deduction.lease.version,
    sourceId: deduction.entry.id,
    date: '2026-10-18',
    reason: 'reverse test',
    evidence: 'test',
  });
  const source = (await sources())[0];
  expect(source.paidCents).toBe('0');
  expect(source.requiredRedCents).toBe('5000');
  expect(source.netIssuedCents).toBe('5000');
  const invoice = (await call('/invoices?contractId=' + contract.id))[0],
    detail = await call('/invoices/' + invoice.id),
    values = {
      reasonCode: 'refund',
      reason: 'deposit reversal',
      evidence: 'test',
      lines: [{ originalLineId: detail.lines.data[0].id, gross: '50' }],
      result: 'success',
      failureReason: '',
      notes: '',
    },
    preview = await call('/invoices/' + invoice.id + '/previewRed', values);
  await call('/invoices/' + invoice.id + '/red', {
    ...values,
    requestId: randomUUID(),
    expectedVersion: detail.version,
    expectedSources: preview.expectedSources,
    previewHash: preview.previewHash,
  });
  expect((await sources())[0].netIssuedCents).toBe('0');
  expect((await sources())[0].requiredRedCents).toBe('0');
});
