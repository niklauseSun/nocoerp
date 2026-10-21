import { AppCommand } from '@nocobase/app-cli';
import { Flags } from '@oclif/core';
import { randomBytes, randomUUID } from 'node:crypto';
/** Explicit, local-only demo. Uses real public administration, authorization and domain services. */
export default class ApprovalsDemo extends AppCommand {
  static summary = 'Run the authorized local sequential approval demonstration';
  static flags = {
    'dry-run': Flags.boolean({
      description: 'Show the demo plan without creating accounts or data.',
    }),
  };
  async run() {
    const { flags } = await this.parse(ApprovalsDemo);
    if (flags['dry-run']) {
      this.setStatus('success-noop');
      return {
        accounts: ['审批演示申请人', '审批演示一级', '审批演示二级'],
        scope: '审批流程演示项目',
        flows: [
          'contract activation',
          'bill issue',
          'purchase rejection and resubmission',
        ],
        payments: 'none',
      };
    }
    return this.withApp(async ({ app, env }) => {
      if (env.NODE_ENV === 'production')
        throw Error('The approval demonstration is local development only.');
      await app.start();
      const [
        { approvalToken },
        { authorizationToken },
        { definePermissionSet },
        { resources },
        { assetResource },
        { procurementResource },
        { approvalResource },
        { buildFilter },
        { AssetService },
        { contractSchema },
      ] = await Promise.all([
        import('../../server/providers/approvals.js'),
        import('@nocobase/app-plugin-authorization'),
        import('@nocobase/authorization/permission-sets'),
        import('../../server/hyl/resources.js'),
        import('../../server/assets/resources.js'),
        import('../../server/procurement/resources.js'),
        import('../../server/approvals/resources.js'),
        import('@nocobase/repository-input'),
        import('../../server/providers/assets.js'),
        import('../../server/hyl/schema.js'),
      ]);
      const service = app.container.resolve(approvalToken),
        hyl = service.hyl,
        authz = app.container.resolve(authorizationToken),
        users = hyl.users,
        c = hyl.db.connection();
      const adminEmail = String(
          app.config.get('users.initialAdmin.email') ?? 'admin@nocobase.com',
        ),
        adminUser = (
          await users.list({ search: adminEmail, page: 1, pageSize: 20 })
        ).items.find((u) => u.email === adminEmail);
      if (!adminUser)
        throw Error('Configured initial administrator is unavailable.');
      const admin = await service.accessFor(adminUser.id);
      await service.policy(admin, 'configure');
      const assets = new AssetService(hyl),
        name = '审批流程演示项目';
      let project = await c
        .repository<{ id: string; name: string; type: string }>('hylAssets')
        .findOne({ filter: { name, type: 'project' } });
      if (!project)
        project = await assets.save(admin, {
          name,
          type: 'project',
          notes: 'DEMO-APPROVAL-20261019; no real payments',
        });
      const projectId = project.id;
      const projectScope = {
          type: 'recordAccess' as const,
          key: 'customFilter',
          params: {
            filter: buildFilter((f) => f.string('projectId').eq(projectId)),
          },
        },
        identities = [];
      for (const [i, name] of [
        '审批演示申请人',
        '审批演示一级',
        '审批演示二级',
      ].entries()) {
        const email =
          'approval-demo-' +
          ['applicant', 'level1', 'level2'][i] +
          '@local.example.test';
        let u = (
          await users.list({ search: email, page: 1, pageSize: 20 })
        ).items.find((x) => x.email === email);
        if (u && u.name !== name)
          throw Error('Demo identity conflicts with an existing account.');
        if (!u)
          u = await users.create({
            name,
            email,
            password: randomBytes(32).toString('hex'),
          });
        identities.push(u);
      }
      // Every account is restricted to this project's assets and this demo merchant. No configure, cancel, payment or user administration grant.
      const merchantName = '审批演示商户';
      let merchant = await c
        .repository<import('../../server/hyl/schema.js').Row>('hylMerchants')
        .findOne({ filter: { name: merchantName } });
      if (!merchant)
        merchant = await hyl.save(admin, 'merchants', {
          name: merchantName,
          unit: '审批演示A-01',
          contact: '本地模拟',
          phone: '0',
          accountName: '本地模拟',
          bank: '本地模拟',
          account: '0',
        });
      const merchantScope = {
          type: 'recordAccess' as const,
          key: 'customFilter',
          params: {
            filter: buildFilter((f) => f.string('id').eq(merchant.id)),
          },
        },
        contractScope = {
          type: 'recordAccess' as const,
          key: 'customFilter',
          params: {
            filter: buildFilter((f) => f.string('merchantId').eq(merchant.id)),
          },
        };
      for (const [i, u] of identities.entries()) {
        const key = 'approval-demo-' + u.id;
        if (!(await authz.permissionSets.get(key))) {
          let set = definePermissionSet(key)
            .grant(
              approvalResource.reference().grant({
                read: { assets: projectScope },
                ...(i === 0
                  ? { submit: { assets: projectScope } }
                  : { decide: { assets: projectScope } }),
              }),
            )
            .grant(
              assetResource.reference().grant({
                read: { records: projectScope },
                write: { records: projectScope },
              }),
            )
            .grant(
              resources.merchants
                .reference()
                .grant({ read: { records: merchantScope } }),
            )
            .grant(
              resources.contracts.reference().grant({
                read: { records: contractScope },
                write: { records: contractScope },
                billingRead: { records: contractScope },
                ...(i === 0
                  ? { billWrite: { records: contractScope } }
                  : { billIssue: { records: contractScope } }),
              }),
            )
            .grant(
              procurementResource.reference().grant({
                read: { assets: projectScope },
                ...(i === 0
                  ? { request: { assets: projectScope } }
                  : { review: { assets: projectScope } }),
              }),
            );
          for (const id of [
            'hyl-contracts',
            'hyl-billing',
            'hyl-procurement',
            'hyl-approvals',
          ])
            set = set.grant({
              resource: { type: 'page', id },
              actions: [{ action: 'access' }],
            });
          await authz.permissionSets.create(set.build());
        }
        const current = await authz.permissionSets.get(key);
        if (
          current &&
          !current.grants.some(
            (g) =>
              g.resource.type === 'page' && g.resource.id === 'hyl-approvals',
          )
        )
          await authz.permissionSets.update(key, {
            key,
            title: current.title,
            grants: [
              ...current.grants,
              {
                resource: { type: 'page', id: 'hyl-approvals' },
                actions: [{ action: 'access' }],
              },
            ],
          });
        if (
          !(await authz.permissionSets.listAssignments(key)).some(
            (a) => a.subject.type === 'user' && a.subject.id === u.id,
          )
        )
          await authz.permissionSets.assign({
            permissionSet: key,
            subject: { type: 'user', id: u.id },
          });
      }
      const [applicant, first, second] = await Promise.all(
        identities.map((u) => service.accessFor(u.id)),
      );
      const levels = [
        { name: '一级业务复核', userIds: [identities[1].id] },
        { name: '二级负责人审批', userIds: [identities[2].id] },
      ];
      for (const kind of ['contracts', 'bills', 'purchases'] as const) {
        const old = await service.config(admin, projectId, kind);
        if (!old.revision)
          await service.saveConfig(admin, {
            requestId: randomUUID(),
            expectedRevision: 0,
            projectId,
            kind,
            values: { enabled: true, levels },
          });
      }
      let street = await c
        .repository<{ id: string; name: string; parentId: string | null }>(
          'hylAssets',
        )
        .findOne({ filter: { name: '审批演示街区', parentId: projectId } });
      if (!street)
        street = await assets.save(admin, {
          name: '审批演示街区',
          type: 'street',
          parentId: projectId,
        });
      let unit = await c
        .repository<{ id: string; name: string; parentId: string | null }>(
          'hylAssets',
        )
        .findOne({ filter: { name: '审批演示A-01', parentId: street.id } });
      if (!unit)
        unit = await assets.save(admin, {
          name: '审批演示A-01',
          type: 'unit',
          parentId: street.id,
          area: '30',
          lettableArea: '30',
        });
      let contract = await c
        .repository<import('../../server/hyl/schema.js').Row>('hylContracts')
        .findOne({ filter: { merchantId: merchant.id } });
      if (!contract)
        contract = await hyl.save(
          applicant,
          'contracts',
          contractSchema.parse({
            merchantId: merchant.id,
            title: '审批演示租赁合同',
            start: '2026-10-17',
            end: '2027-10-16',
            cycle: 'month',
            method: 'fixed',
            basis: 'receipts',
            rate: '0',
            fixedFee: '0',
            minimum: '0',
            rent: '1000',
            includeActivity: true,
            includeCash: true,
            includeHospitality: false,
            depositTarget: '2000',
            assetIds: [unit.id],
          }),
        );
      const notes: string[] = [];
      const flow = async (
        kind: import('../../server/approvals/schema.js').Kind,
        sourceId: string,
        reject = false,
      ) => {
        let source = await service.sources.load(applicant, kind, sourceId);
        const view = await service.sourceView(applicant, kind, sourceId);
        let r = view.request
          ? await service.detail(admin, view.request.id)
          : await service.submit(applicant, {
              requestId: randomUUID(),
              kind,
              sourceId,
              expectedVersion: source.version,
              comment: '本地审批演示，单据与候选人快照',
            });
        if (r.status === 'pending' && r.level === 0) {
          r = await service.decide(first, r.id, {
            requestId: randomUUID(),
            expectedVersion: r.version,
            action: 'approve',
            comment: '一级复核通过，业务暂不生效',
          });
          notes.push(
            kind +
              ': 一级通过，业务状态 ' +
              (await service.sources.load(admin, kind, sourceId)).status,
          );
        }
        if (reject && r.round === 1 && r.status === 'pending') {
          r = await service.decide(second, r.id, {
            requestId: randomUUID(),
            expectedVersion: r.version,
            action: 'reject',
            comment: '演示驳回：补充采购理由后重提',
          });
          notes.push(kind + ': 二级驳回，业务回到草稿');
        }
        if (r.status === 'rejected') {
          const request = await service.sources.procurement.row(
            'requests',
            sourceId,
          );
          if (kind === 'purchases' && r.round === 1)
            await service.sources.procurement.act(
              applicant,
              'requests',
              sourceId,
              {
                requestId: randomUUID(),
                expectedVersion: request.version,
                action: 'edit',
                values: {
                  title: request.title,
                  neededOn: String(request.payload.neededOn),
                  reason: '补充说明：维修照明耗材，仅模拟采购',
                  notes: '本地演示',
                  items: [
                    {
                      name: '灯具',
                      spec: '',
                      unit: '个',
                      quantity: 2,
                      unitPrice: '50',
                    },
                  ],
                },
              },
            );
          source = await service.sources.load(applicant, kind, sourceId);
          r = await service.submit(applicant, {
            requestId: randomUUID(),
            kind,
            sourceId,
            expectedVersion: source.version,
            comment: '补充说明后重提，沿用冻结配置',
          });
          r = await service.decide(first, r.id, {
            requestId: randomUUID(),
            expectedVersion: r.version,
            action: 'approve',
            comment: '一级重新复核通过',
          });
        }
        if (r.status === 'pending')
          r = await service.decide(second, r.id, {
            requestId: randomUUID(),
            expectedVersion: r.version,
            action: 'approve',
            comment: '二级最终通过，执行业务生效',
          });
        return {
          id: r.id,
          round: r.round,
          status: r.status,
          sourceId,
          sourceStatus: (await service.sources.load(admin, kind, sourceId))
            .status,
        };
      };
      const contractResult = await flow('contracts', contract.id);
      contract = await hyl.get(admin, 'contracts', contract.id);
      const billing = service.sources.billing;
      const config = await billing.configuration(admin, contract.id, true);
      if (!config.version) {
        const { configSchema } = await import('../../server/billing/model.js');
        await billing.saveConfiguration(
          admin,
          contract.id,
          configSchema.parse({
            requestId: randomUUID(),
            expectedVersion: 0,
            effectiveFrom: '2026-10-17',
            rentChannel: 'bill',
            property: { enabled: true, method: 'fixed', price: '100' },
            utilities: {},
            meters: [],
          }),
        );
      }
      let bill = await c
        .repository<import('../../server/billing/model.js').Bill>('hylBills')
        .findOne({ filter: { contractId: contract.id } });
      if (!bill) {
        const { billCreateSchema } =
          await import('../../server/billing/model.js');
        bill = await billing.createBill(
          admin,
          billCreateSchema.parse({
            requestId: randomUUID(),
            contractId: contract.id,
            expectedContractVersion: contract.version,
            configVersion: 1,
            month: '2026-10',
            part: 'month',
            dueDate: '2026-10-31',
            fees: ['rent', 'property'],
            readings: [],
            others: [],
          }),
        );
      }
      const billResult = await flow('bills', bill.id);
      let purchase = await c
        .repository<import('../../server/procurement/model.js').Row>(
          'hylPurchaseRequests',
        )
        .findOne({ filter: { projectId, title: '审批演示照明采购' } });
      if (!purchase)
        purchase = await service.sources.procurement.createRequest(
          applicant,
          {
            title: '审批演示照明采购',
            assetId: unit.id,
            neededOn: '2026-10-31',
            reason: '维修灯具，仅模拟采购',
            repairId: '',
            notes: '本地演示',
            items: [
              {
                name: '灯具',
                unit: '个',
                quantity: 2,
                unitPrice: '50',
                spec: '',
              },
            ],
          },
          randomUUID(),
        );
      const purchaseResult = await flow('purchases', purchase.id, true);
      return {
        projectId,
        accounts: identities.map((u) => ({ id: u.id, name: u.name })),
        contract: contractResult,
        bill: billResult,
        purchase: purchaseResult,
        notes,
        payments: 'none',
      };
    });
  }
}
