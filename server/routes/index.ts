import procurement from './procurement.js';
import inspections from './inspections.js';
import repairs from './repairs.js';
import energy from './energy.js';
import invoicing from './invoicing.js';
import profitSharing from './profit-sharing.js';
import type { Application } from '@nocobase/app-server/application';
import type { AppRouteContribution } from '@nocobase/app-server/router';

import assetFiles from './asset-files.js';
import assets from './assets.js';
import hyl from './hyl.js';
import leases from './leases.js';
import billing from './billing.js';
import cashier from './cashier.js';
import merchantProfile from './merchant-profile.js';

const routes: readonly AppRouteContribution<Application>[] = [
  ...assetFiles,
  assets,
  ...merchantProfile,
  hyl,
  leases,
  billing,
  cashier,
  profitSharing,
  invoicing,
  energy,
  repairs,
  inspections,
  procurement,
];

export default routes;
