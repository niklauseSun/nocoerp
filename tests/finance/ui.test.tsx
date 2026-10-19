import { ApiClientError } from '@nocobase/app-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  TestI18nProvider,
  createTestI18nRuntime,
} from '@nocobase/i18n/testing';
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation, Link } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import zh from '../../client/locales/zh-CN.js';
import en from '../../client/locales/en-US.js';
import Reports from '../../client/pages/financial-reports/index.js';
import Detail from '../../client/pages/financial-reports/detail.js';
vi.stubGlobal(
  'matchMedia',
  vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
);
const { api } = vi.hoisted(() => ({ api: { request: vi.fn() } }));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useNavigationGuard: vi.fn(),
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ session: { user: { id: 'finance-test' } } }),
}));
const runtime = await createTestI18nRuntime({
  locale: 'zh-CN',
  application: { namespace: 'nocoerp', resources: zh },
});
const english = await createTestI18nRuntime({
  locale: 'en-US',
  application: { namespace: 'nocoerp', resources: en },
});
const row = {
  id: 'receipt:one',
  kind: 'event',
  type: 'bill',
  number: 'SK-TEST',
  title: 'receive',
  contractId: 'c',
  projectId: 'p',
  at: '2026-10-20T01:00:00Z',
  date: '2026-10-20',
  reference: 'DEMO-VOUCHER',
  amountCents: '100000',
  appliedCents: '0',
  remainingCents: '0',
  openingCents: '0',
  movementCents: '0',
  closingCents: '0',
};
const result = {
  data: {
    generatedAt: '2026-10-20T01:00:00Z',
    from: '2026-10-01',
    to: '2026-10-20',
    currency: 'CNY',
    projects: [
      { id: 'p', name: '项目一' },
      { id: 'other', name: '项目二' },
    ],
    summary: {
      receivedCents: '100000',
      paidCents: '0',
      netCents: '100000',
      depositCents: '50000',
      receivableCents: '20000',
      merchantPayableCents: '0',
      supplierPayableCents: '0',
      advanceCents: '0',
      openingCashCents: '0',
      closingCashCents: '100000',
    },
    categories: [],
    checks: [],
    items: [row],
  },
  meta: { page: 1, pageSize: 20, total: 1 },
};
function Probe() {
  const l = useLocation();
  return (
    <>
      <output data-testid='url'>{l.pathname + l.search}</output>
      <Link to='/financialReports?projectId=other'>Other project</Link>
    </>
  );
}
function mount(path = '/financialReports', lang = runtime) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <TestI18nProvider runtime={lang}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Probe />
          <Routes>
            <Route path='/financialReports' element={<Reports />}>
              <Route path=':kind/:sourceId' element={<Detail />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </TestI18nProvider>,
  );
}
beforeEach(() => {
  api.request.mockReset();
  api.request.mockImplementation(async (v) =>
    v.path === 'financialReports'
      ? structuredClone(result)
      : { data: { ...row, generatedAt: result.data.generatedAt } },
  );
});
afterEach(cleanup);
it('renders Chinese current balances separately from registration-range cash, sort and drawer preserve query', async () => {
  const user = userEvent.setup();
  mount(
    '/financialReports?view=cash&projectId=p&from=2026-10-01&to=2026-10-20',
  );
  await screen.findByText('SK-TEST');
  expect(screen.getByText(/当前余额快照时间/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: '金额／原额' }));
  expect(screen.getByTestId('url').textContent).toContain('order=amountCents');
  await screen.findByRole('link', { name: 'SK-TEST' });
  await user.click(screen.getByRole('link', { name: 'SK-TEST' }));
  const dialog = await screen.findByRole('dialog');
  expect(await within(dialog).findByText('DEMO-VOUCHER')).toBeVisible();
  expect(screen.getByTestId('url').textContent).toContain(
    '/event/receipt%3Aone',
  );
  await user.click(
    within(dialog).getAllByRole('button', { name: '关闭', exact: true })[0],
  );
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(screen.getByTestId('url').textContent).toContain('view=cash');
  expect(screen.getByTestId('url').textContent).toContain('order=amountCents');
});
it('supports English copy and valid zero figures without placeholder translation keys', async () => {
  mount('/financialReports', english);
  await screen.findByText('SK-TEST');
  expect(
    screen.getByRole('heading', { name: 'Financial reports' }),
  ).toBeVisible();
  expect(screen.getByText('Current customer advances')).toBeVisible();
  expect(
    screen.getByText(/Cash uses Shanghai registration dates/),
  ).toBeVisible();
});
it('distinguishes no results, preserves summary cards and clears filters', async () => {
  api.request.mockResolvedValue({
    ...result,
    data: { ...result.data, items: [] },
    meta: { page: 1, pageSize: 20, total: 0 },
  });
  mount('/financialReports?q=missing');
  await screen.findByText('没有符合条件的明细');
  expect(screen.getByText('当前应收余额')).toBeVisible();
  expect(screen.getAllByRole('button', { name: '清除筛选' })).toHaveLength(2);
});
it('hides prior totals when a different project request has not returned', async () => {
  const user = userEvent.setup();
  api.request.mockImplementation((v) =>
    v.query.projectId === 'other'
      ? new Promise(() => {})
      : Promise.resolve(result),
  );
  mount('/financialReports?projectId=p');
  await screen.findByText('SK-TEST');
  await user.click(screen.getByRole('link', { name: 'Other project' }));
  await waitFor(() =>
    expect(screen.queryByText('SK-TEST')).not.toBeInTheDocument(),
  );
  expect(screen.queryByText('当前应收余额')).not.toBeInTheDocument();
});
it('403 has no Retry, network failure offers Retry, and 400 provides filter correction', async () => {
  const err = (status: number) =>
    new ApiClientError('sensitive raw error', { status, reason: 'DENIED' });
  api.request.mockRejectedValue(err(403));
  const v = mount();
  await screen.findByRole('alert');
  expect(
    screen.queryByRole('button', { name: '重试' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText('sensitive raw error')).not.toBeInTheDocument();
  v.unmount();
  api.request.mockRejectedValue(new Error('offline'));
  mount();
  await screen.findByRole('button', { name: '重试' });
  cleanup();
  api.request.mockRejectedValue(err(400));
  mount('/financialReports?from=bad');
  expect(
    await screen.findByText('筛选条件无效，请清除筛选后重新选择。'),
  ).toBeVisible();
});
it('search waits for IME composition and keeps middle edits intact', async () => {
  mount();
  const input = await screen.findByPlaceholderText('搜索来源编号或凭证号');
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: 'zhong' } });
  await new Promise((r) => setTimeout(r, 350));
  expect(api.request).toHaveBeenCalledTimes(1);
  fireEvent.compositionEnd(input, { data: '中' });
  fireEvent.change(input, { target: { value: '中间' } });
  await waitFor(() =>
    expect(api.request.mock.calls.at(-1)?.[0].query.q).toBe('中间'),
  );
  expect(input).toHaveValue('中间');
});
it('404 source stays open with Close, no Retry, and refreshes its parent', async () => {
  api.request.mockImplementation(async (v) => {
    if (v.path !== 'financialReports')
      throw new ApiClientError('Missing', {
        status: 404,
        reason: 'RECORD_NOT_FOUND',
      });
    return result;
  });
  mount('/financialReports/event/missing?view=cash');
  const dialog = await screen.findByRole('dialog');
  expect(await within(dialog).findByRole('alert')).toBeVisible();
  expect(
    within(dialog).getAllByRole('button', { name: '关闭', exact: true })[0],
  ).toBeVisible();
  expect(
    within(dialog).queryByRole('button', { name: '重试' }),
  ).not.toBeInTheDocument();
  await waitFor(() =>
    expect(
      api.request.mock.calls.filter(([v]) => v.path === 'financialReports')
        .length,
    ).toBeGreaterThanOrEqual(1),
  );
});

