import {
  resolveAppClientContributions,
  type AppClientRegisteredRoute,
  type AppClientRouteComponentLoader,
} from '@nocobase/app-client/plugins';
import { describe, expect, it } from 'vitest';

import applicationRoutes from '../../client/routes.ts';

describe('app client routes', () => {
  it('keeps the landing page and the authentication pages', () => {
    // The authentication plugin and this application have to agree on these paths: it sends an unknown visitor to
    // /login, sends a signed-in user who opens a guest page back to /, and mails a reset link to /reset-password,
    // while the sign-in form links to /register and /forgot-password. Only their presence is asserted, so a page the
    // application adds is not a defect. Whether these four are guest pages is not checked here either: app-client
    // refuses any route that claims one of those paths without `auth: 'guest'`.
    expect(pagePaths(resolveRoutes().routes)).toEqual(
      expect.arrayContaining([
        '/',
        '/login',
        '/register',
        '/forgot-password',
        '/reset-password',
        // The page `deviceAuthorization()`'s verificationUri names, where a CLI's sign-in is approved.
        '/device',
      ]),
    );
  });

  it('loads every page component', async () => {
    const resolved = resolveRoutes();
    const loaders = componentLoadersIn(resolved.routes);
    // The tree above is filtered by loader, so an empty list would make the loop below pass without loading
    // anything at all.
    expect(loaders).not.toHaveLength(0);

    for (const componentLoader of loaders) {
      // The registered loader is already the wrapped one, so awaiting it holds every page to the contract that its
      // module default-exports a component. A page that moved or lost its default export fails here.
      await expect(componentLoader()).resolves.toMatchObject({
        default: expect.any(Function),
      });
    }
  });

  it('pins the page authorization of every signed-in page', () => {
    // A stored page grant records the page's `authz` resource id (`authorizedAs`), not its route `name`: changing an
    // id is a data change that has to migrate the grants that reference it, not a refactor — so changing this list
    // deliberately is the point. A new page that requires sign-in adds an entry here, because a page that checks
    // access is a new grant somebody has to be given.
    const resolved = resolveRoutes();

    // The landing page and the inbox opted out of page authorization, so they are reachable by every signed-in user.
    const authorizations = pageAuthorizations(resolved.routes);
    for (const kind of [
      'merchants',
      'contracts',
      'revenueReports',
      'expenses',
      'settlements',
      'billing',
      'cashier',
      'energy',
      'repairs',
      'inspections',
    ]) {
      const own = authorizations.filter((r) =>
        r.name.startsWith(`hyl-${kind}`),
      );
      expect(own.length).toBeGreaterThan(1);
      expect(own.every((r) => r.authorizedAs === `hyl-${kind}`)).toBe(true);
    }
    expect(authorizations.filter((r) => !r.name.startsWith('hyl-'))).toEqual([
      { name: 'home', authorizedAs: null },
      { name: 'inbox', authorizedAs: null },
      { name: 'financial-reports', authorizedAs: 'hyl-financial-reports' },
      {
        name: 'financial-report-source',
        authorizedAs: 'hyl-financial-reports',
      },
      ...[
        'approvals',
        'approval-detail',
        'approval-configs',
        'approval-config-new',
        'approval-config-detail',
      ].map((name) => ({ name, authorizedAs: 'hyl-approvals' })),
      { name: 'message-todos', authorizedAs: null },
      { name: 'message-todo', authorizedAs: null },
      { name: 'message-preferences', authorizedAs: null },
    ]);
  });

  it('registers the personal message center navigation', () => {
    expect(
      applicationRoutes[0].routes.find((route) => route.name === 'inbox')
        ?.navigation,
    ).toMatchObject({ title: 'messages.title' });
  });
});

/** This application's own contribution, registered the way the client runtime registers it. */
function resolveRoutes() {
  return resolveAppClientContributions([
    {
      packageName: '@nocobase/app-template-default',
      routes: applicationRoutes,
      source: 'application',
    },
  ]);
}

/**
 * The paths of the pages a route tree registers. A menu group names no component, so it carries no path of its own
 * and inherits its parent's — filtering on `componentLoader` is what keeps that inherited path out of the list.
 */
function pagePaths(routes: readonly AppClientRegisteredRoute[]): string[] {
  return routes.flatMap((route) => [
    ...(route.componentLoader ? [route.path] : []),
    ...pagePaths(route.children ?? []),
  ]);
}

/** Every page loader in a tree, at any depth. */
function componentLoadersIn(
  routes: readonly AppClientRegisteredRoute[],
): AppClientRouteComponentLoader[] {
  return routes.flatMap((route) => [
    ...(route.componentLoader ? [route.componentLoader] : []),
    ...componentLoadersIn(route.children ?? []),
  ]);
}

/** Page authorization comes directly from the registered tree. */
function pageAuthorizations(
  routes: readonly AppClientRegisteredRoute[],
): { name: string; authorizedAs: string | null }[] {
  return routes.flatMap((route) => [
    ...(route.componentLoader && route.auth === 'required'
      ? [
          {
            name: route.name,
            authorizedAs:
              route.authz === 'skip'
                ? null
                : route.authz === 'unrestricted'
                  ? 'unrestricted'
                  : route.authz.resource.type === 'page'
                    ? route.authz.resource.id
                    : `${route.authz.resource.type}:${route.authz.resource.id}`,
          },
        ]
      : []),
    ...pageAuthorizations(route.children ?? []),
  ]);
}

it('registers invoice navigation, local source and correction routes', () => {
  const text = JSON.stringify(resolveRoutes().routes);
  for (const name of [
    'hyl-invoicing',
    'hyl-invoice-sources',
    'hyl-invoice-ledger',
    'hyl-invoice-configs',
    'hyl-contracts-invoice-config',
  ])
    expect(text).toContain(name);
});

it('organization settings and all child sections require organization read', () => {
  const rows = pageAuthorizations(resolveRoutes().routes).filter((r) =>
    r.name.startsWith('hyl-organization'),
  );
  expect(rows.length).toBe(7);
  expect(
    rows.every((r) => r.authorizedAs === 'settings:hyl.organization'),
  ).toBe(true);
});
