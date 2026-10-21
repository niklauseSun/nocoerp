// Billing summary children have their own tests; keep dashboard API response fixtures scoped to this view.
vi.mock('../../client/pages/billing/home-cards.js', () => ({
  HomeBillingCards: () => null,
}));
vi.stubGlobal(
  'matchMedia',
  vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
);
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientError } from '@nocobase/app-client';
import {
  TestI18nProvider,
  createTestI18nRuntime,
} from '@nocobase/i18n/testing';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import zh from '../../client/locales/zh-CN.js';
import en from '../../client/locales/en-US.js';
import HomePage from '../../client/pages/home/index.js';
import { dashboardAmount } from '../../client/pages/home/format.js';
const { api, permission, refresh } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  permission: { can: true },
  refresh: vi.fn(),
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useCan: () => permission,
  useAuthorizationRevision: () => 0,
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ refresh }),
}));
const runtimes = {
  zh: await createTestI18nRuntime({
    locale: 'zh-CN',
    application: { namespace: 'nocoerp', resources: zh },
  }),
  en: await createTestI18nRuntime({
    locale: 'en-US',
    application: { namespace: 'nocoerp', resources: en },
  }),
};
const data = {
  month: '2026-10',
  analytics: {
    previousMonth: '2026-09',
    comparison: {
      previousAmount: '8000.00',
      changeAmount: '2000.00',
      changePercent: '25.00',
      previousReportCount: 1,
    },
    daily: [{ date: '2026-10-01', amount: '123.45' }],
    reportCount: 1,
    rankedMerchantCount: 1,
    ranking: [
      {
        merchantId: 'm-1',
        name: '测试商户',
        amount: '123.45',
        reportCount: 1,
        comparison: {
          previousAmount: '246.90',
          changeAmount: '-123.45',
          changePercent: '-50.00',
          previousReportCount: 1,
        },
      },
    ],
  },
  updatedAt: '2026-10-14T08:00:00Z',
  merchants: 12,
  revenue: '10000.00',
  pendingReports: 3,
  unsettled: '2000.00',
  unpaid: '4050.00',
};
function mount(locale: keyof typeof runtimes = 'zh') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter([{ path: '/', element: <HomePage /> }], {
    initialEntries: ['/?month=2026-10'],
  });
  render(
    <TestI18nProvider runtime={runtimes[locale]}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </TestI18nProvider>,
  );
  return router;
}
beforeEach(() => {
  api.request.mockReset();
  permission.can = true;
  refresh.mockReset();
});
afterEach(cleanup);
it('shows five Chinese metrics and correctly scoped processing links', async () => {
  api.request.mockResolvedValue({ data });
  mount();
  expect(await screen.findByText('¥10,000.00')).toBeVisible();
  expect(screen.getByText('¥4,050.00')).toBeVisible();
  for (const [name, href] of [
    ['查看商户档案', '/merchants'],
    ['查看所选月报送', '/revenueReports?view=monthRevenue&month=2026-10'],
    ['处理待审核报送', '/revenueReports?status=pending'],
    ['查看未结算报送', '/revenueReports?view=unsettled'],
    ['处理待返款', '/settlements?view=unpaid'],
  ])
    expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
  expect(screen.getByRole('heading', { name: '经营看板' })).toBeVisible();
});
it('distinguishes zero from unavailable and hides destination links without page access', async () => {
  api.request.mockResolvedValue({
    data: { ...data, revenue: '0.00', unsettled: null, unpaid: null },
  });
  permission.can = false;
  mount();
  expect(await screen.findByText('¥0.00')).toBeVisible();
  expect(screen.getAllByText('无查看权限，请联系管理员。')).toHaveLength(2);
  expect(screen.queryByText('无符合条件的记录')).not.toBeInTheDocument();
  expect(screen.queryAllByRole('link')).toHaveLength(0);
});
it('retains values during refresh, then removes cached financial data on forbidden', async () => {
  api.request.mockResolvedValueOnce({ data });
  mount();
  await screen.findByText('¥10,000.00');
  let reject!: (error: unknown) => void;
  api.request.mockImplementationOnce(
    () =>
      new Promise((_resolve, r) => {
        reject = r;
      }),
  );
  await userEvent.click(screen.getByRole('button', { name: '刷新' }));
  expect(screen.getByText('¥10,000.00')).toBeVisible();
  reject(
    new ApiClientError('Forbidden', {
      status: 403,
      method: 'GET',
      url: '/hylDashboard',
    }),
  );
  await waitFor(() =>
    expect(screen.queryByText('¥10,000.00')).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByRole('button', { name: '重试' }),
  ).not.toBeInTheDocument();
});
it('offers user-triggered session refresh after 401', async () => {
  api.request.mockRejectedValue(
    new ApiClientError('Expired', {
      status: 401,
      method: 'GET',
      url: '/hylDashboard',
    }),
  );
  mount();
  await userEvent.click(
    await screen.findByRole('button', { name: '重新登录' }),
  );
  expect(refresh).toHaveBeenCalledOnce();
});
it('renders English and preserves cents above Number safe range', async () => {
  api.request.mockResolvedValue({ data });
  mount('en');
  expect(await screen.findByText('Selected month revenue')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Process refunds' })).toHaveAttribute(
    'href',
    '/settlements?view=unpaid',
  );
  expect(dashboardAmount('-0.50', 'en-US')).toContain('-CN¥0.50');
  expect(dashboardAmount('9007199254740993.27', 'en-US')).toContain(
    '9,007,199,254,740,993.27',
  );
});
it('shows loading then a retry for temporary failures', async () => {
  let reject!: (error: unknown) => void;
  api.request.mockImplementationOnce(
    () =>
      new Promise((_resolve, r) => {
        reject = r;
      }),
  );
  mount();
  expect(screen.getByLabelText('加载中')).toBeInTheDocument();
  reject(new Error('network'));
  expect(await screen.findByRole('button', { name: '重试' })).toBeVisible();
  api.request.mockResolvedValue({ data });
  await userEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByText('¥10,000.00')).toBeVisible();
});

