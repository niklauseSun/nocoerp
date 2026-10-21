// @vitest-environment node
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
} from '@nocobase/app-plugin-authentication/testing';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { authorizationToken } from '@nocobase/app-plugin-authorization';
import { definePermissionSet } from '@nocobase/authorization/permission-sets';
import { randomBytes } from 'node:crypto';
import { expect } from 'vitest';
import { createStandaloneServer } from '../../server/standalone.js';
import { hylToken } from '../../server/providers/hyl.js';
import { approvalToken } from '../../server/providers/approvals.js';
import { resources } from '../../server/hyl/resources.js';
import { assetResource } from '../../server/assets/resources.js';
import { financeResource } from '../../server/finance/resources.js';
import { procurementResource } from '../../server/procurement/resources.js';
import { actionSchema, type Kind } from '../../server/hyl/schema.js';
const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    logging: { enabled: false },
  },
});
test('TEST finance, leasing, management and tenant sessions follow their declared synthetic job matrix', async ({
  testApp,
}) => {
  const app = testApp.application,
    admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS),
    hyl = app.container.resolve(hylToken),
    approvals = app.container.resolve(approvalToken),
    authz = app.container.resolve(authorizationToken),
    users = app.container.resolve(userManagementServiceToken);
  const actors = [];
  for (const job of ['finance', 'leasing', 'management', 'tenant']) {
    const password = randomBytes(24).toString('hex'),
      user = await users.create({
        name: 'TEST岗位-' + job,
        email: 'test-role-' + job + '@example.test',
        password,
      });
    const session = await signIn(testApp, { email: user.email, password }),
      scope = job === 'tenant' ? 'hyl.ownMerchant' : 'allRecords';
    let set = definePermissionSet('TEST-job-' + job).grant({
      resource: { type: 'page', id: 'hyl-tenant-operations' },
      actions: [{ action: 'access' }],
    });
    for (const kind of [
      'merchants',
      'contracts',
      'revenueReports',
      'expenses',
      'settlements',
    ] as Kind[]) {
      const actions =
        job === 'finance'
          ? kind === 'settlements'
            ? ['read', 'write', 'review', 'pay', 'confirm']
            : kind === 'revenueReports' || kind === 'expenses'
              ? ['read', 'review']
              : ['read']
          : job === 'leasing'
            ? kind === 'merchants' || kind === 'contracts'
              ? ['read', 'write']
              : []
            : job === 'management'
              ? ['read']
              : kind === 'merchants' || kind === 'contracts'
                ? ['read']
                : kind === 'settlements'
                  ? ['read', 'confirm']
                  : ['read', 'write', 'submit'];
      if (['finance', 'management'].includes(job) && kind === 'contracts')
        actions.push(
          'billingRead',
          'receiptRead',
          'depositRead',
          'cashierReconcileRead',
          'splitRead',
        );
      if (actions.length)
        set = set.grant(
          resources[kind]
            .reference()
            .grant(
              Object.fromEntries(actions.map((a) => [a, { records: scope }])),
            ),
        );
    }
    if (job !== 'tenant')
      set = set.grant(
        assetResource.reference().grant({ read: { records: 'allRecords' } }),
      );
    if (['finance', 'management'].includes(job))
      set = set
        .grant(
          financeResource
            .reference()
            .grant({ read: { contracts: 'allRecords', assets: 'allRecords' } }),
        )
        .grant(
          procurementResource
            .reference()
            .grant({ financeRead: { assets: 'allRecords' } }),
        );
    if (job === 'management')
      set = set.grant({
        resource: { type: 'settings', id: 'hyl.tenantService' },
        actions: [{ action: 'manage' }],
      });
    await authz.permissionSets.create(set.build());
    await authz.permissionSets.assign({
      permissionSet: 'TEST-job-' + job,
      subject: { type: 'user', id: user.id },
    });
    actors.push({
      job,
      user,
      session,
      access: await approvals.accessFor(user.id),
    });
  }
  const rootUsers = await hyl.users.list({
      search: DEFAULT_ADMIN_CREDENTIALS.email,
      page: 1,
      pageSize: 10,
    }),
    root = await approvals.accessFor(rootUsers.items[0].id);
  const tenant = actors.find((a) => a.job === 'tenant')!;
  const owned = await hyl.save(root, 'merchants', {
    name: 'TEST岗位自有商户',
    unit: 'TEST',
    contact: 'TEST',
    phone: '0',
    accountName: 'TEST',
    bank: 'TEST',
    account: '1234567890123456',
    userId: tenant.user.id,
  });
  const other = await hyl.save(root, 'merchants', {
    name: 'TEST岗位其他商户',
    unit: 'TEST',
    contact: 'TEST',
    phone: '0',
    accountName: 'TEST',
    bank: 'TEST',
    account: '1234567890123456',
  });
  for (const actor of actors) {
    expect(
      (await actor.session.fetch('/tenantOperations?view=leases')).status,
    ).toBe(200);
    expect(
      (await actor.session.fetch('/tenantOperations?view=reporting')).status,
    ).toBe(actor.job === 'leasing' ? 403 : 200);
    expect((await actor.session.fetch('/financialReports')).status).toBe(
      ['finance', 'management'].includes(actor.job) ? 200 : 403,
    );
    const grant = await actor.access.authorization.authorize({
      resource: { type: 'page', id: 'hyl-tenant-operations' },
      action: 'access',
    });
    expect(grant.effect).toBe('permit');
    if (['management', 'tenant'].includes(actor.job))
      await expect(
        hyl.save(
          actor.access,
          'merchants',
          owned.payload,
          owned.id,
          owned.version,
        ),
      ).rejects.toMatchObject({ status: 'PERMISSION_DENIED' });
    if (['leasing', 'management', 'tenant'].includes(actor.job))
      await expect(
        hyl.policy(actor.access, 'settlements', 'pay'),
      ).rejects.toMatchObject({ status: 'PERMISSION_DENIED' });
  }
  expect((await tenant.session.fetch('/merchants/' + owned.id)).status).toBe(
    200,
  );
  expect((await tenant.session.fetch('/merchants/' + other.id)).status).toBe(
    404,
  );
  const leasing = actors.find((a) => a.job === 'leasing')!;
  const newMerchant = await hyl.save(leasing.access, 'merchants', {
    ...other.payload,
    name: 'TEST招商岗位新建商户',
  });
  expect(newMerchant.name).toBe('TEST招商岗位新建商户');
  const finance = actors.find((a) => a.job === 'finance')!;
  await expect(
    hyl.policy(finance.access, 'settlements', 'pay'),
  ).resolves.toBeDefined();
  expect((await admin.fetch('/tenantOperations/serviceRecords')).status).toBe(
    200,
  );
  // No production users, roles or permission grants are changed by this isolated database test.
  expect(actionSchema.parse({ expectedVersion: 1 }).confirmation).toBe(
    'online',
  );
});
