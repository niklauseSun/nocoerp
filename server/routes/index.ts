import type { Application } from '@nocobase/app-server/application';
import type { AppRouteContribution } from '@nocobase/app-server/router';

import assetFiles from './asset-files.js';
import assets from './assets.js';
import hyl from './hyl.js';
import merchantProfile from './merchant-profile.js';

const routes: readonly AppRouteContribution<Application>[] = [
  ...assetFiles,
  assets,
  ...merchantProfile,
  hyl,
];

export default routes;
