import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientError } from '@nocobase/app-client';
import {
  TestI18nProvider,
  createTestI18nRuntime,
} from '@nocobase/i18n/testing';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import zh from '../../client/locales/zh-CN.js';
import { BusinessList } from '../../client/pages/hyl/list.js';
import { DatePicker } from '../../client/components/date-picker.js';
const { api, permission } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  permission: { can: true },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationRevision: () => 0,
  useCan: () => permission,
}));
const runtime = await createTestI18nRuntime({
  locale: 'zh-CN',
  application: { namespace: 'nocoerp', resources: zh },
});
function mount(
  path = '/merchants',
  kind: 'merchants' | 'settlements' | 'revenueReports' = 'merchants',
) {
  const router = createMemoryRouter(
    [{ path: `/${kind}`, element: <BusinessList kind={kind} /> }],
    { initialEntries: [path] },
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <TestI18nProvider runtime={runtime}>
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
});
afterEach(cleanup);
it('shows one create action in the empty Chinese list and retains it for filtered zero results', async () => {
  api.request.mockResolvedValue({ data: [], meta: { total: 0 } });
  mount('/merchants?q=missing');
  expect(await screen.findByText('没有符合条件的记录')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: '新建商户档案' })).toHaveLength(
    1,
  );
});
it('hides create without permission and does not retry forbidden responses', async () => {
  permission.can = false;
  api.request.mockRejectedValue(
    new ApiClientError('Forbidden', {
      status: 403,
      method: 'GET',
      url: '/merchants',
    }),
  );
  mount();
  expect(
    await screen.findByText('无权执行此操作，请联系管理员。'),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: '重试' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: '新建商户档案' }),
  ).not.toBeInTheDocument();
});
it('keeps search typing and URL state in sync after debouncing', async () => {
  api.request.mockResolvedValue({ data: [], meta: { total: 0 } });
  const router = mount();
  const input = screen.getByPlaceholderText('搜索名称、编号或参考号');
  await userEvent.type(input, 'abc');
  await waitFor(() => expect(router.state.location.search).toBe('?q=abc'));
  expect(input).toHaveValue('abc');
});

it('shares a Chinese calendar while preserving date-only and month-only values', async () => {
  const onChange = vi.fn();
  const view = render(
    <TestI18nProvider runtime={runtime}>
      <DatePicker
        id='test-date'
        value='2026-10-01'
        onChange={onChange}
        placeholder='请选择'
      />
    </TestI18nProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: '2026年10月1日' }));
  await userEvent.click(
    screen.getByRole('button', { name: /2026年10月15日 星期四$/ }),
  );
  expect(onChange).toHaveBeenLastCalledWith('2026-10-15');
  view.unmount();
  render(
    <TestI18nProvider runtime={runtime}>
      <DatePicker
        id='test-month'
        value='2026-10'
        month
        onChange={onChange}
        placeholder='请选择'
      />
    </TestI18nProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: '2026年10月' }));
  await userEvent.click(
    screen.getByRole('button', { name: /2026年10月15日 星期四$/ }),
  );
  expect(onChange).toHaveBeenLastCalledWith('2026-10');
});

it('carries dashboard filters to the API and clears them explicitly', async () => {
  api.request.mockResolvedValue({ data: [], meta: { total: 0 } });
  const router = mount('/settlements?view=unpaid', 'settlements');
  expect(
    await screen.findByText('看板筛选：已确认、尚未付清的结算单（全部月份）'),
  ).toBeVisible();
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      query: expect.objectContaining({ view: 'unpaid' }),
    }),
  );
  await userEvent.click(screen.getAllByRole('button', { name: '清除筛选' })[0]);
  await waitFor(() => expect(router.state.location.search).toBe(''));
});

it('preserves merchant and month drilldown filters in API requests and clears them together', async () => {
  api.request.mockResolvedValue({ data: [], meta: { total: 0 } });
  const router = mount(
    '/revenueReports?view=monthRevenue&month=2026-09&merchantId=m-1',
    'revenueReports',
  );
  await screen.findByText('没有符合条件的记录');
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'revenueReports',
      query: expect.objectContaining({
        view: 'monthRevenue',
        month: '2026-09',
        merchantId: 'm-1',
      }),
    }),
  );
  expect(screen.getByRole('status')).toHaveTextContent('仅显示所选商户');
  await userEvent.click(screen.getAllByRole('button', { name: '清除筛选' })[0]);
  expect(router.state.location.search).toBe('');
});

vi.mock('@nocobase/app-plugin-authentication/client', async (original) => ({
  ...(await original<
    typeof import('@nocobase/app-plugin-authentication/client')
  >()),
  useAuthentication: () => ({ session: { user: { id: 'business-test' } } }),
}));
