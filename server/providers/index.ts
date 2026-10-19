import OrganizationProvider from './organization.js';
import ApprovalsProvider from './approvals.js';
import MessagesProvider from './messages.js';
import InspectionSchedules from './inspections.js';
import type { ApplicationServiceProviderConstructor } from '@nocobase/app-server/application';

import HylProvider from './hyl.js';

const serviceProviders: readonly ApplicationServiceProviderConstructor[] = [
  HylProvider,
  OrganizationProvider,
  ApprovalsProvider,
  InspectionSchedules,
  MessagesProvider,
];

export default serviceProviders;