it('uses metric-card-shaped initial loading and label-value source loading', async () => {
  api.request.mockImplementation(() => new Promise(() => {}));
  mount();
  expect(
    screen
      .getByRole('status', { name: '加载中' })
      .querySelectorAll('[data-slot="card"]'),
  ).toHaveLength(8);
  cleanup();
  api.request.mockImplementation((v) =>
    v.path === 'financialReports'
      ? Promise.resolve(result)
      : new Promise(() => {}),
  );
  mount('/financialReports/event/receipt%3Aone');
  const dialog = await screen.findByRole('dialog');
  const status = within(dialog).getByRole('status', { name: '加载中' });
  expect(status.querySelector('dl')).toBeInTheDocument();
});
it('shows the authorized counterparty on the source drawer', async () => {
  api.request.mockImplementation(async (v) =>
    v.path === 'financialReports'
      ? result
      : {
          data: {
            ...row,
            partyName: '授权演示商户',
            generatedAt: result.data.generatedAt,
          },
        },
  );
  mount('/financialReports/event/receipt%3Aone');
  const dialog = await screen.findByRole('dialog');
  expect(await within(dialog).findByText('授权演示商户')).toBeVisible();
});
it('keeps same-scope amounts during Refresh and replaces them after the response', async () => {
  const user = userEvent.setup();
  let finish!: (value: typeof result) => void;
  api.request.mockResolvedValueOnce(result).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  mount();
  await screen.findByRole('link', { name: 'SK-TEST' });
  await user.click(screen.getByRole('button', { name: '刷新' }));
  expect(screen.getByText('SK-TEST')).toBeVisible();
  expect(
    screen.queryByRole('link', { name: 'SK-TEST' }),
  ).not.toBeInTheDocument();
  expect(screen.getByText('正在刷新，暂不可打开明细')).toBeVisible();
  finish({
    ...result,
    data: {
      ...result.data,
      summary: { ...result.data.summary, netCents: '90000' },
    },
  });
  await screen.findByText('¥900.00');
  await screen.findByRole('link', { name: 'SK-TEST' });
});
it('offers sign-in again for an ended session and no retry', async () => {
  api.request.mockRejectedValue(new ApiClientError('Expired', { status: 401 }));
  mount();
  expect(await screen.findByRole('button', { name: '重新登录' })).toBeVisible();
  expect(
    screen.queryByRole('button', { name: '重试' }),
  ).not.toBeInTheDocument();
});
it('all date presets write complete valid ranges to the URL', async () => {
  const user = userEvent.setup();
  mount();
  await screen.findByText('SK-TEST');
  for (const name of ['近7天', '近30天', '本月', '上月', '近90天']) {
    await user.click(screen.getByRole('button', { name: '登记日期范围' }));
    await user.click(await screen.findByRole('button', { name, exact: true }));
    await waitFor(() => {
      const url = screen.getByTestId('url').textContent ?? '',
        q = new URLSearchParams(url.split('?')[1]);
      expect(q.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(q.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(q.get('from')! <= q.get('to')!).toBe(true);
    });
  }
});
it('all-clear reconciliation is informational while discrepancies use alert semantics', async () => {
  api.request.mockResolvedValue({
    ...result,
    data: { ...result.data, items: [] },
  });
  mount('/financialReports?view=checks');
  expect(await screen.findByText('已核对 0 项，差异 0 项。')).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('closing a direct source URL restores focus to the report heading', async () => {
  const user = userEvent.setup();
  mount('/financialReports/event/receipt%3Aone');
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByText('DEMO-VOUCHER');
  await user.click(
    within(dialog).getAllByRole('button', { name: '关闭', exact: true })[0],
  );
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: '财务报表' })).toHaveFocus(),
  );
});

vi.mock('@nocobase/app-plugin-authorization/client', async (original) => ({
  ...(await original<
    typeof import('@nocobase/app-plugin-authorization/client')
  >()),
  useAuthorizationRevision: () => 0,
}));