it('filters by URL month and links ranking to merchant reports, hiding previous month during a switch', async () => {
  api.request.mockResolvedValueOnce({ data });
  const router = mount();
  const merchant = await screen.findByRole('link', { name: '测试商户' });
  expect(merchant).toHaveAttribute(
    'href',
    '/revenueReports?view=monthRevenue&month=2026-10&merchantId=m-1',
  );
  expect(api.request).toHaveBeenCalledWith({
    path: 'hylDashboard',
    query: { month: '2026-10' },
  });
  let resolve!: (value: unknown) => void;
  api.request.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await act(async () => {
    await router.navigate('/?month=2026-09');
  });
  expect(screen.queryByText('¥10,000.00')).not.toBeInTheDocument();
  expect(screen.queryByText('环比 +25.00%')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('link', { name: '测试商户' }),
  ).not.toBeInTheDocument();
  await act(async () =>
    resolve({
      data: {
        ...data,
        month: '2026-09',
        revenue: '0.00',
        analytics: {
          previousMonth: '2026-08',
          comparison: {
            previousAmount: '100.00',
            changeAmount: '-100.00',
            changePercent: '-100.00',
            previousReportCount: 1,
          },
          daily: [],
          reportCount: 0,
          rankedMerchantCount: 0,
          ranking: [],
        },
      },
    }),
  );
  expect(await screen.findAllByText('所选月份暂无已审核报送')).toHaveLength(2);
  expect(screen.getByText('环比 -100.00%')).toBeVisible();
  expect(screen.getByText('上月（2026-08）：¥100.00')).toBeVisible();
  expect(screen.getByRole('link', { name: '查看全部月报送' })).toHaveAttribute(
    'href',
    '/revenueReports?view=monthRevenue&month=2026-09',
  );
});
it('exposes exact daily amounts and distinguishes zero reports from zero revenue', async () => {
  api.request.mockResolvedValue({
    data: {
      ...data,
      analytics: {
        ...data.analytics,
        daily: [{ date: '2026-10-01', amount: '0.00' }],
      },
    },
  });
  mount();
  await screen.findByText('营业收入趋势');
  await userEvent.click(screen.getByText('查看每日金额'));
  expect(screen.getByRole('cell', { name: '¥0.00' })).toBeVisible();
  expect(screen.queryByText('所选月份暂无已审核报送')).not.toBeInTheDocument();
});

it('returns focus to month selection after resetting and hides denied analytics', async () => {
  api.request.mockResolvedValue({
    data: { ...data, revenue: null, analytics: null },
  });
  mount();
  await screen.findByText('营业收入趋势');
  expect(screen.getAllByText('无查看权限，请联系管理员。')).toHaveLength(3);
  expect(
    screen.queryByRole('link', { name: '测试商户' }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '恢复本月' }));
  expect(screen.getByRole('button', { name: '统计月份' })).toHaveFocus();
});

it('shows aggregate and merchant changes with exact signed percentages', async () => {
  api.request.mockResolvedValue({ data });
  mount();
  expect(await screen.findByText('环比 +25.00%')).toBeVisible();
  expect(screen.getByText('环比 -50.00%')).toBeVisible();
  expect(screen.getByText('增加 ¥2,000.00')).toBeVisible();
  expect(screen.getByText('减少 ¥123.45')).toBeVisible();
  expect(screen.getByText('上月（2026-09）：¥8,000.00')).toBeVisible();
});
it('explains missing and zero baselines instead of infinite percentages', async () => {
  api.request.mockResolvedValue({
    data: {
      ...data,
      analytics: {
        ...data.analytics,
        comparison: {
          previousAmount: '0.00',
          changeAmount: '10000.00',
          changePercent: null,
          previousReportCount: 0,
        },
        ranking: [
          {
            ...data.analytics.ranking[0],
            comparison: {
              previousAmount: '0.00',
              changeAmount: '123.45',
              changePercent: null,
              previousReportCount: 1,
            },
          },
        ],
      },
    },
  });
  mount();
  expect(
    await screen.findByText('上月无已审核报送 · 环比不可计算'),
  ).toBeVisible();
  expect(screen.getByText('上月营业净额为零 · 环比不可计算')).toBeVisible();
  expect(screen.queryByText(/Infinity|NaN/)).not.toBeInTheDocument();
});
