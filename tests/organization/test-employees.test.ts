import { verifyEmployeeLogins } from '../../cli/lib/test-employee-logins.js';
// @vitest-environment node
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
} from '@nocobase/app-plugin-authentication/testing';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { randomBytes } from 'node:crypto';
import { expect } from 'vitest';
import { createStandaloneServer } from '../../server/standalone.js';
import { hylToken } from '../../server/providers/hyl.js';
import { organizationToken } from '../../server/providers/organization.js';
import { accessFor } from '../../cli/lib/organization-demo.js';
import {
  jobs,
  provisionTestEmployees,
  type Job,
} from '../../cli/lib/test-employees.js';
const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    logging: { enabled: false },
  },
});
test('TEST employees get actual departments, visible roles, independent credentials and assigned project isolation', async ({
  testApp,
}) => {
  const app = testApp.application,
    hyl = app.container.resolve(hylToken),
    org = app.container.resolve(organizationToken),
    users = app.container.resolve(userManagementServiceToken);
  const admin = (
    await hyl.users.list({
      search: DEFAULT_ADMIN_CREDENTIALS.email,
      page: 1,
      pageSize: 20,
    })
  ).items[0];
  const access = await accessFor(org, admin.id),
    passwords = Object.fromEntries(
      jobs.map((j) => [j.key, 'T9!' + randomBytes(12).toString('base64url')]),
    ) as Record<Job, string>;
  const result = await provisionTestEmployees(
    org,
    hyl,
    users,
    access,
    'isolated-test',
    passwords,
  );
  expect(result.accounts).toHaveLength(5);
  expect(result.evidence.filter((e) => e.pay)).toHaveLength(1);
  for (const account of result.accounts) {
    expect(
      (
        await users.list({ search: account.email, page: 1, pageSize: 20 })
      ).items.find((u) => u.id === account.id)?.roleScopes.app,
    ).toContain(account.role);
    expect(await org.projectIds(account.id)).toEqual(
      expect.arrayContaining([result.fixtures[0].projectId]),
    );
    if (account.job !== 'admin')
      expect(await org.projectIds(account.id)).not.toContain(
        result.fixtures[1].projectId,
      );
    const session = await signIn(testApp, {
      email: account.email,
      password: passwords[account.job],
    });
    expect((await session.fetch('/organization')).status).toBe(
      account.job === 'admin' ? 200 : 403,
    );
    expect((await session.fetch('/financialReports')).status).toBe(
      ['finance', 'management'].includes(account.job) ? 200 : 403,
    );
    if (account.job !== 'admin') {
      expect(
        (await session.fetch('/contracts/' + result.fixtures[0].contractId))
          .status,
      ).toBe(200);
      expect(
        (await session.fetch('/contracts/' + result.fixtures[1].contractId))
          .status,
      ).toBe(404);
    }
  }
  expect(
    await verifyEmployeeLogins(app, result.accounts, passwords),
  ).toHaveLength(5);
  await expect(
    provisionTestEmployees(org, hyl, users, access, 'isolated-test', passwords),
  ).rejects.toThrow('already exists');
  expect(
    (await users.list({ search: '@hyl.example.test', page: 1, pageSize: 20 }))
      .items,
  ).toHaveLength(5);
});
