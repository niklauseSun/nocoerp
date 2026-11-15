import {
  defineAppConfig,
  envString,
  envBoolean,
} from '@nocobase/app-server/config';
export interface WecomConfig {
  enabled: boolean;
  corpId: string;
  agentId: string;
  appSecret: string;
  contactsSecret: string;
  readSecret: string;
  autoSync: boolean;
  notifications: boolean;
}
export default defineAppConfig({
  defaults: {
    enabled: false,
    corpId: '',
    agentId: '',
    appSecret: '',
    contactsSecret: '',
    readSecret: '',
    autoSync: false,
    notifications: false,
  } satisfies WecomConfig,
  env: {
    WECOM_ENABLED: envBoolean('enabled'),
    WECOM_CORP_ID: envString('corpId'),
    WECOM_AGENT_ID: envString('agentId'),
    WECOM_APP_SECRET: envString('appSecret'),
    WECOM_CONTACTS_SECRET: envString('contactsSecret'),
    WECOM_READ_SECRET: envString('readSecret'),
    WECOM_AUTO_SYNC: envBoolean('autoSync'),
    WECOM_NOTIFICATIONS: envBoolean('notifications'),
  },
});
