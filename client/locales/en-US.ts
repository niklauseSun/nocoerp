import mobile from './mobile-en-US.js';
import organization from './organization-en-US.js';
import finance from './finance-en-US.js';
import approval from './approval-en-US.js';
import messages from './messages-en-US.js';
import procurement from './procurement-en-US.js';
import inspection from './inspection-en-US.js';
import repair from './repair-en-US.js';
import energy from './energy-en-US.js';
import invoice from './invoice-en-US.js';
import split from './split-en-US.js';
import cashier from './cashier-en-US.js';
import billing from './billing-en-US.js';
import lease from './lease-en-US.js';
import assets from './assets/en-US.js';
import dashboard from './dashboard-en-US.js';
import hyl from './hyl/en-US.js';
import type { LocaleResource } from '@nocobase/i18n';

import systemEnUS from './system/en-US.js';

const enUS = {
  // The template's own copy: the shell, the sign-in pages, shared components and the homepage. Keep it in
  // `./system/` so a template upgrade can replace it without touching the application's copy below.
  ...systemEnUS,
  hyl,
  organization,
  mobile,
  assets,
  dashboard,
  lease,
  billing,
  cashier,
  split,
  invoice,
  energy,
  repair,
  inspection,
  procurement,
  messages,
  approval,
  finance,
  // The application's copy goes here, one group per feature. A shared group such as `navigation` is extended by
  // spreading the system one first, `navigation: { ...systemEnUS.navigation, orders: 'Orders' }`, since a group
  // written here replaces the system group of the same name rather than merging with it.
};

/**
 * The shape every locale of this application follows, derived from the English wording above.
 *
 * Anything a plugin does not translate falls back to this namespace, so a term defined here is reused everywhere
 * without each plugin repeating it.
 */
export type AppResource = LocaleResource<typeof enUS>;

export default enUS;
