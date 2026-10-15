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
};

export default zhCN;
