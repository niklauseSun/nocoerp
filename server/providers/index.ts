import type { ApplicationServiceProviderConstructor } from '@nocobase/app-server/application';

import HylProvider from './hyl.js';

const serviceProviders: readonly ApplicationServiceProviderConstructor[] = [
  HylProvider,
];

export default serviceProviders;
