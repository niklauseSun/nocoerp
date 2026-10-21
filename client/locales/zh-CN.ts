import operationLogs from './operation-logs-zh-CN.js';
import operations from './operations-zh-CN.js';
import mobile from './mobile-zh-CN.js';
import organization from './organization-zh-CN.js';
import finance from './finance-zh-CN.js';
import approval from './approval-zh-CN.js';
import messages from './messages-zh-CN.js';
import procurement from './procurement-zh-CN.js';
import inspection from './inspection-zh-CN.js';
import repair from './repair-zh-CN.js';
import energy from './energy-zh-CN.js';
import invoice from './invoice-zh-CN.js';
import split from './split-zh-CN.js';
import cashier from './cashier-zh-CN.js';
import billing from './billing-zh-CN.js';
import lease from './lease-zh-CN.js';
import assets from './assets/zh-CN.js';
import dashboard from './dashboard-zh-CN.js';
import hyl from './hyl/zh-CN.js';
import type { AppResource } from './en-US.js';
import systemZhCN from './system/zh-CN.js';

const zhCN: AppResource = {
  // The template's own copy; see `./en-US.ts`.
  ...systemZhCN,
  navigationGroups: {
    work: '工作入口',
    tenants: '租户经营',
    property: '物业服务',
    finance: '收支财务',
    administration: '系统管理',
  },
  hyl,
  organization,
  mobile,
  operations,
  operationLogs,
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
};

export default zhCN;
