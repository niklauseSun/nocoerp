// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
} from '@nocobase/app-plugin-authentication/testing';
import { createStandaloneServer } from '../../server/standalone.js';
import { operationLogsToken } from '../../server/providers/operation-logs.js';
import { hylToken } from '../../server/providers/hyl.js';
const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    logging: { enabled: false },
  },
});
test('captures business and forwarded management success/failure, excludes reads and secrets, restricts logs to administrators', async ({
  testApp,
  request,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS),
    hyl = testApp.application.container.resolve(hylToken);
  const send = (path: string, body: unknown, method = 'POST') =>
    admin.fetch(path, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(body),
    });
  expect((await request('/operationLogs')).status).toBe(401);
  const user = await hyl.users.create({
      name: 'Ordinary audit test',
      email: 'log-' + randomUUID() + '@example.test',
      password: 'Test-' + randomUUID(),
    }),
    password = 'Test-' + randomUUID();
  const ordinaryUser = await hyl.users.create({
    name: 'Restricted audit reader',
    email: 'restricted-' + randomUUID() + '@example.test',
    password,
  });
  const ordinary = await signIn(testApp, {
    email: ordinaryUser.email,
    password,
  });
  expect((await ordinary.fetch('/operationLogs')).status).toBe(403);
  const dept = await send('/organization/departments', {
    title: 'Audit workflow',
    parentId: null,
    active: true,
    version: 0,
  });
  expect(dept.status).toBe(200);
  const created = (await dept.json()).data;
  expect(
    (
      await send(
        '/organization/departments/' + created.id,
        {
          title: 'changed',
          parentId: null,
          active: true,
          version: created.version,
        },
        'PATCH',
      )
    ).status,
  ).toBe(200);
  const failed = await send('/organization/departments', {
    title: '',
    parentId: null,
    active: true,
    version: 0,
    password: 'MUST-NOT-LEAK',
    token: 'SECRET-TOKEN',
  });
  expect(failed.status).toBe(400);
  const denied = await ordinary.fetch('/organization/departments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify({
      title: 'Denied',
      parentId: null,
      active: true,
      version: 0,
    }),
  });
  expect(denied.status).toBe(403);
  expect(
    (
      await send('/users/' + user.id + '/disable', {
        reason: 'SENSITIVE-FREE-TEXT',
      })
    ).status,
  ).toBe(200);
  const permissionKey = 'audit-' + randomUUID();
  const permission = await send('/authorization/permissionSets', {
    key: permissionKey,
    title: 'Audit role',
    grants: [],
  });
  expect(permission.status).toBe(201);
  const first = await (await admin.fetch('/operationLogs?pageSize=100')).json();
  expect(first.data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        module: 'organization',
        targetId: created.id,
        result: 'success',
        httpStatus: 200,
      }),
      expect.objectContaining({
        module: 'organization',
        result: 'failure',
        httpStatus: 400,
      }),
      expect.objectContaining({
        module: 'organization',
        actorId: ordinaryUser.id,
        result: 'failure',
        httpStatus: 403,
      }),
      expect.objectContaining({
        module: 'users',
        targetId: user.id,
        result: 'success',
      }),
      expect.objectContaining({
        module: 'authorization',
        result: 'success',
        targetId: permissionKey,
      }),
    ]),
  );
  expect(first.data.every((x: { actorId: string }) => x.actorId)).toBe(true);
  const searched = await (
    await admin.fetch('/operationLogs?q=' + created.id)
  ).json();
  expect(searched.meta.total).toBe(2);
  const earliest = new Date(
    Math.min(
      ...first.data.map((x: { createdAt: string }) => Date.parse(x.createdAt)),
    ) - 1000,
  ).toISOString();
  const latest = new Date(
    Math.max(
      ...first.data.map((x: { createdAt: string }) => Date.parse(x.createdAt)),
    ) + 1000,
  ).toISOString();
  const within = new URLSearchParams({ from: earliest, to: latest });
  expect(
    (await (await admin.fetch('/operationLogs?' + within)).json()).meta.total,
  ).toBe(first.meta.total);
  const future = new URLSearchParams({ from: latest });
  expect(
    (await (await admin.fetch('/operationLogs?' + future)).json()).meta.total,
  ).toBe(0);
  const detailId = first.data[0].id;
  expect((await ordinary.fetch('/operationLogs/' + detailId)).status).toBe(403);
  expect((await request('/operationLogs/' + detailId)).status).toBe(401);
  expect((await admin.fetch('/operationLogs/' + detailId)).status).toBe(200);
  for (const method of ['POST', 'PATCH', 'DELETE'])
    expect(
      (
        await admin.fetch('/operationLogs/' + detailId, {
          method,
          headers: { origin: 'http://localhost' },
        })
      ).status,
    ).toBe(404);
  await admin.fetch('/organization');
  await send('/contracts/' + randomUUID() + '/previewBill', {});
  await send('/authorization/permissionSets/subjects/user/resolve', {
    ids: [],
  });
  const after = await (await admin.fetch('/operationLogs?pageSize=100')).json();
  expect(after.meta.total).toBe(first.meta.total);
  const text = JSON.stringify(after);
  for (const secret of [
    'MUST-NOT-LEAK',
    'SECRET-TOKEN',
    'SENSITIVE-FREE-TEXT',
    password,
  ])
    expect(text).not.toContain(secret);
  expect(
    after.data.every(
      (row: Record<string, unknown>) =>
        Object.keys(row).sort().join(',') ===
        'action,actorId,actorName,createdAt,durationMs,errorCode,httpStatus,id,method,module,pathTemplate,requestId,result,targetId',
    ),
  ).toBe(true);
  const filtered = await (
    await admin.fetch(
      '/operationLogs?module=organization&result=failure&pageSize=1&order=asc',
    )
  ).json();
  expect(filtered.data).toHaveLength(1);
  expect(filtered.meta.total).toBe(2);
  const second = await (
    await admin.fetch(
      '/operationLogs?module=organization&result=failure&pageSize=1&page=2&order=asc',
    )
  ).json();
  expect(second.data[0].id).not.toBe(filtered.data[0].id);
  expect((await admin.fetch('/operationLogs?from=bad')).status).toBe(400);
  expect(
    (
      await admin.fetch(
        '/operationLogs?from=2026-10-22T00:00:00Z&to=2026-10-21T00:00:00Z',
      )
    ).status,
  ).toBe(400);
  expect((await admin.fetch('/operationLogs/' + randomUUID())).status).toBe(
    404,
  );
});

