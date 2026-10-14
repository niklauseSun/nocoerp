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
      return new HylService(
        db,
        runtime,
        this.app.container.resolve(userAdministrationServiceToken),
      );
    });
  }
  override async boot(): Promise<void> {
    registerResources(
      this.app.container.resolve(authorizationToken),
      this.app.container.resolve(databaseManagerToken),
    );
  }
}
