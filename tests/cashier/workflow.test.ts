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
import type { CashierRecord, Checkout } from '../../server/cashier/model.js';
const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    logging: { enabled: false },
  },
});
test('atomic mixed-contract checkout, partial and excess collection, allocated refund corrections and immutable reconciliation', async ({
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
        fixedFee: '0',
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
  await call(`/contracts/${a.id}/leaseActions/receive`, {
    requestId: randomUUID(),
    expectedVersion: 1,
    amount: '100',
    date: '2026-10-18',
    reference: 'DEPOSIT-100',
    method: 'bank',
    evidence: 'test',
  });
  const targets = async (amounts: string[], deposit = '0') =>
    Promise.all(
      bills.map(async (bill, i) => ({
        billId: bill.id,
        contractId: bill.contractId,
        expectedBillVersion: (await call<Bill>('/bills/' + bill.id)).version,
        expectedLeaseVersion: (
          await call<{ version: number }>(
            `/contracts/${bill.contractId}/leaseSummary`,
          )
        ).version,
        amount: amounts[i],
        deposit: i === 0 ? deposit : '0',
      })),
    );
  const payment = (
    amount: string,
    reference: string,
    splits: [string, string][],
    method: 'bank' | 'cash' = 'bank',
  ) => ({
    key: randomUUID(),
    amount,
    method,
    reference,
    evidence: 'test',
    splits: splits.map(([contractId, amount]) => ({ contractId, amount })),
  });
  const post = async (input: Checkout) => {
    const draft = await call<CashierRecord>('/cashierOrders', {
      ...input,
      requestId: randomUUID(),
    });
    expect(draft.payload.input).not.toHaveProperty('requestId');
    await call('/cashierOrders/preview', draft.payload.input);
    const body = {
      requestId: randomUUID(),
      expectedVersion: draft.version,
      reason: 'test',
      evidence: 'test',
    };
    const posted = await call<CashierRecord>(
      `/cashierOrders/${draft.id}/post`,
      body,
    );
    expect(await call(`/cashierOrders/${draft.id}/post`, body)).toEqual(posted);
    return posted;
  };
  const first = await post({
    merchantId: merchant.id,
    date: '2026-10-18',
    notes: '',
    targets: await targets(['500', '200'], '100'),
    payments: [
      payment('500', 'LEG-1', [
        [a.id, '300'],
        [b.id, '200'],
      ]),
      payment('200', 'LEG-2', [[a.id, '200']], 'cash'),
    ],
  });
  expect(first.receivedCents).toBe('70000');
  expect(first.unusedCents).toBe('0');
  expect((await call<Bill>('/bills/' + bills[0].id)).remainingCents).toBe(
    '40000',
  );
  expect((await call<Bill>('/bills/' + bills[1].id)).remainingCents).toBe(
    '40000',
  );
  const beforeReceipts = (
    await call<Receipt[]>('/receipts?merchantId=' + merchant.id)
  ).length;
  const rollbackDraft = await call<CashierRecord>('/cashierOrders', {
    requestId: randomUUID(),
    merchantId: merchant.id,
    date: '2026-10-18',
    notes: 'rollback',
    targets: await targets(['100', '100']),
    payments: [
      payment('50', 'ROLLBACK-NEW', [[a.id, '50']]),
      payment('150', 'LEG-1', [
        [a.id, '50'],
        [b.id, '100'],
      ]),
    ],
  });
  await call(
    `/cashierOrders/${rollbackDraft.id}/post`,
    {
      requestId: randomUUID(),
      expectedVersion: rollbackDraft.version,
      reason: 'test rollback',
      evidence: 'test',
    },
    'POST',
    409,
  );
  expect(
    (await call<Receipt[]>('/receipts?merchantId=' + merchant.id)).length,
  ).toBe(beforeReceipts);
  expect(
    (await call<CashierRecord>('/cashierOrders/' + rollbackDraft.id)).status,
  ).toBe('draft');
  await call(`/cashierOrders/${rollbackDraft.id}/void`, {
    requestId: randomUUID(),
    expectedVersion: rollbackDraft.version,
    reason: 'test void',
    evidence: 'test',
  });
  // Legacy receipt/deposit entry points share reference reservations.
  await call(
    '/receipts',
    {
      requestId: randomUUID(),
      contractId: a.id,
      expectedLeaseVersion: 3,
      date: '2026-10-18',
      amount: '1',
      method: 'cash',
      reference: 'LEG-1',
      evidence: 'test',
    },
    'POST',
    409,
  );
  const second = await post({
    merchantId: merchant.id,
    date: '2026-10-18',
    notes: '',
    targets: await targets(['400', '400']),
    payments: [
      payment('1000', 'LEG-3', [
        [a.id, '500'],
        [b.id, '500'],
      ]),
    ],
  });
  expect(second.unusedCents).toBe('20000');
  const detail = await call<{ members: { kind: string; sourceId: string }[] }>(
    '/cashierOrders/' + second.id,
  );
  const receiptIds = detail.members
    .filter((m) => m.kind === 'receipt')
    .map((m) => m.sourceId);
  const refunds = async (ids: string[], amount = '100') => ({
    requestId: randomUUID(),
    date: '2026-10-18',
    reference: randomUUID(),
    reason: 'test',
    evidence: 'test',
    notes: '',
    sources: await Promise.all(
      ids.map(async (id) => {
        const r = await call<Receipt>('/receipts/' + id);
        return {
          receiptId: id,
          expectedVersion: r.version,
          amount,
          method: 'bank',
          allocations: [],
        };
      }),
    ),
  });
  const excess = await refunds(receiptIds);
  const refunded = await call<CashierRecord>('/cashierRefunds', excess);
  expect(refunded.amountCents).toBe('20000');
  expect(await call('/cashierRefunds', excess)).toEqual(refunded);
  // A correction through the original receipt UI must update the wrapper;
  // finishing the wrapper correction skips the source that is already reversed.
  const effects = refunded.payload.effects as {
    receiptId: string;
    entryId: string;
  }[];
  const correctedReceipt = await call<Receipt>(
    '/receipts/' + effects[0].receiptId,
  );
  await call(`/receipts/${correctedReceipt.id}/reverseRefund`, {
    requestId: randomUUID(),
    expectedVersion: correctedReceipt.version,
    sourceId: effects[0].entryId,
    amount: '0',
    reference: '',
    reason: 'legacy correction',
    evidence: 'test',
    allocations: [],
  });
  const partial = await call<CashierRecord>('/cashierRefunds/' + refunded.id);
  expect(partial.status).toBe('partiallyCorrected');
  expect(partial.refundedCents).toBe('10000');
  await call(`/cashierRefunds/${partial.id}/reverse`, {
    requestId: randomUUID(),
    expectedVersion: partial.version,
    reason: 'finish correction',
    evidence: 'test',
  });
  const fullyCorrected = await call<CashierRecord>(
    '/cashierRefunds/' + refunded.id,
  );
  expect(fullyCorrected.status).toBe('corrected');
  expect(fullyCorrected.refundedCents).toBe('0');
  await call('/cashierRefunds', await refunds(receiptIds));
  const firstDetail = await call<{
    members: { kind: string; sourceId: string }[];
  }>('/cashierOrders/' + first.id);
  let source: (Receipt & { entries: ReceiptEntry[] }) | undefined;
  for (const m of firstDetail.members.filter((m) => m.kind === 'receipt')) {
    const r = await call<Receipt & { entries: ReceiptEntry[] }>(
      '/receipts/' + m.sourceId,
    );
    if (r.contractId === a.id && r.payload.method === 'bank') source = r;
  }
  const allocation = source!.entries.find((e) => e.kind === 'allocate')!;
  const refundInput = {
    ...(await refunds([source!.id])),
    sources: [
      {
        receiptId: source!.id,
        expectedVersion: source!.version,
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
  const allocatedRefund = await call<CashierRecord>(
    '/cashierRefunds',
    refundInput,
  );
  expect((await call<Bill>('/bills/' + bills[0].id)).remainingCents).toBe(
    '10000',
  );
  await call(`/cashierRefunds/${allocatedRefund.id}/reverse`, {
    requestId: randomUUID(),
    expectedVersion: allocatedRefund.version,
    reason: 'correct',
    evidence: 'test',
  });
  expect((await call<Receipt>('/receipts/' + source!.id)).unusedCents).toBe(
    '10000',
  );
  await call('/cashierRefunds', await refunds([source!.id]));
  const currentTargets = await targets(['100', '0']);
  await post({
    merchantId: merchant.id,
    date: '2026-10-18',
    notes: '',
    targets: [currentTargets[0]],
    payments: [payment('100', 'LEG-4', [[a.id, '100']])],
  });
  expect((await call<Bill>('/bills/' + bills[0].id)).remainingCents).toBe('0');
  expect((await call<Bill>('/bills/' + bills[1].id)).remainingCents).toBe('0');
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const preview = await call<{
    sourceHash: string;
    cashCents: string;
    netCents: string;
    channels: Record<string, { netCents: string }>;
  }>(`/cashierReconciliationPreview?day=${day}`);
  expect(preview.cashCents).toBe('20000');
  expect(preview.netCents).toBe('160000');
  expect(preview.channels.bank.netCents).toBe('140000');
  const snapshot = await call<CashierRecord>('/cashierReconciliations', {
    requestId: randomUUID(),
    day,
    scope: 'own',
    sourceHash: preview.sourceHash,
    countedCash: '200',
    evidence: 'cash counted',
    differenceReason: '',
    notes: '',
  });
  expect(snapshot.differenceCents).toBe('0');
  expect(snapshot.revision).toBe(1);
  const users = testApp.application.container.resolve(
      userManagementServiceToken,
    ),
    authz = testApp.application.container.resolve(authorizationToken),
    password = randomBytes(24).toString('hex');
  const scoped = await users.create({
    name: 'Cashier scoped',
    email: `${randomUUID()}@example.test`,
    password,
  });
  authz.recordAccess.define(
    defineRecordAccess('cashier.onlyA', (access) =>
      access
        .title({ key: 'cashier.title', ns: 'nocoerp' })
        .collections('hylContracts')
        .resolver(async () => buildFilter((f) => f.string('id').eq(a.id))),
    ),
  );
  await authz.permissionSets.create(
    definePermissionSet('cashier-scoped')
      .grant(
        resources.contracts.reference().grant({
          cashierRead: { records: 'cashier.onlyA' },
          receiptRead: { records: 'cashier.onlyA' },
          billingRead: { records: 'cashier.onlyA' },
          cashierCheckout: { records: 'cashier.onlyA' },
          receiptReceive: { records: 'cashier.onlyA' },
          receiptAllocate: { records: 'cashier.onlyA' },
          cashierReconcileRead: { records: 'cashier.onlyA' },
        }),
      )
      .build(),
  );
  await authz.permissionSets.assign({
    permissionSet: 'cashier-scoped',
    subject: { type: 'user', id: scoped.id },
  });
  const member = await signIn(testApp, { email: scoped.email, password });
  expect((await member.fetch('/cashierOrders/' + first.id)).status).toBe(404);
  const visible = (await (await member.fetch('/cashierOrders')).json()) as {
    data: CashierRecord[];
  };
  expect(
    visible.data.some((r) => r.id === first.id || r.id === second.id),
  ).toBe(false);
  expect(
    (
      await member.fetch(
        `/cashierReconciliationPreview?day=${day}&scope=authorized`,
      )
    ).status,
  ).toBe(403);
  const deniedUser = await users.create({
    name: 'No financial grants',
    email: `${randomUUID()}@example.test`,
    password,
  });
  const denied = await signIn(testApp, { email: deniedUser.email, password });
  for (const path of [
    '/cashierOrders',
    '/cashierRefunds',
    '/cashierReconciliations',
    `/cashierReconciliationPreview?day=${day}`,
    '/cashierOrders/' + first.id,
    '/cashierRefunds/' + refunded.id,
    '/cashierReconciliations/' + snapshot.id,
  ])
    expect((await denied.fetch(path)).status).toBe(403);
  const late = await call<Receipt>(
    '/receipts',
    {
      requestId: randomUUID(),
      contractId: a.id,
      expectedLeaseVersion: (
        await call<{ version: number }>(`/contracts/${a.id}/leaseSummary`)
      ).version,
      date: '2026-08-31',
      amount: '1',
      method: 'bank',
      reference: 'LATE',
      evidence: 'test',
    },
    'POST',
    201,
  );
  await call(
    '/cashierReconciliations',
    {
      requestId: randomUUID(),
      day,
      scope: 'own',
      sourceHash: preview.sourceHash,
      countedCash: '200',
      evidence: 'test',
      differenceReason: '',
      notes: '',
    },
    'POST',
    409,
  );
  await call(`/receipts/${late.id}/void`, {
    requestId: randomUUID(),
    expectedVersion: late.version,
    reason: 'test',
    evidence: 'test',
  });
  expect(
    (
      await call<CashierRecord & { laterEvents: number }>(
        '/cashierReconciliations/' + snapshot.id,
      )
    ).laterEvents,
  ).toBe(2);
  const latestReport = await call<{ sourceHash: string; netCents: string }>(
    `/cashierReconciliationPreview?day=${day}`,
  );
  const revision = await call<CashierRecord>('/cashierReconciliations', {
    requestId: randomUUID(),
    day,
    scope: 'own',
    sourceHash: latestReport.sourceHash,
    countedCash: '200',
    evidence: 'test',
    differenceReason: '',
    notes: '',
  });
  expect(revision.revision).toBe(2);
  expect(revision.netCents).toBe('160000');
  for (const contract of contracts) {
    const fresh = await call<{ version: number }>(
      `/contracts/${contract.id}/leaseSummary`,
    );
    const closed = await call<{ lease: { status: string } }>(
      `/contracts/${contract.id}/leaseActions/closeLease`,
      {
        requestId: randomUUID(),
        expectedVersion: fresh.version,
        reason: 'test',
        evidence: 'test',
      },
    );
    expect(closed.lease.status).toBe('closed');
  }
});
