// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
  type TestSession,
} from '@nocobase/app-plugin-authentication/testing';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { authorizationToken } from '@nocobase/app-plugin-authorization';
import { definePermissionSet } from '@nocobase/authorization/permission-sets';
import { resources } from '../../server/hyl/resources.js';
import { createStandaloneServer } from '../../server/standalone.js';
import type { Row } from '../../server/hyl/schema.js';
const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    logging: { enabled: false },
  },
});
const send = async (
  s: TestSession,
  path: string,
  body: unknown,
  expected = 200,
) => {
  const response = await s.fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify(
      path.includes('/leaseActions/')
        ? {
            date: '2026-10-17',
            evidence: 'Test evidence',
            title: 'Independent charge',
            ...(body as Record<string, unknown>),
          }
        : body,
    ),
  });
  const json = (await response.json()) as {
    data: Row & { entry: { id: string }; lease: { version: number } };
  };
  if (response.status !== expected)
    throw new Error(`${path} ${response.status}: ${JSON.stringify(json)}`);
  expect(response.status).toBe(expected);
  return json.data;
};
const merchant = (s: TestSession, name: string, userId = '') =>
  send(
    s,
    '/merchants',
    {
      name,
      unit: 'Test',
      contact: 'Test',
      phone: '000',
      accountName: 'Test',
      bank: 'Test',
      account: '000',
      userId,
    },
    201,
  );
