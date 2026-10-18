import { authorizationToken } from '@nocobase/app-plugin-authorization';
import { definePermissionSet } from '@nocobase/authorization/permission-sets';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { assetResource } from '../../server/assets/resources.js';
import { energyResource } from '../../server/energy/resources.js';
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
test('meter assignment, reviewed water/electricity, bill source reservation and release', async ({
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
    const r = await admin.fetch(path, {
        method,
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      json = (await r.json()) as any;
    if (r.status !== status)
      throw Error(path + ':' + r.status + ' ' + JSON.stringify(json));
    return json.data;
  }
  expect((await request('/energyMeters')).status).toBe(401);
  const project = await call(
      '/assets',
      { name: 'Energy project', type: 'project' },
      'POST',
      201,
    ),
    street = await call(
      '/assets',
      { name: 'Energy street', type: 'street', parentId: project.id },
      'POST',
      201,
    ),
    asset = await call(
      '/assets',
      {
        name: 'Energy unit',
        type: 'unit',
        parentId: street.id,
        area: '10',
        lettableArea: '10',
      },
      'POST',
      201,
    );
  const merchant = await call(
    '/merchants',
    {
      name: 'Energy merchant',
      unit: 'E',
      contact: 'test',
      phone: '0',
      bank: 'test',
      accountName: 'test',
      account: '0',
    },
    'POST',
    201,
  );
  await call(
    '/merchants/' + merchant.id + '/assets',
    {
      requestId: randomUUID(),
      assetId: asset.id,
      start: '2026-10-01',
      end: '2026-10-31',
      area: '10',
    },
    'POST',
    201,
  );
  const contract = await call(
    '/contracts',
    {
      merchantId: merchant.id,
      title: 'Energy lease',
      assetIds: [asset.id],
      start: '2026-10-01',
      end: '2026-10-31',
      cycle: 'month',
      method: 'fixed',
      basis: 'receipts',
      rate: '0',
      fixedFee: '0',
      minimum: '0',
      rent: '0',
      depositTarget: '0',
      includeActivity: true,
      includeCash: true,
      includeHospitality: false,
    },
    'POST',
    201,
  );
  const sources = [];
  const meters = [];
  for (const type of ['water', 'electricity']) {
    let meter = await call('/energyMeters', {
      code: type,
      name: type,
      type,
      assetId: asset.id,
      installedOn: '2026-10-01',
      openingReading: type === 'water' ? '100' : '1000',
      multiplier: type === 'water' ? '1' : '2',
      openingEvidence: 'test',
      requestId: randomUUID(),
    });
    meters.push(meter);
    const values = {
        contractId: contract.id,
        start: '2026-10-01',
        openingReading: type === 'water' ? '100' : '1000',
        evidence: 'test',
      },
      preview = await call('/energyMeters/' + meter.id + '/previewAssignment', {
        requestId: randomUUID(),
        values,
      });
    const assignment = await call(
      '/energyMeters/' + meter.id + '/assignments',
      {
        requestId: randomUUID(),
        expectedVersion: meter.version,
        previewHash: preview.previewHash,
        values,
      },
    );
    let reading = await call('/energyReadings', {
      requestId: randomUUID(),
      values: {
        meterId: meter.id,
        assignmentId: assignment.id,
        start: '2026-10-01',
        end: '2026-10-31',
        current: type === 'water' ? '130' : '1120',
        evidence: 'test',
      },
    });
    reading = await call('/energyReadings/' + reading.id + '/submit', {
      requestId: randomUUID(),
      expectedVersion: reading.version,
    });
    reading = await call('/energyReadings/' + reading.id + '/approve', {
      requestId: randomUUID(),
      expectedVersion: reading.version,
    });
    sources.push(reading);
  }
  await call(
    '/contracts/' + contract.id + '/billingConfig',
    {
      requestId: randomUUID(),
      expectedVersion: 0,
      effectiveFrom: '2026-10-01',
      rentChannel: 'bill',
      property: { enabled: false, method: 'fixed', price: '0' },
      utilities: { water: '5', electricity: '0.8' },
      meters: [],
    },
    'PUT',
  );
  const values = {
      contractId: contract.id,
      month: '2026-10',
      part: 'month',
      dueDate: '2026-10-31',
      readingIds: sources.map((r) => r.id),
    },
    preview = await call('/energyBilling/preview', {
      requestId: randomUUID(),
      values,
    });
  expect(preview.amountCents).toBe('34200');
  expect(preview.lines.map((r: any) => r.amountCents).sort()).toEqual([
    '15000',
    '19200',
  ]);
  let op = {
    requestId: randomUUID(),
    previewHash: preview.previewHash,
    values,
  };
  const competing = [op, { ...op, requestId: randomUUID() }];
  const attempts = await Promise.all(
    competing.map(async (body) => {
      const response = await admin.fetch('/energyBilling', {
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
  expect(attempts.filter((r) => r.status === 200)).toHaveLength(1);
  expect(attempts.filter((r) => [400, 409].includes(r.status))).toHaveLength(1);
  const winner = attempts.find((r) => r.status === 200)!;
  op = winner.body;
  let bill = winner.json.data;
  expect(bill.amountCents).toBe('34200');
  expect((await call('/energyBilling', op)).id).toBe(bill.id);
  expect((await call('/energyReadings/' + sources[0].id)).billingStatus).toBe(
    'reserved',
  );
  await call(
    '/energyReadings/' + sources[0].id + '/void',
    {
      requestId: randomUUID(),
      expectedVersion: sources[0].version,
      reason: 'test',
    },
    'POST',
    400,
  );
  const beforeEdit = await call('/bills/' + bill.id),
    frozenIds = beforeEdit.lines.map((l: any) => l.id).sort(),
    originalInput = bill.payload.input;
  bill = await call(
    '/bills/' + bill.id,
    {
      ...originalInput,
      fees: [...originalInput.fees, 'other'],
      others: [
        {
          title: 'Extra service',
          amount: '5',
          reference: 'extra-test',
          reason: 'test',
          evidence: 'test',
        },
      ],
      configVersion: bill.payload.configVersion,
      requestId: randomUUID(),
      expectedVersion: bill.version,
    },
    'PATCH',
  );
  expect(bill.amountCents).toBe('34700');
  bill = await call(
    '/bills/' + bill.id,
    {
      ...originalInput,
      configVersion: bill.payload.configVersion,
      requestId: randomUUID(),
      expectedVersion: bill.version,
    },
    'PATCH',
  );
  expect(bill.amountCents).toBe('34200');
  expect(
    (await call('/bills/' + bill.id)).lines.map((l: any) => l.id).sort(),
  ).toEqual(frozenIds);
  bill = await call('/bills/' + bill.id + '/issue', {
    requestId: randomUUID(),
    expectedVersion: bill.version,
  });
  expect((await call('/energyReadings/' + sources[0].id)).billingStatus).toBe(
    'issued',
  );
  await call('/bills/' + bill.id + '/void', {
    requestId: randomUUID(),
    expectedVersion: bill.version,
    reason: 'test',
    evidence: 'test',
  });
  expect((await call('/energyReadings/' + sources[0].id)).billingStatus).toBe(
    'released',
  );
  const revised = await call('/energyBilling/preview', {
    requestId: randomUUID(),
    values,
  });
  expect(revised.amountCents).toBe('34200');

  const retryBill = await call('/energyBilling', {
    requestId: randomUUID(),
    previewHash: revised.previewHash,
    values,
  });
  let payable = await call('/bills/' + retryBill.id + '/issue', {
    requestId: randomUUID(),
    expectedVersion: retryBill.version,
  });
  const collect = async (amount: string) => {
    const lease = await call('/contracts/' + contract.id + '/leaseSummary');
    const order = await call('/cashierOrders', {
      requestId: randomUUID(),
      merchantId: merchant.id,
      date: '2026-10-31',
      targets: [
        {
          billId: payable.id,
          contractId: contract.id,
          expectedBillVersion: payable.version,
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
          evidence: 'simulation',
          splits: [{ contractId: contract.id, amount }],
        },
      ],
    });
    await call('/cashierOrders/' + order.id + '/post', {
      requestId: randomUUID(),
      expectedVersion: order.version,
      reason: 'simulation',
      evidence: 'simulation',
    });
    payable = await call('/bills/' + payable.id);
  };
  await collect('100');
  expect(payable.remainingCents).toBe('24200');
  expect(payable.allocatedCents).toBe('10000');
  await collect('242');
  expect(payable.remainingCents).toBe('0');
  expect(payable.allocatedCents).toBe('34200');
  // Closing at an earlier date cannot discard approved consumption.
  const early = await call(
    '/contracts/' + contract.id + '/terminationPreview',
    { actualEnd: '2026-10-20', closing: true },
  );
  expect(early.blockers.some((b: any) => b.status === 'readingAfterEnd')).toBe(
    true,
  );
  // Replacement: hand over the reviewed final reading and stop only after its source is issued.
  const oldMeter = await call('/energyMeters/' + meters[0].id),
    oldAssignment = oldMeter.assignments.data[0];
  const handoverValues = {
    assignmentId: oldAssignment.id,
    end: '2026-10-31',
    readingId: sources[0].id,
    evidence: 'handover simulation',
  };
  const hp = await call('/energyMeters/' + oldMeter.id + '/previewHandover', {
    requestId: randomUUID(),
    values: handoverValues,
  });
  await call('/energyMeters/' + oldMeter.id + '/handover', {
    requestId: randomUUID(),
    expectedVersion: oldMeter.version,
    previewHash: hp.previewHash,
    values: handoverValues,
  });
  const closedMeter = await call('/energyMeters/' + oldMeter.id),
    sv = { end: '2026-10-31', reason: 'replacement', evidence: 'simulation' },
    sp = await call('/energyMeters/' + oldMeter.id + '/previewStop', {
      requestId: randomUUID(),
      values: sv,
    });
  const stopped = await call('/energyMeters/' + oldMeter.id + '/stop', {
    requestId: randomUUID(),
    expectedVersion: closedMeter.version,
    previewHash: sp.previewHash,
    values: sv,
  });
  expect(stopped.status).toBe('stopped');
  await call(
    '/energyReadings',
    {
      requestId: randomUUID(),
      values: {
        meterId: oldMeter.id,
        start: '2026-11-01',
        end: '2026-11-01',
        current: '131',
        evidence: 'invalid stopped',
      },
    },
    'POST',
    400,
  );
  const replacement = await call('/energyMeters', {
    code: 'replacement',
    name: 'replacement',
    type: 'water',
    assetId: asset.id,
    installedOn: '2026-11-01',
    openingReading: '0',
    multiplier: '1',
    openingEvidence: 'replacement simulation',
    requestId: randomUUID(),
  });
  expect(replacement.status).toBe('active');
  // Zero usage and rejected/incomplete drafts remain explicit coverage records.
  const zeroMeter = await call('/energyMeters', {
    code: 'zero',
    name: 'zero',
    type: 'water',
    assetId: asset.id,
    installedOn: '2026-10-01',
    openingReading: '0',
    multiplier: '1',
    openingEvidence: 'test',
    requestId: randomUUID(),
  });
  const zv = {
      contractId: contract.id,
      start: '2026-10-01',
      openingReading: '0',
      evidence: 'test',
    },
    zp = await call('/energyMeters/' + zeroMeter.id + '/previewAssignment', {
      requestId: randomUUID(),
      values: zv,
    }),
    za = await call('/energyMeters/' + zeroMeter.id + '/assignments', {
      requestId: randomUUID(),
      expectedVersion: zeroMeter.version,
      previewHash: zp.previewHash,
      values: zv,
    });
  const rv = {
    meterId: zeroMeter.id,
    assignmentId: za.id,
    start: '2026-10-01',
    end: '2026-10-31',
    current: null,
    evidence: '',
  };
  let zr = await call('/energyReadings', {
    requestId: randomUUID(),
    values: rv,
  });
  await call(
    '/energyReadings/' + zr.id + '/submit',
    { requestId: randomUUID(), expectedVersion: zr.version },
    'POST',
    400,
  );
  zr = await call(
    '/energyReadings/' + zr.id,
    {
      requestId: randomUUID(),
      expectedVersion: zr.version,
      values: { ...rv, current: '0', evidence: 'test' },
    },
    'PATCH',
  );
  zr = await call('/energyReadings/' + zr.id + '/submit', {
    requestId: randomUUID(),
    expectedVersion: zr.version,
  });
  zr = await call('/energyReadings/' + zr.id + '/reject', {
    requestId: randomUUID(),
    expectedVersion: zr.version,
    reason: 'recheck evidence',
  });
  zr = await call('/energyReadings/' + zr.id + '/submit', {
    requestId: randomUUID(),
    expectedVersion: zr.version,
  });
  zr = await call('/energyReadings/' + zr.id + '/approve', {
    requestId: randomUUID(),
    expectedVersion: zr.version,
  });
  const zvalues = {
    contractId: contract.id,
    month: '2026-10',
    part: 'month',
    dueDate: '2026-10-31',
    readingIds: [zr.id],
  };
  const needsEvidence = await call('/energyBilling/preview', {
    requestId: randomUUID(),
    values: zvalues,
  });
  expect(needsEvidence.canGenerate).toBe(false);
  expect(needsEvidence.lines).toHaveLength(1);
  const validZero = {
      ...zvalues,
      zeroReason: 'closed for business',
      zeroEvidence: 'photo',
    },
    confirmedZero = await call('/energyBilling/preview', {
      requestId: randomUUID(),
      values: validZero,
    });
  const zeroBill = await call('/energyBilling', {
    requestId: randomUUID(),
    values: validZero,
    previewHash: confirmedZero.previewHash,
  });
  await call('/bills/' + zeroBill.id + '/issue', {
    requestId: randomUUID(),
    expectedVersion: zeroBill.version,
  });
  expect((await call('/energyReadings/' + zr.id)).billingStatus).toBe('issued');
  const final = await call(
    '/contracts/' + contract.id + '/terminationPreview',
    { actualEnd: '2026-10-31', closing: true },
  );
  expect(
    final.blockers.filter(
      (b: any) =>
        b.kind === 'billingCoverage' &&
        ['water', 'electricity'].includes(b.feeType),
    ),
  ).toEqual([]);

  const legacyContract = await call(
    '/contracts',
    {
      merchantId: merchant.id,
      title: 'Legacy half-month lease',
      assetIds: [asset.id],
      start: '2026-11-01',
      end: '2026-11-30',
      cycle: 'half',
      method: 'fixed',
      basis: 'receipts',
      rate: '0',
      fixedFee: '0',
      minimum: '0',
      rent: '0',
      depositTarget: '0',
      includeActivity: true,
      includeCash: true,
      includeHospitality: false,
    },
    'POST',
    201,
  );
  await call(
    '/contracts/' + legacyContract.id + '/billingConfig',
    {
      requestId: randomUUID(),
      expectedVersion: 0,
      effectiveFrom: '2026-11-01',
      rentChannel: 'settlement',
      property: { enabled: false, method: 'fixed', price: '0' },
      utilities: { water: '5' },
      meters: [
        {
          assetId: asset.id,
          meterCode: 'LEGACY-W',
          feeType: 'water',
          activeFrom: '2026-11-01',
          openingReading: '20',
          openingEvidence: 'installation',
          stopEvidence: '',
        },
      ],
    },
    'PUT',
  );
  const legacyValues = {
    contractId: legacyContract.id,
    requestId: randomUUID(),
    expectedContractVersion: legacyContract.version,
    configVersion: 1,
    month: '2026-11',
    part: 'first',
    dueDate: '2026-11-15',
    fees: ['water'],
    readings: [
      {
        assetId: asset.id,
        meterCode: 'LEGACY-W',
        feeType: 'water',
        start: '2026-11-01',
        end: '2026-11-15',
        previous: '20',
        current: '30',
        multiplier: '1',
        evidence: 'legacy',
      },
    ],
    others: [],
    acknowledgeGaps: false,
    notes: '',
    zeroReason: '',
    zeroEvidence: '',
  };
  let legacyBill = await call('/bills', legacyValues, 'POST', 201);
  legacyBill = await call('/bills/' + legacyBill.id + '/issue', {
    requestId: randomUUID(),
    expectedVersion: legacyBill.version,
  });
  expect(legacyBill.amountCents).toBe('5000');
  const candidates = await call(
    '/energyLegacyMeters?contractId=' + legacyContract.id,
  );
  expect(candidates[0].openingReading).toBe('30');
  expect(candidates[0].start).toBe('2026-11-16');
  const adoption = {
    contractId: legacyContract.id,
    assetId: asset.id,
    meterCode: 'LEGACY-W',
    feeType: 'water',
    name: 'Adopted legacy water',
    start: '2026-11-16',
    openingReading: '30',
    multiplier: '1',
    evidence: 'handover',
  };
  const adoptionPreview = await call('/energyMeters/previewAdoption', {
    requestId: randomUUID(),
    values: adoption,
  });
  const adopted = await call('/energyMeters/adopt', {
    requestId: randomUUID(),
    previewHash: adoptionPreview.previewHash,
    values: adoption,
  });
  await call(
    '/bills',
    {
      ...legacyValues,
      requestId: randomUUID(),
      part: 'second',
      dueDate: '2026-11-30',
      readings: [
        {
          ...legacyValues.readings[0],
          start: '2026-11-16',
          end: '2026-11-30',
          previous: '30',
          current: '40',
        },
      ],
    },
    'POST',
    400,
  );
  const adoptedDetail = await call('/energyMeters/' + adopted.id),
    adoptedAssignment = adoptedDetail.assignments.data[0];
  let adoptedReading = await call('/energyReadings', {
    requestId: randomUUID(),
    values: {
      meterId: adopted.id,
      assignmentId: adoptedAssignment.id,
      start: '2026-11-16',
      end: '2026-11-30',
      current: '40',
      evidence: 'test',
    },
  });
  adoptedReading = await call(
    '/energyReadings/' + adoptedReading.id + '/submit',
    { requestId: randomUUID(), expectedVersion: adoptedReading.version },
  );
  adoptedReading = await call(
    '/energyReadings/' + adoptedReading.id + '/approve',
    { requestId: randomUUID(), expectedVersion: adoptedReading.version },
  );
  const adoptedValues = {
      contractId: legacyContract.id,
      month: '2026-11',
      part: 'second',
      dueDate: '2026-11-30',
      readingIds: [adoptedReading.id],
    },
    adoptedPreview = await call('/energyBilling/preview', {
      requestId: randomUUID(),
      values: adoptedValues,
    });
  expect(adoptedPreview.amountCents).toBe('5000');
  expect((await call('/bills/' + legacyBill.id)).amountCents).toBe('5000');

  const users = testApp.application.container.resolve(
      userManagementServiceToken,
    ),
    authz = testApp.application.container.resolve(authorizationToken),
    password = randomBytes(24).toString('hex');
  const denied = await users.create({
    name: 'No energy role',
    email: randomUUID() + '@example.test',
    password,
  });
  const deniedSession = await signIn(testApp, {
    email: denied.email,
    password,
  });
  expect((await deniedSession.fetch('/energyMeters')).status).toBe(403);
  const reader = await users.create({
    name: 'Meter only',
    email: randomUUID() + '@example.test',
    password,
  });
  await authz.permissionSets.create(
    definePermissionSet('energy-reader')
      .grant(
        energyResource.reference().grant({
          meterRead: { assets: 'allRecords' },
          readingRead: { assets: 'allRecords' },
        }),
      )
      .grant(
        assetResource.reference().grant({ read: { records: 'allRecords' } }),
      )
      .build(),
  );
  await authz.permissionSets.assign({
    permissionSet: 'energy-reader',
    subject: { type: 'user', id: reader.id },
  });
  const scoped = await signIn(testApp, { email: reader.email, password });
  expect((await scoped.fetch('/energyMeters')).status).toBe(200);
  const hidden = (await (await scoped.fetch('/energyReadings')).json()) as any;
  expect(hidden.data).toEqual([]);
  expect(hidden.meta.total).toBe(0);
  expect((await scoped.fetch('/energyReadings/' + sources[0].id)).status).toBe(
    403,
  );
  const mutation = await scoped.fetch('/energyReadings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify({
      requestId: randomUUID(),
      values: {
        meterId: replacement.id,
        start: '2026-11-01',
        end: '2026-11-01',
        current: '1',
        evidence: 'test',
      },
    }),
  });
  expect(mutation.status).toBe(403);
  const swagger = await admin.fetch('/swagger');
  expect(swagger.status).toBe(200);
}, 60000);
