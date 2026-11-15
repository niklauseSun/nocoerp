import {
  defineAppConfig,
  envBoolean,
  envString,
  envInteger,
} from '@nocobase/app-server/config';

export default defineAppConfig({
  defaults: {
    enabled: false,
    appId: '',
    appSecret: '',
    signInPerPeerLimit: 120,
  },
  env: {
    MERCHANT_MINIAPP_SIGN_IN_PER_PEER_LIMIT: envInteger('signInPerPeerLimit'),
    MERCHANT_MINIAPP_ENABLED: envBoolean('enabled'),
    MERCHANT_MINIAPP_APP_ID: envString('appId'),
    MERCHANT_MINIAPP_APP_SECRET: envString('appSecret'),
  },
});
export interface MiniappConfig {
  enabled: boolean;
  appId: string;
  appSecret: string;
  signInPerPeerLimit?: number;
}
