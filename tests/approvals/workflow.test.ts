import { approvalToken } from '../../server/providers/approvals.js';
import { hylToken } from '../../server/providers/hyl.js';
import { buildFilter } from '@nocobase/repository-input';
// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
} from '@nocobase/app-plugin-authentication/testing';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { authorizationToken } from '@nocobase/app-plugin-authorization';
import { definePermissionSet } from '@nocobase/authorization/permission-sets';
import { createStandaloneServer } from '../../server/standalone.js';
import { approvalResource } from '../../server/approvals/resources.js';
import { assetResource } from '../../server/assets/resources.js';
import { resources } from '../../server/hyl/resources.js';
import { procurementResource } from '../../server/procurement/resources.js';
const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    logging: { enabled: false },
  },
});
test('sequential approvals freeze rules and source, reject/resubmit, gate all three domain effects and authenticate routes', async ({
  testApp,
  request,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS),
    users = testApp.application.container.resolve(userManagementServiceToken),
    authz = testApp.application.container.resolve(authorizationToken);
  async function call(
    path: string,
    body?: unknown,
    status = 200,
    session = admin,
    method = body ? 'POST' : 'GET',
  ): Promise<any> {
    const r = await session.fetch(path, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const j: any = await r.json();
    if (r.status !== status)
      throw Error(path + ':' + r.status + ' ' + JSON.stringify(j));
    return j.data;
  }
  for (const path of [
    '/approvalConfigs',
    '/approvalProjects',
    '/approvalPeople',
    '/approvalRequests',
    '/approvalRequests/' + randomUUID(),
    '/approvalSources/contracts/' + randomUUID(),
  ])
    expect((await request(path)).status).toBe(401);
  const identities = [];
  for (const name of ['applicant', 'first', 'second']) {
    const password = randomBytes(24).toString('hex'),
      u = await users.create({
        name,
        email: randomUUID() + '@example.test',
        password,
      });
    identities.push({
      u,
      password,
      session: await signIn(testApp, { email: u.email, password }),
    });
  }
  const [a, one, two] = identities;
  await call('/approvalRequests', undefined, 403, a.session);
  const grants = definePermissionSet('approval-test')
    .grant(
      approvalResource.reference().grant({
        read: { assets: 'allRecords' },
        submit: { assets: 'allRecords' },
        decide: { assets: 'allRecords' },
      }),
    )
    .grant(
      assetResource.reference().grant({
        read: { records: 'allRecords' },
        write: { records: 'allRecords' },
      }),
    )
    .grant(
      resources.merchants
        .reference()
        .grant({ read: { records: 'allRecords' } }),
    )
    .grant(
      resources.contracts.reference().grant({
        read: { records: 'allRecords' },
        write: { records: 'allRecords' },
        billingRead: { records: 'allRecords' },
        billWrite: { records: 'allRecords' },
        billIssue: { records: 'allRecords' },
      }),
    )
    .grant(
      procurementResource.reference().grant({
        read: { assets: 'allRecords' },
        request: { assets: 'allRecords' },
        review: { assets: 'allRecords' },
      }),
    );
  await authz.permissionSets.create(grants.build());
  for (const x of identities)
    await authz.permissionSets.assign({
      permissionSet: 'approval-test',
      subject: { type: 'user', id: x.u.id },
    });
  const project = await call(
      '/assets',
      { name: 'Approval project', type: 'project' },
      201,
    ),
    street = await call(
      '/assets',
      { name: 'Approval street', type: 'street', parentId: project.id },
      201,
    ),
    asset = await call(
      '/assets',
      { name: 'Approval unit', type: 'unit', parentId: street.id, area: '20' },
      201,
    ),
    m = await call(
      '/merchants',
      {
        name: 'Approval merchant',
        unit: 'A',
        contact: 'A',
        phone: '0',
        accountName: 'A',
        bank: 'A',
        account: '0',
      },
      201,
    );
  const values = {
    enabled: true,
    levels: [
      { name: 'First', userIds: [one.u.id] },
      { name: 'Second', userIds: [two.u.id] },
    ],
  };
  const configure = async (kind: string, revision = 0, v = values) =>
    call('/approvalConfigs', {
      requestId: randomUUID(),
      expectedRevision: revision,
      projectId: project.id,
      kind,
      values: v,
    });
  await configure('contracts');
  const cv = {
    merchantId: m.id,
    title: 'Draft lease',
    start: '2026-10-17',
    end: '2027-10-16',
    cycle: 'month',
    method: 'fixed',
    basis: 'receipts',
    rate: '0',
    fixedFee: '0',
    minimum: '0',
    rent: '100',
    includeActivity: true,
    includeCash: true,
    includeHospitality: false,
    depositTarget: '300',
    assetIds: [asset.id],
  };
  let contract = await call('/contracts', cv, 201, a.session);
  expect(contract.status).toBe('draft');
  expect(contract.payload.depositTarget).toBe('300');
  const submit = async (kind: string, source: any, who = a.session) =>
    call(
      '/approvalRequests',
      {
        requestId: randomUUID(),
        kind,
        sourceId: source.id,
        expectedVersion: source.version,
        comment: 'Submit frozen document',
      },
      200,
      who,
    );
  const decide = async (
    r: any,
    action: string,
    who = one.session,
    status = 200,
  ) =>
    call(
      '/approvalRequests/' + r.id + '/actions',
      {
        requestId: randomUUID(),
        expectedVersion: r.version,
        action,
        comment: 'Review ' + action,
      },
      status,
      who,
    );
  let r = await submit('contracts', contract);
  expect(r.payload.stages).toHaveLength(2);
  await decide(r, 'approve', two.session, 403);
  await call(
    '/contracts/' + contract.id,
    { expectedVersion: contract.version, values: cv },
    400,
    a.session,
    'PATCH',
  );
  await configure('contracts', 1, {
    enabled: true,
    levels: [{ name: 'Changed', userIds: [two.u.id] }],
  });
  r = await decide(r, 'approve');
  expect(r.level).toBe(1);
  expect((await call('/contracts/' + contract.id)).status).toBe('draft');
  r = await decide(r, 'reject', two.session);
  expect(r.status).toBe('rejected');
  contract = await call(
    '/contracts/' + contract.id,
    {
      expectedVersion: contract.version,
      values: { ...cv, title: 'Amended lease' },
    },
    200,
    a.session,
    'PATCH',
  );
  r = await submit('contracts', contract);
  expect(r.round).toBe(2);
  expect(r.payload.stages[0].name).toBe('First');
  r = await decide(r, 'approve');
  const db = testApp.application.container.resolve(hylToken).db.connection();
  await db
    .repository('hylAssets')
    .updateMany({ filter: { id: asset.id }, values: { state: 'inactive' } });
  const beforeFailure = r.version,
    opKey = randomUUID(),
    eventCount = r.events.meta.total;
  await call(
    '/approvalRequests/' + r.id + '/actions',
    {
      requestId: opKey,
      expectedVersion: r.version,
      action: 'approve',
      comment: 'Activation must fail',
    },
    400,
    two.session,
  );
  expect((await call('/approvalRequests/' + r.id)).version).toBe(beforeFailure);
  expect((await call('/approvalRequests/' + r.id)).events.meta.total).toBe(
    eventCount,
  );
  expect(
    await db
      .repository('hylApprovalOperations')
      .exists({ filter: { id: opKey } }),
  ).toBe(false);
  await db
    .repository('hylAssets')
    .updateMany({ filter: { id: asset.id }, values: { state: 'normal' } });
  r = await decide(r, 'approve', two.session);
  expect(r.status).toBe('approved');
  contract = await call('/contracts/' + contract.id);
  expect(contract.status).toBe('active');
  await configure('bills');
  await call(
    '/contracts/' + contract.id + '/billingConfig',
    {
      requestId: randomUUID(),
      expectedVersion: 0,
      effectiveFrom: '2026-10-17',
      rentChannel: 'bill',
      property: { enabled: false, method: 'fixed', price: '0' },
      utilities: {},
      meters: [],
    },
    200,
    admin,
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
    201,
  );
  await call(
    '/bills/' + bill.id + '/issue',
    { requestId: randomUUID(), expectedVersion: bill.version },
    400,
  );
  r = await submit('bills', bill);
  r = await decide(r, 'approve');
  expect((await call('/bills/' + bill.id)).status).toBe('draft');
  r = await decide(r, 'approve', two.session);
  expect(r.status).toBe('approved');
  bill = await call('/bills/' + bill.id);
  expect(bill.status).toBe('issued');
  await configure('purchases');
  let purchase = await call(
    '/purchaseRequests',
    {
      requestId: randomUUID(),
      values: {
        title: 'Approval purchase',
        assetId: project.id,
        neededOn: '2026-10-31',
        reason: 'Parts',
        items: [{ name: 'Lamp', unit: 'each', quantity: 1, unitPrice: '10' }],
      },
    },
    200,
    a.session,
  );
  await call(
    '/purchaseRequests/' + purchase.id + '/actions',
    {
      requestId: randomUUID(),
      expectedVersion: purchase.version,
      action: 'submit',
      note: 'Legacy blocked',
    },
    400,
    a.session,
  );
  r = await submit('purchases', purchase);
  r = await decide(r, 'approve');
  await decide(r, 'reject', two.session);
  purchase = await call('/purchaseRequests/' + purchase.id);
  expect(purchase.status).toBe('draft');
  r = await submit('purchases', purchase);
  r = await decide(r, 'approve');
  await decide(r, 'approve', two.session);
  expect((await call('/purchaseRequests/' + purchase.id)).status).toBe(
    'approved',
  );
  const all = await call('/approvalRequests?view=all');
  expect(all).toHaveLength(3);
  await call(
    '/approvalConfigs/' + project.id + '/contracts',
    undefined,
    200,
    a.session,
  );
  const hyl = testApp.application.container.resolve(hylToken),
    c = hyl.db.connection();
  // A second same-level attempt cannot add another opinion or advance two levels.
  const extra = await call(
    '/purchaseRequests',
    {
      requestId: randomUUID(),
      values: {
        title: 'Concurrent review',
        assetId: project.id,
        neededOn: '2026-10-31',
        reason: 'Test',
        items: [{ name: 'Part', unit: 'each', quantity: 1, unitPrice: '2' }],
      },
    },
    200,
    a.session,
  );
  let concurrent = await submit('purchases', extra);
  const intent = {
    requestId: randomUUID(),
    expectedVersion: concurrent.version,
    action: 'approve',
    comment: 'Same request replay',
  };
  concurrent = await call(
    '/approvalRequests/' + concurrent.id + '/actions',
    intent,
    200,
    one.session,
  );
  expect(
    (
      await call(
        '/approvalRequests/' + concurrent.id + '/actions',
        intent,
        200,
        one.session,
      )
    ).version,
  ).toBe(concurrent.version);
  await call(
    '/approvalRequests/' + concurrent.id + '/actions',
    { ...intent, comment: 'Changed intent' },
    409,
    one.session,
  );
  expect(concurrent.events.meta.total).toBe(2);
  const service = testApp.application.container.resolve(approvalToken),
    candidateAccess = await service.accessFor(two.u.id);
  const assignment = (
    await authz.permissionSets.listAssignments('approval-test')
  ).find((x) => x.subject.id === two.u.id)!;
  await authz.permissionSets.revoke(assignment.id!);
  await call(
    '/approvalRequests/' + concurrent.id + '/actions',
    {
      requestId: randomUUID(),
      expectedVersion: concurrent.version,
      action: 'approve',
      comment: 'Permission was revoked',
    },
    403,
    two.session,
  );
  expect(
    (await call('/approvalRequests/' + concurrent.id)).events.meta.total,
  ).toBe(2);
  await authz.permissionSets.assign({
    permissionSet: 'approval-test',
    subject: { type: 'user', id: two.u.id },
  });
  await service.hyl.users.disable(two.u.id);
  await expect(
    service.decide(candidateAccess, concurrent.id, {
      requestId: randomUUID(),
      expectedVersion: concurrent.version,
      action: 'approve',
      comment: 'Disabled candidate',
    }),
  ).rejects.toMatchObject({ reason: 'APPROVAL_PERSON_INVALID' });
  await service.hyl.users.enable(two.u.id);
  two.session = await signIn(testApp, {
    email: two.u.email,
    password: two.password,
  });

  const failedKey = randomUUID();
  // A changed source cannot consume an approval opinion or operation key.
  const originalAmount = extra.amountCents;
  await c
    .repository('hylPurchaseRequests')
    .updateMany({ filter: { id: extra.id }, values: { amountCents: '999' } });
  await call(
    '/approvalRequests/' + concurrent.id + '/actions',
    {
      requestId: failedKey,
      expectedVersion: concurrent.version,
      action: 'approve',
      comment: 'Changed source',
    },
    409,
    two.session,
  );
  expect(
    (await call('/approvalRequests/' + concurrent.id)).events.meta.total,
  ).toBe(2);
  expect(
    await c
      .repository('hylApprovalOperations')
      .exists({ filter: { id: failedKey } }),
  ).toBe(false);
  await c.repository('hylPurchaseRequests').updateMany({
    filter: { id: extra.id },
    values: { amountCents: originalAmount },
  });
  const attempts = await Promise.all(
    [1, 2].map(() =>
      two.session.fetch('/approvalRequests/' + concurrent.id + '/actions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost',
        },
        body: JSON.stringify({
          requestId: randomUUID(),
          expectedVersion: concurrent.version,
          action: 'approve',
          comment: 'Concurrent final approval',
        }),
      }),
    ),
  );
  expect(attempts.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(
    (await call('/approvalRequests/' + concurrent.id)).events.meta.total,
  ).toBe(3);
  const otherProject = await call(
      '/assets',
      { name: 'Out of scope', type: 'project' },
      201,
    ),
    password = randomBytes(24).toString('hex'),
    limited = await users.create({
      name: 'Scoped reviewer',
      email: randomUUID() + '@example.test',
      password,
    }),
    selection = {
      type: 'recordAccess' as const,
      key: 'customFilter',
      params: {
        filter: buildFilter((f) => f.string('projectId').eq(otherProject.id)),
      },
    };
  await authz.permissionSets.create(
    definePermissionSet('approval-other-project')
      .grant(
        approvalResource.reference().grant({
          read: { assets: selection },
          decide: { assets: selection },
        }),
      )
      .grant(assetResource.reference().grant({ read: { records: selection } }))
      .build(),
  );
  await authz.permissionSets.assign({
    permissionSet: 'approval-other-project',
    subject: { type: 'user', id: limited.id },
  });
  const restricted = await signIn(testApp, { email: limited.email, password });
  const empty = await restricted.fetch('/approvalRequests?view=all');
  expect(empty.status).toBe(200);
  expect(((await empty.json()) as any).meta.total).toBe(0);
  await call('/approvalRequests/' + concurrent.id, undefined, 404, restricted);
  await call(
    '/approvalRequests/' + concurrent.id + '/actions',
    {
      requestId: randomUUID(),
      expectedVersion: concurrent.version,
      action: 'approve',
      comment: 'Out of scope',
    },
    404,
    restricted,
  );
  const cfgKey = randomUUID(),
    configuration = await call('/approvalConfigs', {
      requestId: cfgKey,
      expectedRevision: 1,
      projectId: project.id,
      kind: 'purchases',
      values: {
        enabled: true,
        levels: [{ name: 'Applicant cannot approve', userIds: [a.u.id] }],
      },
    });
  expect(configuration.revision).toBe(2);
  await call(
    '/approvalConfigs',
    {
      requestId: randomUUID(),
      expectedRevision: 1,
      projectId: project.id,
      kind: 'purchases',
      values,
    },
    409,
  );
  const noCandidate = await call(
    '/purchaseRequests',
    {
      requestId: randomUUID(),
      values: {
        title: 'No candidate',
        assetId: project.id,
        neededOn: '2026-10-31',
        reason: 'Test',
        items: [{ name: 'Part', unit: 'each', quantity: 1, unitPrice: '1' }],
      },
    },
    200,
    a.session,
  );
  await call(
    '/approvalRequests',
    {
      requestId: randomUUID(),
      kind: 'purchases',
      sourceId: noCandidate.id,
      expectedVersion: noCandidate.version,
      comment: 'Self approval excluded',
    },
    400,
    a.session,
  );
  expect((await call('/purchaseRequests/' + noCandidate.id)).status).toBe(
    'draft',
  );
  expect(
    await c
      .repository('hylApprovalRequests')
      .count({ filter: { sourceId: noCandidate.id } }),
  ).toBe(0);
  await call('/approvalConfigs', {
    requestId: randomUUID(),
    expectedRevision: 2,
    projectId: project.id,
    kind: 'purchases',
    values,
  });
  expect(
    (
      await call('/approvalConfigs', {
        requestId: cfgKey,
        expectedRevision: 1,
        projectId: project.id,
        kind: 'purchases',
        values: {
          enabled: true,
          levels: [{ name: 'Applicant cannot approve', userIds: [a.u.id] }],
        },
      })
    ).revision,
  ).toBe(2);
});
