// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
} from '@nocobase/app-plugin-authentication/testing';
import { createStandaloneServer } from '../../server/standalone.js';
import type { Row } from '../../server/hyl/schema.js';
const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    logging: { enabled: false },
  },
});
test('generates unique contract numbers and preserves generated and legacy identity on edit', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const send = async (path: string, body: unknown, method = 'POST') => {
    const response = await admin.fetch(path, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(method === 'POST' ? 201 : 200);
    return ((await response.json()) as { data: Row }).data;
  };
  const merchant = await send('/merchants', {
    name: '合同编号测试',
    unit: 'A1',
    contact: '张三',
    phone: '123',
    accountName: '张三',
    bank: '银行',
    account: '123',
  });
  const values = {
    title: '合同名称搜索验收甲',
    merchantId: merchant.id,
    start: '2026-10-01',
    end: '2026-10-31',
    cycle: 'month',
    method: 'fixed',
    basis: 'receipts',
    rate: '0',
    fixedFee: '100',
    minimum: '0',
    rent: '0',
    includeActivity: true,
    includeCash: true,
    includeHospitality: false,
  };
  const [first, second] = await Promise.all([
    send('/contracts', values),
    send('/contracts', {
      ...values,
      number: 'manual-number',
      title: '',
      start: '2026-11-01',
      end: '2026-11-30',
    }),
  ]);
  expect(first.number).toMatch(/^HT[0-9A-F]{24}$/);
  expect(second.number).toMatch(/^HT[0-9A-F]{24}$/);
  expect(first.number).not.toBe(second.number);
  expect(first.payload.number).toBe(first.number);
  const search = async (q: string) => {
    const response = await admin.fetch('/contracts?q=' + encodeURIComponent(q));
    expect(response.status).toBe(200);
    return ((await response.json()) as { data: Row[] }).data;
  };
  expect((await search('合同名称搜索验收甲')).map((r) => r.id)).toEqual([
    first.id,
  ]);
  expect((await search(first.number)).map((r) => r.id)).toEqual([first.id]);
  expect((await search(merchant.name)).map((r) => r.id)).toEqual(
    expect.arrayContaining([first.id, second.id]),
  );

  const edited = await send(
    `/contracts/${first.id}`,
    {
      expectedVersion: first.version,
      values: { ...first.payload, number: 'tampered', notes: '修改备注' },
    },
    'PATCH',
  );
  expect(edited.number).toBe(first.number);
  expect(edited.payload).toMatchObject({
    number: first.number,
    notes: '修改备注',
  });
  await testApp.database.repository('hylContracts').updateOne({
    filter: { id: second.id },
    values: {
      number: 'OLD-CONTRACT-001',
      payload: { ...second.payload, number: 'OLD-CONTRACT-001' },
    },
  });
  const { number: ignoredNumber, ...legacyValues } = second.payload;
  void ignoredNumber;
  const legacy = await send(
    `/contracts/${second.id}`,
    { expectedVersion: second.version, values: legacyValues },
    'PATCH',
  );
  expect(legacy.number).toBe('OLD-CONTRACT-001');
  expect(legacy.payload.number).toBe('OLD-CONTRACT-001');
});
