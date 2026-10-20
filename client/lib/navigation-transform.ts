import {
  BriefcaseBusiness,
  Coins,
  HardHat,
  LayoutGrid,
  Settings2,
} from 'lucide-react';
import type { RouteNavigationItem } from '../routing/route-navigation.js';

const groups = [
  {
    key: 'work',
    icon: LayoutGrid,
    names: ['mobile-workbench', 'home', 'inbox', 'approvals'],
  },
  {
    key: 'tenants',
    icon: BriefcaseBusiness,
    names: [
      'hyl-assets',
      'hyl-merchants',
      'hyl-contracts',
      'hyl-revenueReports',
      'hyl-expenses',
      'hyl-settlements',
      'hyl-tenant-operations',
    ],
  },
  {
    key: 'property',
    icon: HardHat,
    names: ['hyl-inspections', 'hyl-repairs', 'hyl-energy'],
  },
  {
    key: 'finance',
    icon: Coins,
    names: [
      'hyl-billing',
      'hyl-cashier',
      'financial-reports',
      'hyl-procurement',
      'hyl-invoicing',
      'hyl-profit-sharing',
    ],
  },
  { key: 'administration', icon: Settings2, names: ['hyl-organization'] },
] as const;

/** Navigation-only groups run AFTER authorization filtering. Never move routes or
 * change page identities to organize menus: existing URLs/grants remain intact.
 * Unknown/plugin entries retain their order and are never discarded. */
export function transformNavigation(
  items: RouteNavigationItem[],
): RouteNavigationItem[] {
  const used = new Set<RouteNavigationItem>();
  const grouped = groups.flatMap((group) => {
    const children = group.names.flatMap((name) =>
      items.filter(
        (item) =>
          item.route.source === 'application' && item.route.name === name,
      ),
    );
    if (!children.length) return [];
    children.forEach((item) => used.add(item));
    return [
      {
        route: {
          ...children[0].route,
          id: 'navigation-group-' + group.key,
          name: 'navigation-group-' + group.key,
          path: '/__navigation/' + group.key,
          componentLoader: undefined,
          authz: 'skip' as const,
          navigation: {
            title: 'navigationGroups.' + group.key,
            icon: group.icon,
          },
          children: undefined,
        },
        children,
      },
    ];
  });
  return [...grouped, ...items.filter((item) => !used.has(item))];
}
