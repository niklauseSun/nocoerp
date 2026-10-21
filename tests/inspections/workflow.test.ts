import { authorizationToken } from '@nocobase/app-plugin-authorization';
import { definePermissionSet } from '@nocobase/authorization/permission-sets';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { assetResource } from '../../server/assets/resources.js';
import { inspectionResource } from '../../server/inspections/resources.js';
import { InspectionService } from '../../server/inspections/service.js';
import { hylToken } from '../../server/providers/hyl.js';
import { today } from '../../server/inspections/calendar.js';
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
test('inspection execution, rectification, repair linkage and scheduled dispatch', async ({
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
  expect((await request('/inspectionPlans')).status).toBe(401);
  expect((await request('/inspectionAssignees')).status).toBe(401);
  expect((await request('/inspectionAssets')).status).toBe(401);
  const project = await call(
      '/assets',
      { name: 'Inspection project', type: 'project' },
      'POST',
      201,
    ),
    street = await call(
      '/assets',
      { name: 'Inspection street', type: 'street', parentId: project.id },
      'POST',
      201,
    ),
    asset = await call(
      '/assets',
      {
        name: 'Inspection unit',
        type: 'unit',
        parentId: street.id,
        area: '10',
        lettableArea: '10',
      },
      'POST',
      201,
    );
  const users = await call('/inspectionAssignees'),
    actor = users[0],
    day = today();
  async function create(type: string, itemCount = 2) {
    let p = await call('/inspectionPlans', {
      requestId: randomUUID(),
      values: {
        title: type + ' plan',
        type,
        assetIds: [asset.id],
        items: Array.from({ length: itemCount }, (_, i) => ({
          name: 'Item' + i,
          standard: 'No faults',
        })),
        frequency: 'once',
        start: day,
        end: day,
        assigneeId: actor.id,
        notes: '',
      },
    });
    p = await call('/inspectionPlans/' + p.id + '/actions', {
      requestId: randomUUID(),
      expectedVersion: p.version,
      action: 'activate',
      note: 'activate',
    });
    return p;
  }
  async function act(
    kind: string,
    r: any,
    action: string,
    values: Record<string, unknown> = {},
    status = 200,
  ) {
    return call(
      '/inspection' + kind + '/' + r.id + '/actions',
      {
        requestId: randomUUID(),
        expectedVersion: r.version,
        action,
        ...values,
      },
      'POST',
      status,
    );
  }
  let plan = await create('inspection');
  const gen = {
    requestId: randomUUID(),
    expectedVersion: plan.version,
    action: 'generate',
    day,
  };
  plan = await call('/inspectionPlans/' + plan.id + '/actions', gen);
  expect(
    (await call('/inspectionPlans/' + plan.id + '/actions', gen)).version,
  ).toBe(plan.version);
  const sameRequest = {
    ...gen,
    requestId: randomUUID(),
    expectedVersion: plan.version,
  };
  const concurrent = await Promise.all([
    call('/inspectionPlans/' + plan.id + '/actions', sameRequest),
    call('/inspectionPlans/' + plan.id + '/actions', sameRequest),
  ]);
  expect(concurrent[0].version).toBe(concurrent[1].version);
  plan = concurrent[0];
  expect(await call('/inspectionTasks?planId=' + plan.id)).toHaveLength(1);
  await call(
    '/inspectionPlans/' + plan.id + '/actions',
    { ...sameRequest, day: '2000-01-01' },
    'POST',
    409,
  );
  plan = await act('Plans', plan, 'pause', { note: 'edit future checklist' });
  plan = await act('Plans', plan, 'edit', {
    values: {
      title: 'Revised future plan',
      type: 'inspection',
      assetIds: [asset.id],
      items: [{ name: 'Changed item', standard: 'new' }],
      frequency: 'once',
      start: day,
      end: day,
      assigneeId: actor.id,
      notes: '',
    },
  });
  expect(
    (await call('/inspectionTasks?planId=' + plan.id))[0].payload.items,
  ).toHaveLength(2);
  plan = await act('Plans', plan, 'activate', { note: 'resume' });
  let task = (await call('/inspectionTasks?planId=' + plan.id))[0];
  task = await act('Tasks', task, 'start', { note: 'onsite' });
  await act('Tasks', task, 'submit', { note: 'incomplete' }, 400);
  task = await act('Tasks', task, 'save', {
    results: [{ itemId: 'item-1', result: 'normal', note: '' }],
  });
  task = await act('Tasks', task, 'report', {
    itemId: 'item-2',
    severity: 'high',
    description: 'Dirty floor',
    evidence: 'onsite note',
    assigneeId: actor.id,
    dueOn: day,
  });
  await act(
    'Tasks',
    task,
    'report',
    {
      itemId: 'item-2',
      severity: 'high',
      description: 'duplicate',
      evidence: 'note',
      assigneeId: actor.id,
      dueOn: day,
    },
    409,
  );
  let issue = (await call('/inspectionIssues?taskId=' + task.id))[0];
  await act(
    'Tasks',
    task,
    'save',
    {
      results: [
        { itemId: 'item-1', result: 'normal', note: '' },
        { itemId: 'item-2', result: 'normal', note: '' },
      ],
    },
    400,
  );
  task = await act('Tasks', task, 'submit', { note: 'done' });
  await act('Tasks', task, 'pass', { note: 'blocked' }, 400);
  issue = await act('Issues', issue, 'rectify', {
    note: 'cleaned',
    evidence: 'first evidence',
  });
  issue = await act('Issues', issue, 'return', { note: 'corners dirty' });
  issue = await act('Issues', issue, 'rectify', {
    note: 'recleaned',
    evidence: 'second evidence',
  });
  issue = await act('Issues', issue, 'pass', { note: 'all clean' });
  expect(issue.status).toBe('closed');
  task = await act('Tasks', task, 'pass', { note: 'accepted' });
  expect(task.status).toBe('completed');
  await act('Tasks', task, 'cancel', { note: 'terminal' }, 400);
  const security = await create('security', 1);
  await act('Plans', security, 'generate', { day });
  let safety = (await call('/inspectionTasks?planId=' + security.id))[0];
  safety = await act('Tasks', safety, 'start', { note: 'start' });
  safety = await act('Tasks', safety, 'report', {
    itemId: 'item-1',
    severity: 'urgent',
    description: 'Broken light',
    evidence: 'observed',
    assigneeId: actor.id,
    dueOn: day,
  });
  let safetyIssue = (await call('/inspectionIssues?taskId=' + safety.id))[0];
  const toRepair = {
    requestId: randomUUID(),
    expectedVersion: safetyIssue.version,
    action: 'toRepair',
    note: 'repair needed',
  };
  safetyIssue = await call(
    '/inspectionIssues/' + safetyIssue.id + '/actions',
    toRepair,
  );
  expect(safetyIssue.repairId).toBeTruthy();
  expect(
    (await call('/inspectionIssues/' + safetyIssue.id + '/actions', toRepair))
      .repairId,
  ).toBe(safetyIssue.repairId);
  await act(
    'Issues',
    safetyIssue,
    'rectify',
    { note: 'not finished', evidence: 'none' },
    400,
  );
  let repair = await call('/repairOrders/' + safetyIssue.repairId);
  expect(repair.payload.inspectionIssueId).toBe(safetyIssue.id);
  const repairAct = async (action: string, values: Record<string, unknown>) => {
    repair = await call('/repairOrders/' + repair.id + '/actions', {
      requestId: randomUUID(),
      expectedVersion: repair.version,
      action,
      ...values,
    });
  };
  await repairAct('assign', {
    assigneeId: actor.id,
    dueOn: day,
    note: 'dispatch',
  });
  await repairAct('start', { note: 'start' });
  await repairAct('complete', {
    note: 'repaired',
    evidence: 'test',
    cost: '0',
  });
  await repairAct('accept', { note: 'pass' });
  await repairAct('close', { note: 'delivered' });
  safetyIssue = await act('Issues', safetyIssue, 'rectify', {
    note: 'repair closed, checked',
    evidence: 'verification',
  });
  await act('Issues', safetyIssue, 'pass', { note: 'safe' });
  safety = await act('Tasks', safety, 'submit', { note: 'finished' });
  safety = await act('Tasks', safety, 'pass', { note: 'accepted' });
  expect(safety.status).toBe('completed');
  let cleaning = await create('cleaning', 1);
  const service = new InspectionService(
      testApp.application.container.resolve(hylToken),
    ),
    authz = testApp.application.container.resolve(authorizationToken);
  const tick = await service.tick(authz);
  expect(tick.failed).toBe(0);
  expect(await call('/inspectionTasks?planId=' + cleaning.id)).toHaveLength(1);
  await service.tick(authz);
  expect(await call('/inspectionTasks?planId=' + cleaning.id)).toHaveLength(1);
  cleaning = await call('/inspectionPlans/' + cleaning.id);
  cleaning = await act('Plans', cleaning, 'pause', { note: 'pause' });
  cleaning = await act('Plans', cleaning, 'archive', { note: 'end' });
  await act('Plans', cleaning, 'activate', { note: 'terminal' }, 400);
  const manager = testApp.application.container.resolve(
      userManagementServiceToken,
    ),
    password = randomBytes(24).toString('hex'),
    denied = await manager.create({
      name: 'No inspection access',
      email: randomUUID() + '@example.test',
      password,
    }),
    session = await signIn(testApp, { email: denied.email, password });
  expect((await session.fetch('/inspectionPlans')).status).toBe(403);
  await authz.permissionSets.create(
    definePermissionSet('inspection-worker')
      .grant(
        inspectionResource.reference().grant({
          read: { assets: 'allRecords' },
          execute: { assets: 'allRecords' },
        }),
      )
      .grant(
        assetResource.reference().grant({ read: { records: 'allRecords' } }),
      )
      .build(),
  );
  await authz.permissionSets.assign({
    permissionSet: 'inspection-worker',
    subject: { type: 'user', id: denied.id },
  });
  const scoped = await signIn(testApp, { email: denied.email, password });
  expect((await scoped.fetch('/inspectionTasks')).status).toBe(200);
  expect((await scoped.fetch('/inspectionAssignees')).status).toBe(403);
  expect((await scoped.fetch('/inspectionAssets')).status).toBe(403);
  const workerTask = (await call('/inspectionTasks?planId=' + cleaning.id))[0];
  expect(
    (
      await scoped.fetch('/inspectionTasks/' + workerTask.id + '/actions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost',
        },
        body: JSON.stringify({
          requestId: randomUUID(),
          expectedVersion: workerTask.version,
          action: 'start',
          note: 'wrong assignee',
        }),
      })
    ).status,
  ).toBe(403);
  const releaseTeam = authz.subjects.add('inspection.team', {
    resolveFor: async (principal) =>
      principal.id === denied.id ? ['ops'] : [],
    filterActive: async (ids) => ids,
  });
  await authz.permissionSets.create(
    definePermissionSet('inspection-team-manager')
      .grant(
        inspectionResource
          .reference()
          .grant({ manage: { assets: 'allRecords' } }),
      )
      .build(),
  );
  const assignment = await authz.permissionSets.assign({
    permissionSet: 'inspection-team-manager',
    subject: { type: 'inspection.team', id: 'ops' },
  });
  const workerWrite = async (path: string, body: unknown) => {
    const response = await scoped.fetch(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(body),
    });
    const bodyResult = (await response.json()) as any;
    if (response.status !== 200) throw Error(JSON.stringify(bodyResult));
    return bodyResult.data;
  };
  let owned = await workerWrite('/inspectionPlans', {
    requestId: randomUUID(),
    values: {
      title: 'Team scheduled plan',
      type: 'inspection',
      assetIds: [asset.id],
      items: [{ name: 'Team check', standard: 'No faults' }],
      frequency: 'once',
      start: day,
      end: day,
      assigneeId: denied.id,
      notes: '',
    },
  });
  owned = await workerWrite('/inspectionPlans/' + owned.id + '/actions', {
    requestId: randomUUID(),
    expectedVersion: owned.version,
    action: 'activate',
    note: 'team enabled',
  });
  expect((await service.tick(authz)).failed).toBe(0);
  expect(await call('/inspectionTasks?planId=' + owned.id)).toHaveLength(1);
  let revoked = await workerWrite('/inspectionPlans', {
    requestId: randomUUID(),
    values: {
      title: 'Revoked creator',
      type: 'inspection',
      assetIds: [asset.id],
      items: [{ name: 'Cannot dispatch', standard: 'No faults' }],
      frequency: 'once',
      start: day,
      end: day,
      assigneeId: denied.id,
      notes: '',
    },
  });
  revoked = await workerWrite('/inspectionPlans/' + revoked.id + '/actions', {
    requestId: randomUUID(),
    expectedVersion: revoked.version,
    action: 'activate',
    note: 'before revocation',
  });
  await authz.permissionSets.revoke(assignment.id);
  expect((await service.tick(authz)).failed).toBe(1);
  expect(await call('/inspectionTasks?planId=' + revoked.id)).toHaveLength(0);
  releaseTeam();
});
