import {
  detailItems,
  listItems,
  previewResponse,
  operationResponse,
  configPreviewResponse,
  configResponse,
} from '../../server/invoicing/responses.js';
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
test('cashier payment, auto issue, refund partial credits and reissue reconcile exactly', async ({
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
    const response = await admin.fetch(path, {
        method,
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      json = (await response.json()) as any;
    if (response.status !== status)
      throw Error(`${path}: ${response.status} ${JSON.stringify(json)}`);
    if (response.status === 200) {
      if (method === 'GET' && /^\/invoiceSources\/[^/]+$/.test(path))
        detailItems.sources.parse(json.data);
      if (method === 'GET' && /^\/invoices\/[^/]+$/.test(path))
        detailItems.invoices.parse(json.data);
      if (method === 'GET' && /^\/invoiceConfigs\/[^/]+$/.test(path))
        detailItems.configs.parse(json.data);
      if (method === 'GET' && /^\/invoices(?:\?|$)/.test(path))
        json.data.forEach((row: unknown) => listItems.invoices.parse(row));
      if (method === 'POST' && /^\/invoices(?:\/[^/]+\/red)?$/.test(path))
        operationResponse.parse(json.data);
      if (
        method === 'POST' &&
        /\/(preview|previewRed)$/.test(path) &&
        path.startsWith('/invoices')
      )
        previewResponse.parse(json.data);
      if (method === 'POST' && path.endsWith('/previewInvoiceConfig'))
        configPreviewResponse.parse(json.data);
      if (method === 'PUT' && path.endsWith('/invoiceConfig'))
        configResponse.parse(json.data);
    }
    return json.data;
  }
  for (const path of [
    '/invoiceSources',
    '/invoices',
    '/invoiceConfigs',
    '/invoices/preview',
    '/invoiceSources/preview',
  ])
    expect(
      (
        await request(path, {
          method: path.endsWith('preview') ? 'POST' : 'GET',
        })
      ).status,
    ).toBe(401);
  const swaggerResponse = await admin.fetch('/swagger');
  expect(swaggerResponse.status).toBe(200);
  const swagger = (await swaggerResponse.json()) as {
    paths: Record<
      string,
      Record<
        string,
        {
          requestBody?: unknown;
          responses: Record<string, { content?: unknown }>;
        }
      >
    >;
  };
  const issueRoute = Object.entries(swagger.paths).find(([path]) =>
    path.endsWith('/invoices'),
  )?.[1].post;
  expect(issueRoute?.requestBody).toBeDefined();
  expect(issueRoute?.responses['200'].content).toBeDefined();
  const redRoute = Object.entries(swagger.paths).find(([path]) =>
    path.endsWith('/invoices/{id}/red'),
  )?.[1].post;
  expect(redRoute?.requestBody).toBeDefined();
  expect(redRoute?.responses['409'].content).toBeDefined();
  const merchant = await call(
    '/merchants',
    {
      name: 'Invoice isolated test',
      unit: 'I',
      contact: 'demo',
      phone: '0',
      bank: 'bank',
      accountName: 'demo',
      account: '0',
    },
    'POST',
    201,
  );
  const contract = await call(
    '/contracts',
    {
      merchantId: merchant.id,
      title: 'Invoice lease',
      start: '2026-10-01',
      end: '2026-10-31',
      cycle: 'month',
      method: 'fixed',
      basis: 'receipts',
      rate: '0',
      fixedFee: '0',
      minimum: '0',
      rent: '1000',
      depositTarget: '0',
      includeActivity: true,
      includeCash: true,
      includeHospitality: false,
    },
    'POST',
    201,
  );
  const party = {
    type: 'company',
    name: 'Demo',
    taxNo: 'SIM123',
    address: '',
    phone: '',
    bank: '',
    account: '',
    email: '',
  };
  const config = {
    enabled: true,
    autoIssue: true,
    buyer: party,
    seller: { ...party, name: 'Project' },
    fees: [
      { feeType: 'rent', taxItemName: 'Rent simulation', code: '', rate: '6' },
    ],
    notes: '',
  };
  await call(
    `/contracts/${contract.id}/invoiceConfig`,
    { requestId: randomUUID(), expectedVersion: 0, values: config },
    'PUT',
  );
  await call(
    `/contracts/${contract.id}/billingConfig`,
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
  bill = await call(`/bills/${bill.id}/issue`, {
    requestId: randomUUID(),
    expectedVersion: bill.version,
  });
  async function checkout(amount: string) {
    bill = await call('/bills/' + bill.id);
    const lease = await call(`/contracts/${contract.id}/leaseSummary`);
    const order = await call('/cashierOrders', {
      requestId: randomUUID(),
      merchantId: merchant.id,
      date: '2026-10-18',
      targets: [
        {
          billId: bill.id,
          contractId: contract.id,
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
          splits: [{ contractId: contract.id, amount }],
        },
      ],
    });
    await call(`/cashierOrders/${order.id}/post`, {
      requestId: randomUUID(),
      expectedVersion: order.version,
      reason: 'test',
      evidence: 'test',
    });
    return order;
  }
  await checkout('600');
  let invoices = await call('/invoices?contractId=' + contract.id);
  expect(invoices).toHaveLength(1);
  expect(invoices[0].grossCents).toBe('60000');
  await checkout('400');
  invoices = await call('/invoices?contractId=' + contract.id);
  expect(invoices).toHaveLength(2);
  let source = (await call('/invoiceSources?contractId=' + contract.id))[0];
  expect(source.paidCents).toBe('100000');
  expect(source.netIssuedCents).toBe('100000');
  const sourceDetail = await call('/invoiceSources/' + source.id),
    receipt = await call('/receipts/' + sourceDetail.cash.data[0].receiptId),
    allocation = receipt.entries.find(
      (e: any) => e.kind === 'allocate' && !e.reversed,
    );
  bill = await call('/bills/' + bill.id);
  const refund = await call('/cashierRefunds', {
    requestId: randomUUID(),
    date: '2026-10-18',
    reference: randomUUID(),
    reason: 'return',
    evidence: 'test',
    sources: [
      {
        receiptId: receipt.id,
        expectedVersion: receipt.version,
        amount: '200',
        method: 'bank',
        allocations: [
          {
            entryId: allocation.id,
            amount: '200',
            expectedBillVersion: bill.version,
          },
        ],
      },
    ],
  });
  source = (await call('/invoiceSources?contractId=' + contract.id))[0];
  expect(source.paidCents).toBe('80000');
  expect(source.requiredRedCents).toBe('20000');
  expect(
    await call('/invoices?kind=blue&contractId=' + contract.id),
  ).toHaveLength(2);
  const original = invoices.find((r: any) => r.grossCents === '60000');
  for (const amount of ['50', '150']) {
    const detail = await call('/invoices/' + original.id),
      values = {
        reasonCode: 'refund',
        reason: 'return',
        evidence: 'test',
        lines: [{ originalLineId: detail.lines.data[0].id, gross: amount }],
        result: 'success',
        failureReason: '',
        notes: '',
      },
      preview = await call(`/invoices/${original.id}/previewRed`, values),
      input = {
        ...values,
        requestId: randomUUID(),
        expectedVersion: detail.version,
        expectedSources: preview.expectedSources,
        previewHash: preview.previewHash,
      };
    const result = await call(`/invoices/${original.id}/red`, input);
    expect(await call(`/invoices/${original.id}/red`, input)).toEqual(result);
  }
  source = (await call('/invoiceSources?contractId=' + contract.id))[0];
  expect(source.requiredRedCents).toBe('0');
  expect(source.netIssuedCents).toBe('80000');
  await call(`/cashierRefunds/${refund.id}/reverse`, {
    requestId: randomUUID(),
    expectedVersion: refund.version,
    reason: 'restore',
    evidence: 'test',
  });
  source = (await call('/invoiceSources?contractId=' + contract.id))[0];
  expect(source.paidCents).toBe('80000');
  expect(source.availableCents).toBe('0');
  // New cash allocation increases paid again; red records stay permanent.
  await checkout('200');
  source = (await call('/invoiceSources?contractId=' + contract.id))[0];
  expect(source.paidCents).toBe('100000');
  expect(source.netIssuedCents).toBe('100000');
  const all = await call('/invoices?contractId=' + contract.id);
  expect(all.filter((r: any) => r.kind === 'red')).toHaveLength(2);
  const signed = all.reduce(
    (n: bigint, r: any) =>
      n + (r.kind === 'red' ? -1n : 1n) * BigInt(r.grossCents),
    0n,
  );
  expect(signed).toBe(100000n);
  const red = all.find((r: any) => r.kind === 'red');
  await call(
    `/invoices/${red.id}/previewRed`,
    {
      reasonCode: 'correction',
      reason: 'bad',
      evidence: 'bad',
      lines: [{ originalLineId: randomUUID(), gross: '1' }],
      result: 'success',
      failureReason: '',
      notes: '',
    },
    'POST',
    400,
  );
});