const values = {
  start: '2026-10-01',
  end: '2026-10-31',
  cycle: 'month',
  method: 'fixed',
  basis: 'receipts',
  rate: '0',
  fixedFee: '0',
  minimum: '0',
  rent: '310',
  depositTarget: '100',
  includeActivity: true,
  includeCash: true,
  includeHospitality: false,
};
test('serializes concurrent receipts, blocks consumed-entry reversals, rejects duplicate charges and stale writes', async ({
  testApp,
}) => {
  const s = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS),
    m = await merchant(s, 'Race'),
    c = await send(s, '/contracts', { ...values, merchantId: m.id }, 201),
    base = `/contracts/${c.id}/leaseActions/`;
  const request = (ref: string) =>
    s.fetch(base + 'receive', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify({
        requestId: randomUUID(),
        expectedVersion: 0,
        amount: '100',
        date: '2026-10-01',
        reference: ref,
        evidence: 'Test',
      }),
    });
  const results = await Promise.all([request('race-1'), request('race-2')]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  const receipt = (
    await testApp.database
      .repository('hylLeaseEntries')
      .findMany({ filter: { contractId: c.id } })
  )[0]!;
  const charge = await send(s, base + 'charge', {
    requestId: randomUUID(),
    expectedVersion: 1,
    amount: '50',
    date: '2026-10-01',
    reference: 'CHARGE',
    reason: 'Independent damage',
    evidence: 'Test',
  });
  await send(
    s,
    base + 'charge',
    {
      requestId: randomUUID(),
      expectedVersion: 2,
      amount: '50',
      date: '2026-10-01',
      reference: 'CHARGE',
      reason: 'Duplicate',
      evidence: 'Test',
    },
    409,
  );
  await send(
    s,
    base + 'deduct',
    {
      requestId: randomUUID(),
      expectedVersion: 2,
      amount: '50',
      reason: 'Test',
      sourceId: charge.entry.id,
    },
    400,
  );
  await send(s, base + 'confirmCharge', {
    requestId: randomUUID(),
    expectedVersion: 2,
    reason: 'Test',
    sourceId: charge.entry.id,
  });
  const deduction = await send(s, base + 'deduct', {
    requestId: randomUUID(),
    expectedVersion: 3,
    amount: '50',
    reason: 'Test',
    sourceId: charge.entry.id,
  });
  await send(
    s,
    base + 'reverse',
    {
      requestId: randomUUID(),
      expectedVersion: 4,
      reason: 'Test',
      sourceId: receipt.id,
    },
    400,
  );
  await send(
    s,
    base + 'cancelCharge',
    {
      requestId: randomUUID(),
      expectedVersion: 4,
      reason: 'Test',
      sourceId: charge.entry.id,
    },
    400,
  );
  await send(s, base + 'reverse', {
    requestId: randomUUID(),
    expectedVersion: 4,
    reason: 'Test',
    sourceId: deduction.entry.id,
  });
  await send(s, base + 'cancelCharge', {
    requestId: randomUUID(),
    expectedVersion: 5,
    reason: 'Test',
    sourceId: charge.entry.id,
  });
  await send(s, base + 'reverse', {
    requestId: randomUUID(),
    expectedVersion: 6,
    reason: 'Test',
    sourceId: receipt.id,
  });
});
test('blocks early termination until post-end sources are corrected and releases only effective asset occupancy', async ({
  testApp,
}) => {
  const s = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS),
    m = await merchant(s, 'Asset'),
    m2 = await merchant(s, 'Next tenant');
  const project = await send(
    s,
    '/assets',
    { name: 'P', type: 'project', area: '100', lettableArea: '100' },
    201,
  );
  const street = await send(
    s,
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
  const unit = await send(
    s,
    '/assets',
    {
      name: 'T',
      type: 'stall',
      parentId: street.id,
      area: '10',
      lettableArea: '10',
    },
    201,
  );
  const c = await send(
    s,
    '/contracts',
    { ...values, merchantId: m.id, assetIds: [unit.id] },
    201,
  );
  const base = `/contracts/${c.id}`;
  const report = await send(
    s,
    '/revenueReports',
    {
      merchantId: m.id,
      date: '2026-10-20',
      source: 'cash',
      reference: randomUUID(),
      receipts: '0',
      refunds: '0',
      activity: '0',
      cash: '0',
      hospitality: '0',
      collected: '0',
      evidence: 'Test',
    },
    201,
  );
  await send(
    s,
    base + '/leaseActions/terminate',
    {
      requestId: randomUUID(),
      expectedVersion: 0,
      actualEnd: '2026-10-17',
      reason: 'Test',
      handover: 'Keys',
    },
    400,
  );
  expect(
    await testApp.database
      .repository('hylLeases')
      .count({ filter: { id: c.id } }),
  ).toBe(0);
  const changed = { ...report.payload, date: '2026-10-17' };
  const patched = await s.fetch(`/revenueReports/${report.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify({ expectedVersion: report.version, values: changed }),
  });
  expect(patched.status).toBe(200);
  await send(s, base + '/leaseActions/terminate', {
    requestId: randomUUID(),
    expectedVersion: 0,
    actualEnd: '2026-10-17',
    reason: 'Test',
    handover: 'Keys',
  });
  const bindings = await testApp.database
    .repository('hylAssetBindings')
    .findMany({ filter: { merchantId: m.id } });
  expect(bindings[0]?.end).toBe('2026-10-17');
  await send(
    s,
    '/contracts',
    { ...values, merchantId: m2.id, assetIds: [unit.id], start: '2026-10-17' },
    400,
  );
  await send(
    s,
    '/contracts',
    { ...values, merchantId: m2.id, assetIds: [unit.id], start: '2026-10-18' },
    201,
  );
  await send(
    s,
    '/revenueReports',
    {
      merchantId: m.id,
      date: '2026-10-18',
      source: 'cash',
      reference: randomUUID(),
      receipts: '0',
      refunds: '0',
      activity: '0',
      cash: '0',
      hospitality: '0',
      collected: '0',
      evidence: 'Test',
    },
    400,
  );
});
test('enforces independent financial action rights and contract record scope', async ({
  testApp,
}) => {
  const s = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS),
    users = testApp.application.container.resolve(userManagementServiceToken),
    password = randomBytes(24).toString('hex');
  const user = await users.create({
    name: 'Scoped cashier',
    email: `${randomUUID()}@example.test`,
    password,
  });
  const own = await merchant(s, 'Own', user.id),
    other = await merchant(s, 'Other');
  const a = await send(s, '/contracts', { ...values, merchantId: own.id }, 201),
    b = await send(s, '/contracts', { ...values, merchantId: other.id }, 201);
  const authz = testApp.application.container.resolve(authorizationToken);
  await authz.permissionSets.create(
    definePermissionSet('lease-scoped')
      .grant(
        resources.contracts.reference().grant({
          read: { records: 'allRecords' },
          depositRead: { records: 'hyl.ownMerchant' },
          depositReceive: { records: 'hyl.ownMerchant' },
        }),
      )
      .build(),
  );
  await authz.permissionSets.assign({
    permissionSet: 'lease-scoped',
    subject: { type: 'user', id: user.id },
  });
  const member = await signIn(testApp, { email: user.email, password });
  await send(s, `/contracts/${b.id}/leaseActions/receive`, {
    ...{
      requestId: randomUUID(),
      expectedVersion: 0,
      amount: '10',
      date: '2026-10-01',
      reference: 'PRIVATE-REFERENCE',
      evidence: 'Private evidence',
      notes: 'PRIVATE-NOTES',
    },
  });
  const detail = (await (await member.fetch(`/contracts/${b.id}`)).json()) as {
    data: Row & { events: unknown[] };
  };
  expect(detail.data.payload).not.toHaveProperty('depositTarget');
  expect(JSON.stringify(detail.data.events)).not.toContain('PRIVATE');
  const list = (await (await member.fetch('/contracts')).json()) as {
    data: (Row & { depositTarget: null; depositBalance: null })[];
  };
  const hidden = list.data.find((r) => r.id === b.id)!;
  expect(hidden.payload).not.toHaveProperty('depositTarget');
  expect(hidden.depositTarget).toBeNull();
  expect(hidden.depositBalance).toBeNull();

  expect((await member.fetch(`/contracts/${a.id}/leaseSummary`)).status).toBe(
    200,
  );
  expect((await member.fetch(`/contracts/${b.id}/leaseSummary`)).status).toBe(
    404,
  );
  const payload = {
    requestId: randomUUID(),
    expectedVersion: 0,
    amount: '10',
    date: '2026-10-01',
    reference: 'scoped',
    evidence: 'Test',
  };
  await send(member, `/contracts/${a.id}/leaseActions/receive`, payload);
  await send(member, `/contracts/${b.id}/leaseActions/receive`, payload, 404);
  await send(
    member,
    `/contracts/${a.id}/leaseActions/refund`,
    { ...payload, expectedVersion: 1, reason: 'Test' },
    403,
  );
});
test('previews shared occupancy dependencies and supports zero or full deposit carry-over', async ({
  testApp,
}) => {
  const s = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  for (const transfer of ['0', '100']) {
    const m = await merchant(s, `Carry ${transfer}`),
      c = await send(s, '/contracts', { ...values, merchantId: m.id }, 201);
    await send(s, `/contracts/${c.id}/leaseActions/receive`, {
      requestId: randomUUID(),
      expectedVersion: 0,
      amount: '100',
      date: '2026-10-01',
      reference: 'deposit',
      evidence: 'Test',
    });
    const result = await send(s, `/contracts/${c.id}/leaseActions/renew`, {
      requestId: randomUUID(),
      expectedVersion: 1,
      amount: transfer,
      values: {
        ...values,
        merchantId: m.id,
        start: '2026-11-01',
        end: '2026-11-30',
      },
    });
    const entries = await testApp.database
      .repository('hylLeaseEntries')
      .findMany({ filter: { contractId: c.id } });
    expect(entries.filter((e) => e.kind === 'transferOut')).toHaveLength(
      transfer === '0' ? 0 : 1,
    );
    expect(result.lease.version).toBe(2);
  }
  const m = await merchant(s, 'Shared binding');
  const project = await send(
    s,
    '/assets',
    { name: 'P', type: 'project', area: '100', lettableArea: '100' },
    201,
  );
  const street = await send(
    s,
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
  const asset = await send(
    s,
    '/assets',
    {
      name: 'T',
      type: 'stall',
      parentId: street.id,
      area: '10',
      lettableArea: '10',
    },
    201,
  );
  await send(
    s,
    `/merchants/${m.id}/assets`,
    {
      requestId: randomUUID(),
      assetId: asset.id,
      start: '2026-10-01',
      end: '',
      area: '10',
    },
    201,
  );
  const c = await send(
    s,
    '/contracts',
    { ...values, merchantId: m.id, assetIds: [asset.id] },
    201,
  );
  await send(
    s,
    '/contracts',
    {
      ...values,
      merchantId: m.id,
      assetIds: [asset.id],
      start: '2026-11-01',
      end: '2026-11-30',
    },
    201,
  );
  const preview = (await send(s, `/contracts/${c.id}/terminationPreview`, {
    actualEnd: '2026-10-17',
  })) as unknown as {
    blockers: { kind: string; contractId?: string }[];
    occupancy: unknown[];
  };
  expect(
    preview.blockers.some((b) => b.kind === 'bindings' && !!b.contractId),
  ).toBe(true);
  expect(preview.occupancy).toHaveLength(1);
  expect(
    await testApp.database
      .repository('hylLeases')
      .count({ filter: { id: c.id } }),
  ).toBe(0);
});
