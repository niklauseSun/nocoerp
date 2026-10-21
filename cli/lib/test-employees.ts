import { definePermissionSet } from '@nocobase/authorization/permission-sets';
import type { UserManagementService } from '@nocobase/app-plugin-users/server/tokens';
import type { HylService, Access } from '../../server/hyl/service.js';
import type { OrganizationService } from '../../server/organization/service.js';
import { AssetService } from '../../server/providers/assets.js';
import { resources } from '../../server/hyl/resources.js';
import { assetResource } from '../../server/assets/resources.js';
import { financeResource } from '../../server/finance/resources.js';
import { procurementResource } from '../../server/procurement/resources.js';
import { repairResource } from '../../server/repairs/resources.js';
import { inspectionResource } from '../../server/inspections/resources.js';
import { energyResource } from '../../server/energy/resources.js';
import { approvalResource } from '../../server/approvals/resources.js';
import {
  contractSchema,
  actionSchema,
  type Kind,
} from '../../server/hyl/schema.js';
import { dayOf } from '../../server/cashier/reports.js';
import { accessFor } from './organization-demo.js';
export const jobs = [
  { key: 'admin', title: '系统管理员', department: '系统管理部' },
  { key: 'leasing', title: '招商运营', department: '招商运营部' },
  { key: 'finance', title: '财务人员', department: '财务部' },
  { key: 'property', title: '物业人员', department: '物业服务部' },
  { key: 'management', title: '管理层', department: '经营管理部' },
] as const;
export type Job = (typeof jobs)[number]['key'];
const scope = 'hyl.assignedProjects';
export const employeeEmail = (job: Job, tag: string) =>
  `test-${job}-${tag}@hyl.example.test`;
export const employeeRole = (job: Job, tag: string) =>
  `test-staff-${tag}-${job}`;
