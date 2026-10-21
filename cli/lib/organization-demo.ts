import { randomBytes, randomUUID } from 'node:crypto';
import { definePermissionSet } from '@nocobase/authorization/permission-sets';
import type { OrganizationService } from '../../server/organization/service.js';
import type { HylService, Access } from '../../server/hyl/service.js';
import { resources } from '../../server/hyl/resources.js';
import { assetResource } from '../../server/assets/resources.js';
import { financeResource } from '../../server/finance/resources.js';
import { energyResource } from '../../server/energy/resources.js';
import { repairResource } from '../../server/repairs/resources.js';
import { inspectionResource } from '../../server/inspections/resources.js';
import { procurementResource } from '../../server/procurement/resources.js';
import { approvalResource } from '../../server/approvals/resources.js';
import { runFinanceDemo } from './finance-demo.js';
import { FinanceService } from '../../server/finance/service.js';
export async function accessFor(
  org: OrganizationService,
  id: string,
): Promise<Access> {
  const principal = { type: 'user', id };
  return {
    actor: id,
    authorization: org.authz.for({
      principal,
      subjects: [
        { type: 'authenticated', id: '*' },
        ...(await org.authz.subjects.resolveFor(principal)),
      ],
    }),
  };
}
export function organizationReader(key: string) {
  let set = definePermissionSet(key).title('Organization demo reader');
  const scope = 'hyl.assignedProjects';
  for (const kind of [
    'merchants',
    'revenueReports',
    'expenses',
    'settlements',
  ] as const)
    set = set.grant(
      resources[kind].reference().grant({ read: { records: scope } }),
    );
  set = set.grant(
    resources.contracts
      .reference()
      .grant(
        Object.fromEntries(
          [
            'read',
            'billingRead',
            'receiptRead',
            'depositRead',
            'cashierRead',
            'cashierReconcileRead',
            'splitRead',
            'invoiceRead',
          ].map((a) => [a, { records: scope }]),
        ),
      ),
  );
  set = set
    .grant(assetResource.reference().grant({ read: { records: scope } }))
    .grant(
      financeResource
        .reference()
        .grant({ read: { contracts: scope, assets: scope } }),
    );
  set = set.grant(
    energyResource
      .reference()
      .grant({ meterRead: { assets: scope }, readingRead: { assets: scope } }),
  );
  for (const r of [
    repairResource,
    inspectionResource,
    procurementResource,
    approvalResource,
  ])
    set = set.grant(
      r.reference().grant({
        read: { assets: scope },
        ...(r === procurementResource
          ? { financeRead: { assets: scope } }
          : {}),
      }),
    );
  for (const id of [
    'assets',
    'merchants',
    'contracts',
    'revenueReports',
    'expenses',
    'settlements',
    'billing',
    'cashier',
    'profit-sharing',
    'invoicing',
    'energy',
    'repairs',
    'inspections',
    'procurement',
    'approvals',
    'financial-reports',
  ])
    set = set.grant({
      resource: { type: 'page', id: 'hyl-' + id },
      actions: [{ action: 'access' }],
    });
  return set.build();
}
/** Explicit local-only workflow. Creates only the three authorized demo identities and grants no system administration or payment actions. */
export async function runOrganizationDemo(
  org: OrganizationService,
  hyl: HylService,
  admin: Access,
  credentials?: { password: string },
) {
  const tag = 'DEMO-ORG-' + randomUUID().slice(0, 8),
    authz = org.authz,
    identities = [];
  for (const [i, name] of [
    '组织演示项目甲负责人',
    '组织演示项目甲员工',
    '组织演示项目乙员工',
  ].entries())
    identities.push(
      await hyl.users.create({
        name,
        email: `org-${tag.toLowerCase()}-${i}@local.example.test`,
        password: credentials?.password ?? randomBytes(32).toString('hex'),
      }),
    );
  const first = await runFinanceDemo(hyl, admin),
    second = await runFinanceDemo(hyl, admin),
    root = await org.department(admin.actor, {
      title: '组织权限演示中心 ' + tag,
      parentId: null,
      active: true,
      version: 0,
    }),
    a = await org.department(admin.actor, {
      title: '演示项目甲部门',
      parentId: root.id,
      active: true,
      version: 0,
    }),
    b = await org.department(admin.actor, {
      title: '演示项目乙部门',
      parentId: root.id,
      active: true,
      version: 0,
    });
  for (const [i, u] of identities.entries())
    await org.member(admin.actor, i === 2 ? b.id : a.id, {
      userId: u.id,
      active: true,
      primary: true,
    });
  await org.project(admin.actor, {
    projectId: first.projectId,
    subjectType: 'org.department',
    subjectId: a.id,
    active: true,
    version: 0,
  });
  await org.project(admin.actor, {
    projectId: second.projectId,
    subjectType: 'org.department',
    subjectId: b.id,
    active: true,
    version: 0,
  });
  const reader = organizationReader(tag.toLowerCase() + '-reader');
  await authz.permissionSets.create(reader);
  const inherited = await authz.permissionSets.assign({
    permissionSet: reader.key,
    subject: { type: 'org.department', id: root.id },
  });
  const manager = definePermissionSet(tag.toLowerCase() + '-manager')
    .title('Organization demo asset maintainer')
    .grant(
      assetResource.reference().grant({
        read: { records: 'hyl.assignedProjects' },
        write: { records: 'hyl.assignedProjects' },
      }),
    )
    .grant({
      resource: { type: 'page', id: 'hyl-assets' },
      actions: [{ action: 'access' }],
    })
    .build();
  await authz.permissionSets.create(manager);
  await authz.permissionSets.assign({
    permissionSet: manager.key,
    subject: { type: 'user', id: identities[0].id },
  });
  const evidence: { stage: string; result: string }[] = [],
    finance = new FinanceService(hyl);
  for (const [i, u] of identities.entries()) {
    const access = await accessFor(org, u.id),
      expected = i === 2 ? second : first,
      foreign = i === 2 ? first : second,
      own = await finance.report(access, {
        from: '2000-01-01',
        to: '2099-12-31',
        projectId: expected.projectId,
        view: 'cash',
        q: '',
        order: '-at',
        page: 1,
        pageSize: 20,
      }),
      hidden = await finance.report(access, {
        from: '2000-01-01',
        to: '2099-12-31',
        projectId: foreign.projectId,
        view: 'cash',
        q: '',
        order: '-at',
        page: 1,
        pageSize: 20,
      });
    if (
      own.data.summary.netCents !== '-90000' ||
      hidden.data.summary.netCents !== '0'
    )
      throw Error('Project finance isolation failed');
    if (
      (await hyl.get(access, 'contracts', expected.contractId)).id !==
      expected.contractId
    )
      throw Error('Own project access failed');
    let denied = false;
    try {
      await hyl.get(access, 'contracts', foreign.contractId);
    } catch {
      denied = true;
    }
    if (!denied) throw Error('Foreign contract leaked');
    if (
      await access.authorization.can({
        resource: { type: 'composite', id: 'hyl.contracts' },
        action: 'cashierCheckout',
      })
    )
      throw Error('Unexpected payment access');
    evidence.push({
      stage: u.name,
      result:
        'own project visible; foreign contract hidden; foreign financial totals zero; payment denied',
    });
  }
  await authz.permissionSets.revoke(inherited.id);
  const direct = await accessFor(org, identities[0].id);
  if (
    (
      await direct.authorization.authorize({
        resource: { type: 'composite', id: 'hyl.assets' },
        action: 'write',
      })
    ).effect === 'deny'
  )
    throw Error('Independent direct grant lost');
  const removed = await accessFor(org, identities[1].id);
  if (
    (
      await removed.authorization.authorize({
        resource: { type: 'composite', id: 'hyl.assets' },
        action: 'read',
      })
    ).effect !== 'deny'
  )
    throw Error('Inherited grant survived revocation');
  evidence.push({
    stage: 'revoke inherited role',
    result: 'staff denied; independent manager asset permission retained',
  });
  await authz.permissionSets.assign({
    permissionSet: reader.key,
    subject: { type: 'org.department', id: root.id },
  });
  await org.member(admin.actor, b.id, {
    userId: identities[2].id,
    active: false,
    primary: false,
  });
  if ((await org.projectIds(identities[2].id)).length)
    throw Error('Removed membership retained scope');
  await org.member(admin.actor, b.id, {
    userId: identities[2].id,
    active: true,
    primary: true,
  });
  evidence.push({
    stage: 'remove and restore membership',
    result: 'project scope removed immediately and restored',
  });
  let current = (await org.tree()).find((x) => x.id === a.id)!;
  await org.department(admin.actor, { ...current, active: false }, a.id);
  if ((await org.projectIds(identities[0].id)).length)
    throw Error('Inactive department retained project scope');
  current = (await org.tree()).find((x) => x.id === a.id)!;
  await org.department(admin.actor, { ...current, active: true }, a.id);
  evidence.push({
    stage: 'disable and enable department',
    result:
      'inherited role and project access disappear and return on fresh request',
  });
  return {
    tag,
    accounts: identities.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
    })),
    departments: { root: root.id, a: a.id, b: b.id },
    roles: { reader: reader.key, manager: manager.key },
    projects: { a: first, b: second },
    evidence,
  };
}
