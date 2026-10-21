import type { AppClientRegisteredRoute } from '@nocobase/app-client/plugins';
import { expect, it } from 'vitest';
import { transformNavigation } from '../../client/lib/navigation-transform.js';
import {
  buildRouteNavigation,
  selectedNavigationId,
  routeKey,
  type RouteNavigationItem,
} from '../../client/routing/route-navigation.js';
const page = (name: string, path = '/' + name): AppClientRegisteredRoute => ({
  name,
  id: name,
  path,
  auth: 'required',
  authz: 'skip',
  packageName: 'nocoerp',
  source: 'application',
  navigation: { title: name },
  componentLoader: async () => ({ default: () => null }),
});
const node = (name: string): RouteNavigationItem => ({
  route: page(name),
  children: [],
});
it('groups business neighbors in a stable order while retaining original route identities and unknown items', () => {
  const items = [
    'hyl-energy',
    'hyl-contracts',
    'mobile-workbench',
    'hyl-cashier',
    'home',
    'hyl-organization',
    'hyl-revenueReports',
    'plugin-extra',
  ].map(node);
  const output = transformNavigation(items);
  expect(output.slice(0, -1).map((i) => i.route.navigation?.title)).toEqual([
    'navigationGroups.work',
    'navigationGroups.tenants',
    'navigationGroups.property',
    'navigationGroups.finance',
    'navigationGroups.administration',
  ]);
  expect(output[0].children.map((i) => i.route.name)).toEqual([
    'mobile-workbench',
    'home',
  ]);
  expect(output[1].children.map((i) => i.route.name)).toEqual([
    'hyl-contracts',
    'hyl-revenueReports',
  ]);
  const leaves = output.flatMap((i) => (i.children.length ? i.children : [i]));
  expect(leaves).toHaveLength(items.length);
  expect(new Set(leaves)).toEqual(new Set(items));
  expect(output.at(-1)).toBe(items.at(-1));
  expect(output[0].route.componentLoader).toBeUndefined();
});
it('omits denied pages and their now-empty groups, retaining selected nested business routes', () => {
  const hidden = page('hyl-assets', '/assets'),
    visible = {
      ...page('hyl-revenueReports', '/revenueReports'),
      children: [
        { ...page('detail', '/revenueReports/:id'), navigation: undefined },
      ],
    };
  const denied = new Set([routeKey(hidden)]);
  const output = buildRouteNavigation([hidden, visible], denied);
  expect(output).toHaveLength(1);
  expect(output[0].children.map((i) => i.route.id)).toEqual([
    'hyl-revenueReports',
  ]);
  expect(
    selectedNavigationId([hidden, visible], '/revenueReports/TEST', denied),
  ).toBe(routeKey(visible));
  expect(buildRouteNavigation([hidden], denied)).toEqual([]);
});
it('preserves an existing business submenu and keeps repeated transforms stable', () => {
  const item = {
    route: page('hyl-cashier'),
    children: [node('orders'), node('refunds')],
  };
  const output = transformNavigation([item]);
  expect(output[0].children[0]).toBe(item);
  expect(output[0].children[0].children).toBe(item.children);
  expect(transformNavigation(output)).toEqual(output);
});
