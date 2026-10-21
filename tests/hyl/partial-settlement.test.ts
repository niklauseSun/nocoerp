// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
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

test('settles only the contract intersection, prorates boundary periods and rejects invalid or repeated windows', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const post = async (path: string, values: unknown) => {
    const response = await admin.fetch(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(values),
    });
    const body = (await response.json()) as { data: Row };
    expect(response.status).toBeLessThan(300);
    return body.data;
  };
  for (const scenario of [
    {
      start: '2026-10-17',
      end: '2026-11-10',
      month: '2026-10',
      part: 'month',
      cycle: 'month',
      from: '2026-10-17',
      to: '2026-10-31',
      fee: '150.00',
      rent: '1500.00',
    },
    {
      start: '2026-10-17',
      end: '2026-11-10',
      month: '2026-11',
      part: 'month',
      cycle: 'month',
      from: '2026-11-01',
      to: '2026-11-10',
      fee: '103.33',
      rent: '1033.33',
    },
    {
      start: '2026-10-20',
      end: '2026-10-25',
      month: '2026-10',
      part: 'second',
      cycle: 'half',
      from: '2026-10-20',
      to: '2026-10-25',
      fee: '60.00',
      rent: '600.00',
    },
    {
      start: '2026-10-10',
      end: '2026-11-10',
      month: '2026-10',
      part: 'first',
      cycle: 'half',
      from: '2026-10-10',
      to: '2026-10-15',
      fee: '60.00',
      rent: '600.00',
    },
    {
      start: '2028-02-29',
      end: '2028-02-29',
      month: '2028-02',
      part: 'second',
      cycle: 'half',
      from: '2028-02-29',
      to: '2028-02-29',
      fee: '10.69',
      rent: '106.90',
    },
  ]) {
    const merchant = await post('/merchants', {
      name: `Partial period ${randomUUID()}`,
      unit: 'Test',
      contact: 'Test',
      phone: '00000000000',
      accountName: 'Test',
      bank: 'Test',
      account: '0000',
    });
    const contract = await post('/contracts', {
      merchantId: merchant.id,
      start: scenario.start,
      end: scenario.end,
      cycle: scenario.cycle,
      method: 'fixed',
      basis: 'receipts',
      rate: '0',
      fixedFee: '310',
      minimum: '0',
      rent: '3100',
      includeActivity: true,
      includeCash: true,
      includeHospitality: false,
    });
    let revenue = await post('/revenueReports', {
      merchantId: merchant.id,
      date: scenario.from,
      source: 'cash',
      reference: randomUUID(),
      receipts: '5000',
      refunds: '100',
      activity: '50',
      cash: '20',
      hospitality: '30',
      collected: '4900',
      evidence: 'Test',
    });
    revenue = await post(`/revenueReports/${revenue.id}/submit`, {
      expectedVersion: revenue.version,
    });
    await post(`/revenueReports/${revenue.id}/approve`, {
      expectedVersion: revenue.version,
    });
    // Imported/legacy drafts outside the effective interval must neither block nor be claimed.
    const outsideId = randomUUID();
    await testApp.database.repository('hylRevenueReports').createOne({
      values: {
        ...revenue,
        id: outsideId,
        number: randomUUID(),
        date: '2026-10-01',
        settlementId: null,
      },
    });
    const input = {
      merchantId: merchant.id,
      contractId: contract.id,
      month: scenario.month,
      part: scenario.part,
    };
    for (const invalid of [
      { ...input, month: '2025-01' },
      { ...input, part: scenario.cycle === 'month' ? 'first' : 'month' },
    ]) {
      const response = await admin.fetch('/settlements', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost',
        },
        body: JSON.stringify(invalid),
      });
      expect(response.status).toBe(400);
    }
    const settlement = await post('/settlements', input);
    expect(settlement.payload).toMatchObject({
      start: scenario.from,
      end: scenario.to,
      amounts: { collected: '4900.00', fee: scenario.fee, rent: scenario.rent },
    });
    expect((settlement.payload.revenues as Row[]).map((row) => row.id)).toEqual(
      [revenue.id],
    );
    expect(
      await testApp.database
        .repository('hylRevenueReports')
        .findOne({ filter: { id: outsideId } }),
    ).toMatchObject({ settlementId: null });
    const duplicate = await admin.fetch('/settlements', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(input),
    });
    expect(duplicate.status).toBe(409);
  }
});
