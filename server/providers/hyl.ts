import { registerFinance } from '../finance/resources.js';
import { tenantServiceLifecycle } from '../tenant-operations/delivery-model.js';
import { approvalLifecycle, contractLifecycle } from '../approvals/model.js';
import { parameters } from '../approvals/parameters.js';
import { todoLifecycle } from '../messages/model.js';
import { lifecycles as procurementLifecycles } from '../procurement/model.js';
import { registerProcurement } from '../procurement/resources.js';
import {
  planLifecycle,
  taskLifecycle,
  issueLifecycle,
} from '../inspections/model.js';
import { registerInspections } from '../inspections/resources.js';
import { repairLifecycle } from '../repairs/model.js';
import { registerRepairs } from '../repairs/resources.js';
import { meterLifecycle, readingLifecycle } from '../energy/model.js';
import { registerEnergy } from '../energy/resources.js';
import { sourceLifecycle, invoiceLifecycle } from '../invoicing/model.js';
import { splitLifecycle } from '../profit-sharing/model.js';
import { registerAssets } from '../assets/resources.js';
import { userAdministrationServiceToken } from '@nocobase/app-plugin-authentication';
import type { Application } from '@nocobase/app-server/application';
import { databaseManagerToken } from '@nocobase/db';
import {
  LifecycleRuntime,
  createRepositoryLifecycleStore,
} from '@nocobase/lifecycle';
import {
  createServiceToken,
  ServiceProvider,
} from '@nocobase/service-provider';
import { authorizationToken } from '@nocobase/app-plugin-authorization';
import { orderLifecycle, reconciliationLifecycle } from '../cashier/model.js';
import { billLifecycle, receiptLifecycle } from '../billing/model.js';
import { leaseLifecycle } from '../leases/model.js';
import { HylService } from '../hyl/service.js';
import { reportingLifecycle, settlementLifecycle } from '../hyl/lifecycles.js';
import { registerResources } from '../hyl/resources.js';

export const hylToken = createServiceToken<HylService>('nocoerp/hyl');
export default class HylProvider extends ServiceProvider<Application> {
  readonly name = 'nocoerp/hyl';
  override register(): void {
    this.app.container.singleton(hylToken, () => {
      const db = this.app.container.resolve(databaseManagerToken);
      // These definitions have no asynchronous effects or triggers. All work commits in the originating transaction.
      const runtime = new LifecycleRuntime({
        store: createRepositoryLifecycleStore(db, {
          collections: {
            transitions: 'hylTransitions',
            effectRuns: 'hylEffectRuns',
          },
        }),
      });
      runtime.register(reportingLifecycle('hylRevenueReports'));
      runtime.register(reportingLifecycle('hylExpenses'));
      runtime.register(settlementLifecycle);
      runtime.register(tenantServiceLifecycle);
      runtime.register(leaseLifecycle);
      runtime.register(billLifecycle);
      runtime.register(splitLifecycle);
      runtime.register(sourceLifecycle);
      runtime.register(invoiceLifecycle);
      runtime.register(orderLifecycle);
      runtime.register(reconciliationLifecycle);
      runtime.register(receiptLifecycle);
      runtime.register(planLifecycle);
      runtime.register(taskLifecycle);
      runtime.register(issueLifecycle);
      runtime.register(repairLifecycle);
      runtime.register(todoLifecycle);
      runtime.register(contractLifecycle);
      runtime.register(approvalLifecycle, {
        parameterConfiguration: {
          store: parameters(db),
          scope: ({ record }) => String(record?.scope),
          legacyRecord: () => false,
          snapshotRequired: (record) => record.status !== 'draft',
        },
      });
      for (const lifecycle of procurementLifecycles)
        runtime.register(lifecycle);
      runtime.register(meterLifecycle);
      runtime.register(readingLifecycle);
      return new HylService(
        db,
        runtime,
        this.app.container.resolve(userAdministrationServiceToken),
      );
    });
  }
  override async boot(): Promise<void> {
    this.app.container.resolve(authorizationToken).settings.add({
      id: 'hyl.integrationTesting',
      title: { key: 'operations.integrations', ns: 'nocoerp' },
      actions: [
        { name: 'run', title: { key: 'operations.runTest', ns: 'nocoerp' } },
      ],
    });
    this.app.container
      .resolve(authorizationToken)
      .ui.place(
        { type: 'settings', id: 'hyl.integrationTesting' },
        { section: 'hyl' },
      );
    this.app.container.resolve(authorizationToken).settings.add({
      id: 'hyl.tenantService',
      title: { key: 'operations.tenantService', ns: 'nocoerp' },
      actions: [
        {
          name: 'manage',
          title: { key: 'operations.serviceManage', ns: 'nocoerp' },
        },
      ],
    });
    this.app.container
      .resolve(authorizationToken)
      .ui.place(
        { type: 'settings', id: 'hyl.tenantService' },
        { section: 'hyl' },
      );
    registerFinance(this.app.container.resolve(authorizationToken));
    this.app.container.resolve(authorizationToken).settings.add({
      id: 'hyl.externalReconciliation',
      title: { key: 'operations.reconciliation', ns: 'nocoerp' },
      actions: [
        { name: 'write', title: { key: 'operations.import', ns: 'nocoerp' } },
      ],
    });
    this.app.container
      .resolve(authorizationToken)
      .ui.place(
        { type: 'settings', id: 'hyl.externalReconciliation' },
        { section: 'hyl' },
      );
    registerProcurement(this.app.container.resolve(authorizationToken));
    registerInspections(this.app.container.resolve(authorizationToken));
    registerRepairs(this.app.container.resolve(authorizationToken));
    registerEnergy(this.app.container.resolve(authorizationToken));
    registerResources(
      this.app.container.resolve(authorizationToken),
      this.app.container.resolve(databaseManagerToken),
    );
    await registerAssets(
      this.app.container.resolve(authorizationToken),
      this.app.container.resolve(databaseManagerToken),
    );
  }
}
