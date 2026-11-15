import type { Application } from '@nocobase/app-server/application';
import {
  createServiceToken,
  ServiceProvider,
} from '@nocobase/service-provider';
import { MerchantMiniapp } from '../merchant-miniapp/service.js';
import { hylToken } from './hyl.js';

export const merchantMiniappToken = createServiceToken<MerchantMiniapp>(
  'nocoerp/merchantMiniapp',
);
export default class MerchantMiniappProvider extends ServiceProvider<Application> {
  readonly name = 'nocoerp/merchantMiniapp';
  override register() {
    this.app.container.singleton(
      merchantMiniappToken,
      () =>
        new MerchantMiniapp(
          this.app.container.resolve(hylToken),
          this.app.config.get('merchantMiniapp')!,
        ),
    );
  }
}
