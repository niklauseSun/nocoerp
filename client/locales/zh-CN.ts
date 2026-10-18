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
  hyl,
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
};

export default zhCN;
