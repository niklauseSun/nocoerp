import type { Application } from '@nocobase/app-server/application';
import {
  ServiceProvider,
  createServiceToken,
} from '@nocobase/service-provider';
import { authorizationToken } from '@nocobase/app-plugin-authorization';
import { hylToken } from './hyl.js';
import { OrganizationService } from '../organization/service.js';
import { registerOrganizationAccess } from '../organization/access.js';
export const organizationToken = createServiceToken<OrganizationService>(
  'nocoerp/organization',
);
export default class OrganizationProvider extends ServiceProvider<Application> {
  readonly name = 'nocoerp/organization';
  private release?: () => void;
  override register() {
    this.app.container.singleton(organizationToken, () => {
      const hyl = this.app.container.resolve(hylToken);
      return new OrganizationService(
        hyl.db,
        this.app.container.resolve(authorizationToken),
        hyl.users,
      );
    });
  }
  override async boot() {
    this.release = registerOrganizationAccess(
      this.app.container.resolve(organizationToken),
    );
  }
  override async shutdown() {
    this.release?.();
  }
}
