// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
} from '@nocobase/app-plugin-authentication/testing';
import { definePermissionSet } from '@nocobase/authorization/permission-sets';
import { createStandaloneServer } from '../../server/standalone.js';
import { organizationToken } from '../../server/providers/organization.js';
import { hylToken } from '../../server/providers/hyl.js';
import {
  runOrganizationDemo,
  accessFor,
} from '../../cli/lib/organization-demo.js';
const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    logging: { enabled: false },
  },
});
test('organization administration, inherited and direct roles, project isolation and revocation through real HTTP and database', async ({
  testApp,
  request,
}) => {
  const app = testApp.application,
    org = app.container.resolve(organizationToken),
    hyl = app.container.resolve(hylToken),
    admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS),
    user = (
      await hyl.users.list({
        search: DEFAULT_ADMIN_CREDENTIALS.email,
        page: 1,
        pageSize: 10,
      })
    ).items[0],
    access = await accessFor(org, user.id);
  for (const path of [
    '/organization',
    '/organization/options',
    '/organization/audit',
  ])
    expect((await request(path)).status).toBe(401);
  const pwd = 'Demo-test-' + randomUUID(),
    demo = await runOrganizationDemo(org, hyl, access, { password: pwd }),
    a = await signIn(testApp, { email: demo.accounts[1].email, password: pwd }),
    b = await signIn(testApp, { email: demo.accounts[2].email, password: pwd });
  for (const u of demo.accounts) {
    const scoped = await accessFor(org, u.id);
    expect(
      await scoped.authorization.can({
        resource: { type: 'composite', id: 'hyl.contracts' },
        action: 'read',
      }),
    ).toBe(true);
    expect(
      await scoped.authorization.can({
        resource: { type: 'page', id: 'hyl-contracts' },
        action: 'access',
      }),
    ).toBe(true);
  }
  const linked: Record<
    string,
    { meter: string; repair: string; plan: string }
  > = {};
  for (const source of [demo.projects.a, demo.projects.b]) {
    const contract = await hyl.get(access, 'contracts', source.contractId),
      assetId = String((contract.payload.assetIds as string[])[0]),
      day = String(contract.payload.start);
    const post = async (path: string, body: unknown) => {
      const response = await admin.fetch(path, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://localhost',
          },
          body: JSON.stringify(body),
        }),
        json: any = await response.json();
      expect(response.status).toBe(200);
      return json.data;
    };
    const meter = await post('/energyMeters', {
      requestId: randomUUID(),
      code: 'org-' + randomUUID(),
      name: '组织隔离验证水表',
      type: 'water',
      assetId,
      installedOn: day,
      openingReading: '0',
      multiplier: '1',
      openingEvidence: 'isolated test',
    });
    const repair = await post('/repairOrders', {
      requestId: randomUUID(),
      values: {
        title: '组织隔离报修',
        description: 'isolated test',
        category: 'plumbing',
        priority: 'normal',
        reporterName: 'test',
        reporterPhone: '0',
        location: 'test',
        evidence: 'test',
        assetId,
        merchantId: contract.merchantId,
        contractId: contract.id,
        occurredOn: day,
      },
    });
    const plan = await post('/inspectionPlans', {
      requestId: randomUUID(),
      values: {
        title: '组织隔离巡检',
        type: 'inspection',
        assetIds: [assetId],
        items: [{ name: 'test', standard: 'test' }],
        frequency: 'once',
        start: day,
        end: day,
        assigneeId: user.id,
        notes: '',
      },
    });
    linked[source.projectId] = {
      meter: meter.id,
      repair: repair.id,
      plan: plan.id,
    };
  }
  for (const session of [a, b]) {
    expect((await session.fetch('/organization')).status).toBe(403);
    expect((await session.fetch('/organization/options')).status).toBe(403);
    expect((await session.fetch('/users')).status).toBe(403);
    expect((await session.fetch('/authorization/permissionSets')).status).toBe(
      403,
    );
  }
  for (const [own, foreign, session] of [
    [demo.projects.a, demo.projects.b, a],
    [demo.projects.b, demo.projects.a, b],
  ] as const) {
    for (const [ownPath, foreignPath] of [
      ['/contracts/' + own.contractId, '/contracts/' + foreign.contractId],
      ['/bills/' + own.billIds[0], '/bills/' + foreign.billIds[0]],
      [
        '/cashierOrders/' + own.cashierOrderIds[0],
        '/cashierOrders/' + foreign.cashierOrderIds[0],
      ],
      [
        '/settlements/' + own.settlementId,
        '/settlements/' + foreign.settlementId,
      ],
      [
        '/purchaseOrders/' + own.purchaseOrderId,
        '/purchaseOrders/' + foreign.purchaseOrderId,
      ],
      ['/assets/' + own.projectId, '/assets/' + foreign.projectId],
      [
        '/energyMeters/' + linked[own.projectId].meter,
        '/energyMeters/' + linked[foreign.projectId].meter,
      ],
      [
        '/repairOrders/' + linked[own.projectId].repair,
        '/repairOrders/' + linked[foreign.projectId].repair,
      ],
      [
        '/inspectionPlans/' + linked[own.projectId].plan,
        '/inspectionPlans/' + linked[foreign.projectId].plan,
      ],
    ]) {
      expect((await session.fetch(ownPath)).status).toBe(200);
      expect([403, 404]).toContain((await session.fetch(foreignPath)).status);
    }
    for (const suffix of [
      '/leaseSummary',
      '/billingSummary',
      '/assets',
      '/invoiceConfig',
    ])
      expect([403, 404]).toContain(
        (await session.fetch('/contracts/' + foreign.contractId + suffix))
          .status,
      );
    const split: any = await (
      await session.fetch('/contracts/' + foreign.contractId + '/splitRules')
    ).json();
    expect(split.data).toEqual([]);
    for (const suffix of ['/history', '/associations', '/files'])
      expect([403, 404]).toContain(
        (await session.fetch('/assets/' + foreign.projectId + suffix)).status,
      );
    const report: any = await (
      await session.fetch(
        '/financialReports?projectId=' +
          foreign.projectId +
          '&from=2000-01-01&to=2099-12-31',
      )
    ).json();
    expect(report.data.summary.netCents).toBe('0');
    expect(report.data.items).toEqual([]);
    for (const path of [
      '/assets',
      '/contracts',
      '/bills',
      '/cashierOrders',
      '/purchaseOrders',
      '/invoiceSources',
      '/splitOrders',
      '/energyMeters',
      '/repairOrders',
      '/inspectionPlans',
      '/approvalRequests',
    ]) {
      const response = await session.fetch(path);
      expect(response.status).toBe(200);
      const body = JSON.stringify(await response.json());
      for (const id of [
        foreign.projectId,
        foreign.contractId,
        foreign.billIds[0],
        foreign.cashierOrderIds[0],
        foreign.purchaseOrderId,
      ])
        expect(body).not.toContain(id);
    }
  }
  const write = await a.fetch('/organization/departments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: '{}',
  });
  expect(write.status).toBe(403);
  const tree = await org.tree(),
    root = tree.find((x) => x.id === demo.departments.root)!,
    child = tree.find((x) => x.id === demo.departments.a)!;
  await expect(
    org.department(user.id, { ...root, parentId: child.id }, root.id),
  ).rejects.toMatchObject({ reason: 'ORG_CYCLE' });
  await expect(
    org.department(user.id, { ...child, version: 999 }, child.id),
  ).rejects.toMatchObject({ reason: 'ORG_STALE' });
  await org.member(user.id, demo.departments.b, {
    userId: demo.accounts[0].id,
    active: true,
    primary: true,
  });
  expect(
    (await org.snapshot()).members.filter(
      (x) => x.userId === demo.accounts[0].id && x.primary && x.active,
    ),
  ).toHaveLength(1);
  await org.member(user.id, demo.departments.b, {
    userId: demo.accounts[0].id,
    active: false,
    primary: false,
  });
  // Independent project source survives removal of the department source, then disappears after both are revoked.
  let project = (await org.snapshot()).projects.find(
    (x) => x.projectId === demo.projects.a.projectId,
  )!;
  const direct = await org.project(user.id, {
    projectId: project.projectId,
    subjectType: 'user',
    subjectId: demo.accounts[1].id,
    active: true,
    version: 0,
  });
  await org.project(user.id, {
    ...project,
    subjectType: 'org.department',
    active: false,
  });
  expect(await org.projectIds(demo.accounts[1].id)).toContain(
    project.projectId,
  );
  project = (await org.snapshot()).projects.find((x) => x.id === project.id)!;
  await org.project(user.id, { ...direct, subjectType: 'user', active: false });
  expect(await org.projectIds(demo.accounts[1].id)).toEqual([]);
  expect(
    (await a.fetch('/contracts/' + demo.projects.a.contractId)).status,
  ).toBe(404);
  await org.project(user.id, {
    ...project,
    subjectType: 'org.department',
    active: true,
  });
  // A department maintainer cannot manage users, roles, or grant themselves unrestricted access.
  const key = 'org-maintainer-' + randomUUID();
  await org.authz.permissionSets.create(
    definePermissionSet(key)
      .grant(org.authz.settings.grant('hyl.organization', ['read', 'update']))
      .build(),
  );
  await org.authz.permissionSets.assign({
    permissionSet: key,
    subject: { type: 'user', id: demo.accounts[1].id },
  });
  expect((await a.fetch('/organization')).status).toBe(200);
  expect((await a.fetch('/authorization/permissionSets')).status).toBe(403);

  // Page access and business read are independent; an account with only a page grant cannot read records.
  const temporary = await hyl.users.create({
      name: 'isolated page-only test',
      email: 'org-page-' + randomUUID() + '@test.local',
      password: pwd,
    }),
    pageKey = 'page-' + randomUUID();
  await org.authz.permissionSets.create(
    definePermissionSet(pageKey)
      .grant({
        resource: { type: 'page', id: 'hyl-contracts' },
        actions: [{ action: 'access' }],
      })
      .build(),
  );
  await org.authz.permissionSets.assign({
    permissionSet: pageKey,
    subject: { type: 'user', id: temporary.id },
  });
  const pageSession = await signIn(testApp, {
    email: temporary.email,
    password: pwd,
  });
  expect((await pageSession.fetch('/contracts')).status).toBe(403);
  const rootAssignments =
    await org.authz.permissionSets.listAssignments('root');
  if (rootAssignments.length === 1) {
    const last = await admin.fetch(
      '/authorization/permissionSets/root/assignments/' + rootAssignments[0].id,
      { method: 'DELETE', headers: { origin: 'http://localhost' } },
    );
    expect(last.status).toBe(400);
    expect(JSON.stringify(await last.json())).toContain('LAST_ASSIGNMENT');
  }
  const auditBefore = await org.db.repository('hylOrganizationAudit').count();
  await expect(
    org.project(user.id, {
      projectId: demo.projects.a.projectId,
      subjectType: 'user',
      subjectId: 'missing',
      active: true,
      version: 0,
    }),
  ).rejects.toMatchObject({ reason: 'ORG_USER_UNAVAILABLE' });
  expect(await org.db.repository('hylOrganizationAudit').count()).toBe(
    auditBefore,
  );
  const audit: any = await (await admin.fetch('/organization/audit')).json();
  expect(audit.data.total).toBeGreaterThan(10);
  expect(JSON.stringify(audit)).not.toContain(pwd);
  await hyl.users.disable(demo.accounts[1].id);
  expect((await a.fetch('/contracts')).status).toBe(401);
  await hyl.users.enable(demo.accounts[1].id);
  expect((await a.fetch('/contracts')).status).toBe(401);
  expect(
    (
      await (
        await signIn(testApp, { email: demo.accounts[1].email, password: pwd })
      ).fetch('/contracts')
    ).status,
  ).toBe(200);
}, 120000);

test('organization migration reverses and recreates its schema on a real isolated database', async ({
  testApp,
}) => {
  const { default: migration } =
      await import('../../database/main/migrations/202610200001_organization.js'),
    app = testApp.application,
    org = app.container.resolve(organizationToken),
    c = org.db.connection(),
    context = {
      builder: c.builder,
      query: c.query,
      repository: c.repository.bind(c),
      connection: c,
      config: app.config,
      container: app.container,
    };
  expect(await c.collections.get('hylDepartments')).toBeDefined();
  await migration.down!(context);
  expect(await c.collections.get('hylDepartments')).toBeUndefined();
  expect(await c.collections.get('hylProjectAccess')).toBeUndefined();
  await migration.up(context);
  expect(await c.repository('hylOrganizationLock').count()).toBe(1);
  await c.repository('hylDepartmentMembers').createOne({
    values: {
      id: 'one',
      departmentId: 'd',
      userId: 'u',
      active: true,
      primary: true,
    },
  });
  await expect(
    c.repository('hylDepartmentMembers').createOne({
      values: {
        id: 'two',
        departmentId: 'd',
        userId: 'u',
        active: true,
        primary: false,
      },
    }),
  ).rejects.toThrow();
});
