import { Home, Store, FileText, Receipt, Wallet, Landmark } from 'lucide-react';
import {
  defineAppRoutes,
  type AppClientRouteContribution,
} from '@nocobase/app-client/plugins';

const appRoutes: AppClientRouteContribution = defineAppRoutes([
  {
    name: 'hyl-merchants',
    path: '/merchants',
    auth: 'required',
    authz: {
      resource: { type: 'page', id: 'hyl-merchants' },
      action: 'access',
    },
    navigation: { title: 'hyl.nav.merchants', icon: Store },
    componentLoader: () => import('./pages/hyl/merchants.js'),
    children: [
      {
        name: 'hyl-merchants-new',
        path: 'new',
        componentLoader: () => import('./pages/hyl/form.js'),
      },
      {
        name: 'hyl-merchants-edit',
        path: 'edit/:id',
        componentLoader: () => import('./pages/hyl/form.js'),
      },
      {
        name: 'hyl-merchants-detail',
        path: ':id',
        componentLoader: () => import('./pages/hyl/detail.js'),
        children: [
          {
            name: 'hyl-merchants-detail-edit',
            path: 'edit',
            componentLoader: () => import('./pages/hyl/form.js'),
          },
        ],
      },
    ],
  },
  {
    name: 'hyl-contracts',
    path: '/contracts',
    auth: 'required',
    authz: {
      resource: { type: 'page', id: 'hyl-contracts' },
      action: 'access',
    },
    navigation: { title: 'hyl.nav.contracts', icon: FileText },
    componentLoader: () => import('./pages/hyl/contracts.js'),
    children: [
      {
        name: 'hyl-contracts-new',
        path: 'new',
        componentLoader: () => import('./pages/hyl/form.js'),
      },
      {
        name: 'hyl-contracts-edit',
        path: 'edit/:id',
        componentLoader: () => import('./pages/hyl/form.js'),
      },
      {
        name: 'hyl-contracts-detail',
        path: ':id',
        componentLoader: () => import('./pages/hyl/detail.js'),
        children: [
          {
            name: 'hyl-contracts-detail-edit',
            path: 'edit',
            componentLoader: () => import('./pages/hyl/form.js'),
          },
        ],
      },
    ],
  },
  {
    name: 'hyl-revenueReports',
    path: '/revenueReports',
    auth: 'required',
    authz: {
      resource: { type: 'page', id: 'hyl-revenueReports' },
      action: 'access',
    },
    navigation: { title: 'hyl.nav.revenueReports', icon: Receipt },
    componentLoader: () => import('./pages/hyl/revenueReports.js'),
    children: [
      {
        name: 'hyl-revenueReports-new',
        path: 'new',
        componentLoader: () => import('./pages/hyl/form.js'),
      },
      {
        name: 'hyl-revenueReports-edit',
        path: 'edit/:id',
        componentLoader: () => import('./pages/hyl/form.js'),
      },
      {
        name: 'hyl-revenueReports-detail',
        path: ':id',
        componentLoader: () => import('./pages/hyl/detail.js'),
        children: [
          {
            name: 'hyl-revenueReports-detail-edit',
            path: 'edit',
            componentLoader: () => import('./pages/hyl/form.js'),
          },
          {
            name: 'hyl-revenueReports-submit',
            path: 'submit',
            componentLoader: () => import('./pages/hyl/action.js'),
          },
          {
            name: 'hyl-revenueReports-approve',
            path: 'approve',
            componentLoader: () => import('./pages/hyl/action.js'),
          },
          {
            name: 'hyl-revenueReports-return',
            path: 'return',
            componentLoader: () => import('./pages/hyl/action.js'),
          },
        ],
      },
    ],
  },
  {
    name: 'hyl-expenses',
    path: '/expenses',
    auth: 'required',
    authz: { resource: { type: 'page', id: 'hyl-expenses' }, action: 'access' },
    navigation: { title: 'hyl.nav.expenses', icon: Wallet },
    componentLoader: () => import('./pages/hyl/expenses.js'),
    children: [
      {
        name: 'hyl-expenses-new',
        path: 'new',
        componentLoader: () => import('./pages/hyl/form.js'),
      },
      {
        name: 'hyl-expenses-edit',
        path: 'edit/:id',
        componentLoader: () => import('./pages/hyl/form.js'),
      },
      {
        name: 'hyl-expenses-detail',
        path: ':id',
        componentLoader: () => import('./pages/hyl/detail.js'),
        children: [
          {
            name: 'hyl-expenses-detail-edit',
            path: 'edit',
            componentLoader: () => import('./pages/hyl/form.js'),
          },
          {
            name: 'hyl-expenses-submit',
            path: 'submit',
            componentLoader: () => import('./pages/hyl/action.js'),
          },
          {
            name: 'hyl-expenses-approve',
            path: 'approve',
            componentLoader: () => import('./pages/hyl/action.js'),
          },
          {
            name: 'hyl-expenses-return',
            path: 'return',
            componentLoader: () => import('./pages/hyl/action.js'),
          },
        ],
      },
    ],
  },
  {
    name: 'hyl-settlements',
    path: '/settlements',
    auth: 'required',
    authz: {
      resource: { type: 'page', id: 'hyl-settlements' },
      action: 'access',
    },
    navigation: { title: 'hyl.nav.settlements', icon: Landmark },
    componentLoader: () => import('./pages/hyl/settlements.js'),
    children: [
      {
        name: 'hyl-settlements-new',
        path: 'new',
        componentLoader: () => import('./pages/hyl/form.js'),
      },
      {
        name: 'hyl-settlements-detail',
        path: ':id',
        componentLoader: () => import('./pages/hyl/detail.js'),
        children: [
          {
            name: 'hyl-settlements-review',
            path: 'review',
            componentLoader: () => import('./pages/hyl/action.js'),
          },
          {
            name: 'hyl-settlements-confirm',
            path: 'confirm',
            componentLoader: () => import('./pages/hyl/action.js'),
          },
          {
            name: 'hyl-settlements-dispute',
            path: 'dispute',
            componentLoader: () => import('./pages/hyl/action.js'),
          },
          {
            name: 'hyl-settlements-cancel',
            path: 'cancel',
            componentLoader: () => import('./pages/hyl/action.js'),
          },
          {
            name: 'hyl-settlements-pay',
            path: 'pay',
            componentLoader: () => import('./pages/hyl/action.js'),
          },
        ],
      },
    ],
  },
  {
    // Every signed-in user reaches the landing page. `authz: 'skip'` takes it out of page authorization entirely, so
    // no permission change can leave a user signed in with nowhere to land.
    authz: 'skip',
    auth: 'required',
    componentLoader: () => import('./pages/home/index.js'),
    name: 'home',
    navigation: { title: 'dashboard.title', icon: Home },
    path: '/',
  },
  {
    // Declares no navigation, so the application decides where its entry goes (for example a sidebar item with an
    // unread badge). The plugin's API answers each person's own messages only, so the page needs no authorization of
    // its own.
    authz: 'skip',
    auth: 'required',
    componentLoader: () => import('./pages/inbox.js'),
    name: 'inbox',
    path: '/inbox',
  },
  {
    auth: 'guest',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/login.js'),
    name: 'login',
    path: '/login',
  },
  {
    auth: 'guest',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/register.js'),
    name: 'register',
    path: '/register',
  },
  {
    auth: 'guest',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/forgot-password.js'),
    name: 'forgot-password',
    path: '/forgot-password',
  },
  {
    auth: 'guest',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/reset-password.js'),
    name: 'reset-password',
    path: '/reset-password',
  },
  {
    // Where a command line's sign-in sends the person to approve it (`pages/auth/device.tsx`). Optional rather than
    // required so it renders outside the shell, like the sign-in pages; the page sends a guest to sign in and back.
    auth: 'optional',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/device.js'),
    name: 'device',
    path: '/device',
  },
]);

const routes: readonly AppClientRouteContribution[] = [appRoutes];

export default routes;
