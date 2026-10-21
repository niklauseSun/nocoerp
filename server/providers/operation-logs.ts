import {
  ServiceProvider,
  createServiceToken,
} from '@nocobase/service-provider';
import type { Application } from '@nocobase/app-server/application';
import { hylToken } from './hyl.js';
import { OperationLogs } from '../operation-logs/service.js';
export const operationLogsToken = createServiceToken<OperationLogs>(
  'nocoerp/operationLogs',
);
export default class OperationLogsProvider extends ServiceProvider<Application> {
  readonly name = 'nocoerp/operationLogs';
  override register() {
    this.app.container.singleton(
      operationLogsToken,
      () => new OperationLogs(this.app.container.resolve(hylToken).db),
    );
  }
}
