import type { Application } from '@nocobase/app-server/application';
import type { AppRouteContribution } from '@nocobase/app-server/router';

import hyl from './hyl.js';
import merchantProfile from './merchant-profile.js';

const routes: readonly AppRouteContribution<Application>[] = [
  ...merchantProfile,
  hyl,
];

export default routes;