export function employeePermissions(job: Job, tag: string) {
  let set = definePermissionSet(employeeRole(job, tag)).title(
    'TEST ' + jobs.find((j) => j.key === job)!.title + ' ' + tag,
  );
  const settings = (id: string, actions: string[]) => {
    set = set.grant({
      resource: { type: 'settings', id },
      actions: actions.map((action) => ({ action })),
    });
  };
  const pages = (ids: string[]) => {
    for (const id of ids)
      set = set.grant({
        resource: { type: 'page', id },
        actions: [{ action: 'access' }],
      });
  };
  const business = (kind: Kind, actions: string[]) => {
    set = set.grant(
      resources[kind]
        .reference()
        .grant(Object.fromEntries(actions.map((a) => [a, { records: scope }]))),
    );
  };
  if (job === 'admin') {
    settings('hyl.organization', ['read', 'update']);
    settings('authorization.permission-sets', [
      'read',
      'create',
      'update',
      'assign',
    ]);
    settings('authorization.inspector', ['inspect']);
    set = set.grant({
      resource: { type: 'user', id: '*' },
      actions: [
        'read',
        'create',
        'update',
        'disable',
        'enable',
        'assign-role',
        'reset-password',
        'revoke-sessions',
      ].map((action) => ({ action })),
    });
  } else {
    pages(['hyl-assets']);
    set = set.grant(
      assetResource.reference().grant({
        read: { records: scope },
        ...(job === 'leasing' ? { write: { records: scope } } : {}),
      }),
    );
    for (const kind of ['merchants', 'contracts'] as const)
      business(kind, job === 'leasing' ? ['read', 'write'] : ['read']);
    if (job !== 'property') {
      pages([
        'hyl-merchants',
        'hyl-contracts',
        'hyl-revenueReports',
        'hyl-expenses',
        'hyl-settlements',
        'hyl-tenant-operations',
      ]);
      business(
        'revenueReports',
        job === 'finance' ? ['read', 'review'] : ['read'],
      );
      business(
        'expenses',
        job === 'finance' ? ['read', 'write', 'submit', 'review'] : ['read'],
      );
      business(
        'settlements',
        job === 'finance'
          ? ['read', 'write', 'review', 'confirm', 'pay']
          : ['read'],
      );
    }
    if (job === 'leasing') {
      business('contracts', [
        'renew',
        'terminate',
        'closeLease',
        'depositRead',
        'billingRead',
        'receiptRead',
      ]);
      settings('hyl.tenantService', ['manage']);
    }
    if (job === 'finance' || job === 'management') {
      pages(['hyl-billing', 'hyl-cashier', 'hyl-financial-reports']);
      const read = [
        'billingRead',
        'receiptRead',
        'depositRead',
        'cashierRead',
        'cashierReconcileRead',
        'splitRead',
        'invoiceRead',
      ];
      const write = [
        'billingConfigure',
        'billWrite',
        'billIssue',
        'billVoid',
        'receiptReceive',
        'receiptAllocate',
        'receiptReverse',
        'receiptRefund',
        'depositReceive',
        'depositDeduct',
        'depositRefund',
        'depositTransfer',
        'depositReverse',
        'collectionReceive',
        'collectionReverse',
        'chargeWrite',
        'chargeConfirm',
        'cashierCheckout',
        'cashierRefund',
        'cashierReverse',
        'cashierReconcile',
      ];
      business('contracts', job === 'finance' ? [...read, ...write] : read);
      set = set
        .grant(
          financeResource
            .reference()
            .grant({ read: { contracts: scope, assets: scope } }),
        )
        .grant(
          procurementResource
            .reference()
            .grant({ financeRead: { assets: scope } }),
        );
      if (job === 'finance') settings('hyl.externalReconciliation', ['write']);
    }
    if (job === 'property' || job === 'management') {
      pages(['hyl-repairs', 'hyl-inspections', 'hyl-energy']);
      const actions =
        job === 'property'
          ? [
              'read',
              'report',
              'dispatch',
              'process',
              'accept',
              'close',
              'cancel',
            ]
          : ['read'];
      set = set.grant(
        repairResource
          .reference()
          .grant(
            Object.fromEntries(actions.map((a) => [a, { assets: scope }])),
          ),
      );
      set = set.grant(
        inspectionResource
          .reference()
          .grant(
            Object.fromEntries(
              (job === 'property'
                ? ['read', 'manage', 'execute', 'rectify', 'review']
                : ['read']
              ).map((a) => [a, { assets: scope }]),
            ),
          ),
      );
      set = set.grant(
        energyResource
          .reference()
          .grant(
            Object.fromEntries(
              (job === 'property'
                ? ['meterRead', 'meterWrite', 'readingRead', 'readingWrite']
                : ['meterRead', 'readingRead']
              ).map((a) => [a, { assets: scope }]),
            ),
          ),
      );
    }
    if (job === 'management') {
      pages(['hyl-approvals']);
      set = set.grant(
        approvalResource
          .reference()
          .grant({ read: { assets: scope }, decide: { assets: scope } }),
      );
    }
  }
  return set.build();
}
export async function provisionTestEmployees(
  org: OrganizationService,
  hyl: HylService,
  users: UserManagementService,
  admin: Access,
  tag: string,
  passwords: Record<Job, string>,
) {
  if (!/^[a-z0-9-]{4,24}$/.test(tag)) throw Error('Invalid test batch tag');
  const definitions = new Map(
    jobs.map((job) => [job.key, employeePermissions(job.key, tag)]),
  );
  // Preflight all names before any mutation. Never reset passwords or modify an existing identity/role on rerun.
  for (const j of jobs) {
    if (
      (
        await users.list({
          search: employeeEmail(j.key, tag),
          page: 1,
          pageSize: 20,
        })
      ).items.some((u) => u.email === employeeEmail(j.key, tag)) ||
      (await org.authz.permissionSets.get(employeeRole(j.key, tag)))
    )
      throw Error('Test batch already exists; use a new tag');
  }
  const assets = new AssetService(hyl),
    today = dayOf(new Date().toISOString()),
    month = today.slice(0, 7),
    start = month + '-01',
    end = new Date(
      Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
    )
      .toISOString()
      .slice(0, 10);
  const fixtures = [];
  for (const label of ['A', 'B']) {
    const project = await assets.save(admin, {
      name: `TEST 员工验收项目${label} ${tag}`,
      type: 'project',
      notes: 'TEST 合成数据，不用于真实业务',
    });
    const street = await assets.save(admin, {
      name: `TEST 街区${label}`,
      type: 'street',
      parentId: project.id,
    });
    const unit = await assets.save(admin, {
      name: `TEST ${label}101铺位`,
      type: 'unit',
      parentId: street.id,
      area: '30',
      lettableArea: '30',
    });
    const merchant = await hyl.save(admin, 'merchants', {
      name: `TEST 员工验收商户${label} ${tag}`,
      unit: `TEST ${label}101`,
      contact: 'TEST联系人',
      phone: '00000000000',
      accountName: 'TEST 非真实收款人',
      bank: 'TEST 非真实银行',
      account: '0',
      notes: 'TEST 合成数据',
    });
    const contract = await hyl.save(
      admin,
      'contracts',
      contractSchema.parse({
        merchantId: merchant.id,
        assetIds: [unit.id],
        title: `TEST 岗位验收合同${label} ${tag}`,
        start,
        end,
        cycle: 'half',
        method: 'commission',
        basis: 'receipts',
        rate: '10',
        fixedFee: '0',
        minimum: '0',
        rent: '0',
        depositTarget: '0',
        includeActivity: true,
        includeCash: true,
        includeHospitality: false,
        notes: 'TEST 合同，不得用于真实结算',
      }),
    );
    let report = await hyl.save(admin, 'revenueReports', {
      merchantId: merchant.id,
      date: today,
      source: 'bank',
      reference: `TEST-STAFF-${tag}-${label}`,
      receipts: '100',
      refunds: '0',
      activity: '0',
      cash: '0',
      hospitality: '0',
      collected: '100',
      evidence: 'TEST 合成凭证，无真实资金',
      notes: 'TEST 待审核报送',
    });
    report = await hyl.act(
      admin,
      'revenueReports',
      report.id,
      'submit',
      actionSchema.parse({ expectedVersion: report.version }),
    );
    fixtures.push({
      projectId: project.id,
      projectName: project.name,
      unitId: unit.id,
      merchantId: merchant.id,
      contractId: contract.id,
      reportId: report.id,
    });
  }
  const root = await org.department(admin.actor, {
    title: 'TEST 测试员工中心 ' + tag,
    parentId: null,
    active: true,
    version: 0,
  });
  const accounts = [];
  for (const j of jobs) {
    const department = await org.department(admin.actor, {
      title: 'TEST ' + j.department,
      parentId: root.id,
      active: true,
      version: 0,
    });
    const role = definitions.get(j.key)!;
    await org.authz.permissionSets.create(role);
    const user = await users.create({
      name: 'TEST ' + j.title,
      email: employeeEmail(j.key, tag),
      password: passwords[j.key],
      roleScopes: { app: [role.key] },
    });
    await org.member(admin.actor, department.id, {
      userId: user.id,
      active: true,
      primary: true,
    });
    for (const fixture of j.key === 'admin' ? fixtures : [fixtures[0]])
      await org.project(admin.actor, {
        projectId: fixture.projectId,
        subjectType: 'org.department',
        subjectId: department.id,
        active: true,
        version: 0,
      });
    accounts.push({
      job: j.key,
      title: j.title,
      id: user.id,
      email: user.email,
      department: department.title,
      departmentId: department.id,
      role: role.key,
    });
  }
  const evidence = [];
  for (const account of accounts) {
    const a = await accessFor(org, account.id);
    if (
      !(await a.authorization.can({
        resource: {
          type: 'page',
          id:
            account.job === 'admin'
              ? 'hyl-organization'
              : account.job === 'property'
                ? 'hyl-repairs'
                : 'hyl-merchants',
        },
        action: account.job === 'admin' ? 'access' : 'access',
      }))
    ) {
      // Organization is protected by settings on its route, not a page grant.
      if (
        account.job !== 'admin' ||
        !(await a.authorization.can({
          resource: { type: 'settings', id: 'hyl.organization' },
          action: 'read',
        }))
      )
        throw Error('Assigned page access missing: ' + account.job);
    }
    if (account.job !== 'admin') {
      await assets.get(a, fixtures[0].unitId);
      let denied = false;
      try {
        await assets.get(a, fixtures[1].unitId);
      } catch (e) {
        if (
          e &&
          typeof e === 'object' &&
          'status' in e &&
          e.status === 'NOT_FOUND'
        )
          denied = true;
        else throw e;
      }
      if (!denied) throw Error('Foreign test project leaked');
      await hyl.get(a, 'contracts', fixtures[0].contractId);
      denied = false;
      try {
        await hyl.get(a, 'contracts', fixtures[1].contractId);
      } catch (e) {
        if (
          e &&
          typeof e === 'object' &&
          'status' in e &&
          e.status === 'NOT_FOUND'
        )
          denied = true;
        else throw e;
      }
      if (!denied) throw Error('Foreign contract leaked');
    }
    const pay = await a.authorization.can({
      resource: { type: 'composite', id: 'hyl.settlements' },
      action: 'pay',
    });
    if (pay !== (account.job === 'finance'))
      throw Error('Unexpected payout grant: ' + account.job);
    evidence.push({
      job: account.job,
      projectScope:
        account.job === 'admin'
          ? 'organization administration; TEST A/B'
          : 'TEST A only; TEST B denied',
      pay,
    });
  }
  return { tag, rootDepartmentId: root.id, accounts, fixtures, evidence };
}
