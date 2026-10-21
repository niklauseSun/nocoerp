import type { Application } from '@nocobase/app-server/application';
import {
  ServiceProvider,
  createServiceToken,
} from '@nocobase/service-provider';
import { authorizationToken } from '@nocobase/app-plugin-authorization';
import { hylToken } from './hyl.js';
import { ApprovalService } from '../approvals/service.js';
import { registerApprovals } from '../approvals/resources.js';
export const approvalToken =
  createServiceToken<ApprovalService>('nocoerp/approvals');
export default class ApprovalsProvider extends ServiceProvider<Application> {
  readonly name = 'nocoerp/approvals';
  override register() {
    this.app.container.singleton(
      approvalToken,
      () =>
        new ApprovalService(
          this.app.container.resolve(hylToken),
          this.app.container.resolve(authorizationToken),
        ),
    );
  }
  override async boot() {
    registerApprovals(this.app.container.resolve(authorizationToken));
  }
}
