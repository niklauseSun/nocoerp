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
const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    logging: { enabled: false },
  },
});
test('public Users management creates and edits TEST employees, checks each grant, and revokes sessions on password reset or disable', async ({
  testApp,
  request,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const org = testApp.application.container.resolve(organizationToken);
  const key = 'staff-ui-' + randomUUID();
  await org.authz.permissionSets.create(
    definePermissionSet(key)
      .grant({
        resource: { type: 'page', id: 'hyl-merchants' },
        actions: [{ action: 'access' }],
      })
      .build(),
  );
  const email = 'staff-' + randomUUID() + '@example.test';
  const password = 'Test-initial-' + randomUUID();
  const nextPassword = 'Test-reset-' + randomUUID();
  const create = {
    name: 'TEST 员工目录验收',
    email,
    password,
    roleScopes: { app: [key] },
  };
  expect(
    (
      await request('/users', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost',
        },
        body: JSON.stringify(create),
      })
    ).status,
  ).toBe(401);
  const created = await admin.fetch('/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify(create),
  });
  expect(created.status).toBe(201);
  const body = await created.json();
  const userId = body.data.id as string;
  expect(body.data.roleScopes.app).toEqual([key]);
  expect(JSON.stringify(body)).not.toContain(password);
  expect(body.data).not.toHaveProperty('passwordHash');
  const employee = await signIn(testApp, { email, password });
  for (const [path, method, json] of [
    [`/users/${userId}`, 'PATCH', { name: 'forbidden' }],
    [`/users/${userId}/disable`, 'POST', undefined],
    [`/users/${userId}/resetPassword`, 'POST', { password: nextPassword }],
  ] as const) {
    const init = {
      method,
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      ...(json ? { body: JSON.stringify(json) } : {}),
    };
    expect((await request(path, init)).status).toBe(401);
    expect((await employee.fetch(path, init)).status).toBe(403);
  }
  const updatedEmail = 'renamed-' + randomUUID() + '@example.test';
  const updated = await admin.fetch('/users/' + userId, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify({
      name: 'TEST 修改后的员工',
      email: updatedEmail,
      username: null,
    }),
  });
  expect(updated.status).toBe(200);
  expect((await updated.json()).data.roleScopes.app).toEqual([key]);
  const reset = await admin.fetch(`/users/${userId}/resetPassword`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify({ password: nextPassword }),
  });
  expect(reset.status).toBe(204);
  expect((await employee.fetch('/organization')).status).toBe(401);
  const oldLogin = await request('/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify({ email: updatedEmail, password }),
  });
  expect(oldLogin.ok).toBe(false);
  const renewed = await signIn(testApp, {
    email: updatedEmail,
    password: nextPassword,
  });
  const disabled = await admin.fetch(`/users/${userId}/disable`, {
    method: 'POST',
    headers: { origin: 'http://localhost' },
  });
  expect(disabled.status).toBe(200);
  expect((await renewed.fetch('/organization')).status).toBe(401);
  const enabled = await admin.fetch(`/users/${userId}/enable`, {
    method: 'POST',
    headers: { origin: 'http://localhost' },
  });
  expect(enabled.status).toBe(200);
  const finalSession = await signIn(testApp, {
    email: updatedEmail,
    password: nextPassword,
  });
  expect((await finalSession.fetch('/organization')).status).toBe(403);
});
