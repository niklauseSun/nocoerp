// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
} from '@nocobase/app-plugin-authentication/testing';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server';
import { authorizationToken } from '@nocobase/app-plugin-authorization';
import { definePermissionSet } from '@nocobase/authorization';
import { defineRecordAccess } from '@nocobase/authorization/core';
import { buildFilter } from '@nocobase/repository-input';
import { resources } from '../../server/hyl/resources.js';
import { createStandaloneServer } from '../../server/standalone.js';
const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    logging: { enabled: false },
  },
});
test('combined invoice requires all member scopes, exact totals and action permissions', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  async function call(
    path: string,
    body?: unknown,
    method = body ? 'POST' : 'GET',
    expected = 200,
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
    if (r.status !== expected) throw Error(JSON.stringify(json));
    expect(r.status).toBe(expected);
    return json.data;
  }
  const m = await call(
      '/merchants',
      {
        name: 'Invoice scope test',
        unit: 'I',
        contact: 'test',
        phone: '0',
        bank: 'test',
        accountName: 'test',
        account: '0',
      },
      'POST',
      201,
    ),
    contracts: any[] = [],
    sources: any[] = [];
  for (let i = 0; i < 2; i++) {
    const contract = await call(
      '/contracts',
      {
        merchantId: m.id,
        title: 'Scope ' + i,
        start: i ? '2026-11-01' : '2026-10-01',
        end: i ? '2026-11-30' : '2026-10-31',
        cycle: 'month',
        method: 'fixed',
        basis: 'receipts',
        rate: '0',
        fixedFee: '0',
        minimum: '0',
        rent: '100',
        depositTarget: '0',
        includeActivity: true,
        includeCash: true,
        includeHospitality: false,
      },
      'POST',
      201,
    );
    contracts.push(contract);
    const party = { type: 'company', name: 'Scope demo', taxNo: 'SIM-ID' };
    await call(
      `/contracts/${contract.id}/invoiceConfig`,
      {
        requestId: randomUUID(),
        expectedVersion: 0,
        values: {
          enabled: true,
          autoIssue: false,
          buyer: party,
          seller: party,
          fees: [{ feeType: 'rent', taxItemName: 'rent', rate: '6' }],
        },
      },
      'PUT',
    );
    await call(
      `/contracts/${contract.id}/billingConfig`,
      {
        requestId: randomUUID(),
        expectedVersion: 0,
        effectiveFrom: i ? '2026-11-01' : '2026-10-01',
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
        month: i ? '2026-11' : '2026-10',
        part: 'month',
        dueDate: i ? '2026-11-30' : '2026-10-31',
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
    const receipt = await call(
      '/receipts',
      {
        requestId: randomUUID(),
        contractId: contract.id,
        expectedLeaseVersion: 0,
        date: '2026-10-18',
        amount: '100',
        method: 'bank',
        reference: randomUUID(),
        evidence: 'test',
      },
      'POST',
      201,
    );
    await call(`/receipts/${receipt.id}/allocate`, {
      requestId: randomUUID(),
      expectedVersion: receipt.version,
      allocations: [
        { billId: bill.id, expectedBillVersion: bill.version, amount: '100' },
      ],
    });
    sources.push((await call('/invoiceSources?contractId=' + contract.id))[0]);
  }
  const values = {
      sources: sources.map((s) => ({
        sourceId: s.id,
        amounts: s.payload.lines.map((l: any) => ({
          billLineId: l.id,
          gross: '100',
        })),
      })),
      result: 'success',
      failureReason: '',
      notes: '',
    },
    preview = await call('/invoices/preview', values),
    input = {
      ...values,
      requestId: randomUUID(),
      expectedSources: preview.expectedSources,
      previewHash: preview.previewHash,
    };
  const competing = [input, { ...input, requestId: randomUUID() }];
  const race = await Promise.all(
    competing.map(async (body) => {
      const response = await admin.fetch('/invoices', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost',
        },
        body: JSON.stringify(body),
      });
      return {
        status: response.status,
        json: (await response.json()) as any,
        body,
      };
    }),
  );
  expect(race.map((r) => r.status).sort()).toEqual([200, 409]);
  const winner = race.find((r) => r.status === 200)!;
  input.requestId = winner.body.requestId;
  const issued = winner.json.data;

  expect(issued.invoice.grossCents).toBe('20000');
  expect(await call('/invoices', input)).toEqual(issued);
  await call('/invoices', { ...input, notes: 'different' }, 'POST', 409);
  await call('/invoices', { ...input, requestId: randomUUID() }, 'POST', 409);
  const users = testApp.application.container.resolve(
      userManagementServiceToken,
    ),
    authz = testApp.application.container.resolve(authorizationToken),
    password = randomBytes(24).toString('hex'),
    user = await users.create({
      name: 'Invoice limited',
      email: randomUUID() + '@example.test',
      password,
    });
  const denied = await signIn(testApp, { email: user.email, password });
  expect((await denied.fetch('/invoices')).status).toBe(403);
  authz.recordAccess.define(
    defineRecordAccess('invoice.onlyA', (a) =>
      a
        .title({ key: 'invoice.title', ns: 'nocoerp' })
        .collections('hylContracts')
        .resolver(async () =>
          buildFilter((f) => f.string('id').eq(contracts[0].id)),
        ),
    ),
  );
  await authz.permissionSets.create(
    definePermissionSet('invoice-limited')
      .grant(
        resources.contracts.reference().grant({
          invoiceRead: { records: 'invoice.onlyA' },
          read: { records: 'invoice.onlyA' },
          billingRead: { records: 'invoice.onlyA' },
        }),
      )
      .build(),
  );
  await authz.permissionSets.assign({
    permissionSet: 'invoice-limited',
    subject: { type: 'user', id: user.id },
  });
  const limited = await signIn(testApp, { email: user.email, password }),
    visible = (await (await limited.fetch('/invoiceSources')).json()) as any;
  expect(visible.meta.total).toBe(1);
  expect(visible.data[0].allowedActions).toEqual(['invoiceRead']);
  const restrictedDetail = (await (
    await limited.fetch('/invoiceSources/' + sources[0].id)
  ).json()) as any;
  expect(restrictedDetail.data.cash).toMatchObject({
    data: [],
    restricted: true,
  });
  expect(restrictedDetail.data.deposits).toMatchObject({
    data: [],
    restricted: true,
  });
  expect((await limited.fetch('/invoiceSources/' + sources[1].id)).status).toBe(
    404,
  );
  expect((await limited.fetch('/invoices/' + issued.invoice.id)).status).toBe(
    404,
  );
  const listed = (await (await limited.fetch('/invoices')).json()) as any;
  expect(listed.meta.total).toBe(0);
  expect(listed.data).toEqual([]);
  expect(
    (
      await limited.fetch('/invoices/preview', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost',
        },
        body: JSON.stringify({ ...values, sources: [values.sources[0]] }),
      })
    ).status,
  ).toBe(403);
  await authz.permissionSets.create(
    definePermissionSet('invoice-config-only')
      .grant(
        resources.contracts.reference().grant({
          invoiceConfigure: { records: 'invoice.onlyA' },
          read: { records: 'invoice.onlyA' },
        }),
      )
      .build(),
  );
  const configUser = await users.create({
    name: 'Invoice config only',
    email: randomUUID() + '@example.test',
    password,
  });
  await authz.permissionSets.assign({
    permissionSet: 'invoice-config-only',
    subject: { type: 'user', id: configUser.id },
  });
  const configOnly = await signIn(testApp, {
    email: configUser.email,
    password,
  });
  const infoResponse = await configOnly.fetch(
    '/contracts/' + contracts[0].id + '/invoiceConfig',
  );
  expect(infoResponse.status).toBe(200);
  const info = (await infoResponse.json()) as any;
  expect(info.data.allowedActions).toEqual(['invoiceConfigure']);
  const configSave = await configOnly.fetch(
    '/contracts/' + contracts[0].id + '/invoiceConfig',
    {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify({
        requestId: randomUUID(),
        expectedVersion: info.data.config.version,
        values: { ...info.data.config.payload, autoIssue: false },
      }),
    },
  );
  expect(configSave.status).toBe(200);
  expect((await configOnly.fetch('/invoiceSources')).status).toBe(403);
});