test('never persists arbitrary failed target/header strings and retains canonical dynamic actions', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  for (const [path, action] of [
    ['/assets/PRIVATE_PATH_SECRET', ''],
    ['/bills/' + randomUUID() + '/applyDeposit', 'applyDeposit'],
    ['/receipts/' + randomUUID() + '/allocate', 'allocate'],
    [
      '/scheduler/schedules/' + randomUUID() + '/enable',
      'schedulerEnableSchedule',
    ],
  ]) {
    const r = await admin.fetch(path, {
      method: path.startsWith('/assets') ? 'PATCH' : 'POST',
      headers: {
        origin: 'http://localhost',
        'content-type': 'application/json',
        'x-request-id': 'PRIVATE_HEADER_SECRET',
      },
      body: JSON.stringify({ requestId: randomUUID(), expectedVersion: 0 }),
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
    const logs = await (
      await admin.fetch('/operationLogs?pageSize=100')
    ).json();
    if (action)
      expect(logs.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ action, result: 'failure' }),
        ]),
      );
  }
  const logs = await (await admin.fetch('/operationLogs?pageSize=100')).json();
  expect(JSON.stringify(logs)).not.toMatch(
    /PRIVATE_PATH_SECRET|PRIVATE_HEADER_SECRET/,
  );
  expect(
    logs.data.every((x: { requestId: string }) =>
      /^[0-9a-f-]{36}$/i.test(x.requestId),
    ),
  ).toBe(true);
});

test('does not turn a committed business write into a failure when operation-log storage fails', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS),
    service = testApp.application.container.resolve(operationLogsToken);
  const append = vi
    .spyOn(service, 'append')
    .mockRejectedValueOnce(new Error('temporary storage failure'));
  const response = await admin.fetch('/organization/departments', {
    method: 'POST',
    headers: { origin: 'http://localhost', 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Committed despite audit failure',
      parentId: null,
      active: true,
      version: 0,
    }),
  });
  expect(response.status).toBe(200);
  const row = (await response.json()).data;
  expect(append).toHaveBeenCalledOnce();
  append.mockRestore();
  const snapshot = await (await admin.fetch('/organization')).json();
  expect(snapshot.data.departments).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: row.id })]),
  );
});
