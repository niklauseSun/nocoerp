import type { Application } from '@nocobase/app-server/application';
import { ServiceProvider } from '@nocobase/service-provider';
import { schedulerServiceToken } from '@nocobase/app-plugin-scheduler/server/tokens';
import { authorizationToken } from '@nocobase/app-plugin-authorization';
import { hylToken } from './hyl.js';
import { InspectionService } from '../inspections/service.js';
export default class InspectionSchedules extends ServiceProvider<Application> {
  readonly name = 'nocoerp/inspection-schedules';
  override boot(): Promise<void> {
    const scheduler = this.app.container.resolve(schedulerServiceToken),
      service = new InspectionService(this.app.container.resolve(hylToken)),
      authz = this.app.container.resolve(authorizationToken);
    scheduler.registerTarget({
      type: 'app.inspections.dispatch',
      title: 'Inspection task dispatch',
      validate: (config) =>
        config !== null &&
        typeof config === 'object' &&
        !Array.isArray(config) &&
        Object.keys(config).length === 0
          ? { valid: true }
          : { valid: false, reason: 'empty-config-required' },
      start: async () => {
        const result = await service.tick(authz);
        return result.failed
          ? { state: 'failed', reason: 'INSPECTION_DISPATCH_FAILED' }
          : { state: 'completed', outcome: 'succeeded', result };
      },
    });
    scheduler.defineSchedule({
      key: 'inspections.dispatch',
      title: 'Inspection task dispatch',
      description: 'Generate due inspection, security and cleaning tasks',
      schedule: { cron: '*/5 * * * *', timezone: 'Asia/Shanghai' },
      target: { type: 'app.inspections.dispatch', config: {} },
    });
    return Promise.resolve();
  }
}
