import type { Application } from '@nocobase/app-server/application';
import type { AppRouteContribution } from '@nocobase/app-server/router';

import hyl from './hyl.js';

const routes: readonly AppRouteContribution<Application>[] = [hyl];

export default routes;
