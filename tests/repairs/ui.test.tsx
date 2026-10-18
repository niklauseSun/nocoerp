import { RepairPicker } from '../../client/pages/repairs/common.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  TestI18nProvider,
  createTestI18nRuntime,
} from '@nocobase/i18n/testing';
import { ApiClientError } from '@nocobase/app-client';
import {
  render,
  screen,
  cleanup,
  waitFor,
  within,
  fireEvent,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import zh from '../../client/locales/zh-CN.js';
import en from '../../client/locales/en-US.js';
import RepairList from '../../client/pages/repairs/list.js';
import RepairForm from '../../client/pages/repairs/form.js';
import RepairDetail from '../../client/pages/repairs/detail.js';
const { api, can } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  can: { value: true, report: true },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useNavigationGuard: vi.fn(),
  useApiClient: () => api,
  useToaster: () => ({ show: vi.fn() }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useCan: ({ action }: { action: string }) => ({
    can: can.value && (action !== 'report' || can.report),
  }),
}));
const runtime = await createTestI18nRuntime({
  locale: 'zh-CN',
  application: { namespace: 'nocoerp', resources: zh },
});
const order = {
  id: 'order',
  number: 'BX-TEST',
  title: '水槽漏水',
  status: 'pendingAcceptance',
  version: 3,
  assetId: 'asset',
  merchantId: '',
  contractId: '',
  priority: 'high',
  category: 'plumbing',
  occurredOn: '2026-10-18',
  dueOn: '2026-10-19',
  costCents: '12000',
  allowedActions: ['accept', 'reject'],
  blockedActions: [],
  payload: {
    description: '水槽接头漏水',
    reporterName: '商户',
    reporterPhone: '0',
  },
  events: { data: [], meta: { total: 0, page: 1, pageSize: 20 } },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
function mount(
  element: React.ReactNode,
  path = '/repairs/new',
  cached?: unknown,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (cached)
    queryClient.setQueryData(['hyl', 'repairOrders/order', undefined], {
      data: cached,
    });
  return render(
    <TestI18nProvider runtime={runtime}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path='/repairs/:repairId/accept' element={element} />
            <Route path='/repairs/:repairId' element={element} />
            <Route path='*' element={element} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </TestI18nProvider>,
  );
}
afterEach(cleanup);
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  can.value = true;
  can.report = true;
  api.request.mockReset();
  api.request.mockImplementation(async (r) =>
    r.path === 'repairOrders/order'
      ? { data: order }
      : { data: [], meta: { page: 1, pageSize: 20, total: 0 } },
  );
});
it('shows one empty create action and hides it without report access', async () => {
  mount(<RepairList />, '/repairs');
  expect(await screen.findByText('暂无工单')).toBeVisible();
  expect(screen.getAllByRole('button', { name: '新增报修' })).toHaveLength(1);
  cleanup();
  can.value = false;
  mount(<RepairList />, '/repairs');
  expect(screen.queryByRole('button', { name: '新增报修' })).toBeNull();
});
it('validates required fields before mutation and retains Chinese text editing', async () => {
  const user = userEvent.setup();
  mount(<RepairForm />);
  await user.click(await screen.findByRole('button', { name: '保存' }));
  expect(await screen.findAllByText('请填写此项。')).not.toHaveLength(0);
  expect(api.request.mock.calls.every(([r]) => r.method !== 'POST')).toBe(true);
  const title = screen.getByLabelText('报修标题 *');
  await user.type(title, '管道漏水');
  expect(title).toHaveValue('管道漏水');
  await user.type(title, '{ArrowLeft}需');
  expect(title).toHaveValue('管道漏需水');
});
it('keeps failed acceptance dialog and retries the same operation', async () => {
  const user = userEvent.setup();
  const writes: any[] = [];
  api.request.mockImplementation(async (r) => {
    if (r.method === 'POST') {
      writes.push(r);
      throw new ApiClientError('failure', {
        status: 500,
        method: 'POST',
        url: '/repairOrders/order/actions',
      });
    }
    return { data: order };
  });
  mount(<RepairForm />, '/repairs/order/accept');
  await user.type(await screen.findByLabelText('说明 *'), '通水检查合格');
  await user.click(
    screen.getByRole('button', { name: '验收通过', exact: true }),
  );
  const confirm = await screen.findByRole('alertdialog');
  await user.click(
    within(confirm).getByRole('button', { name: '验收通过', exact: true }),
  );
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(screen.getByRole('alertdialog')).toBeVisible();
  await waitFor(() =>
    expect(
      within(confirm).getByRole('button', { name: '验收通过', exact: true }),
    ).toBeEnabled(),
  );
  await user.click(
    within(confirm).getByRole('button', { name: '验收通过', exact: true }),
  );
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[0].json.requestId).toBe(writes[1].json.requestId);
  expect(writes[1].json.note).toBe('通水检查合格');
});
it('terminal detail exposes no mutation actions; both locale trees have identical keys', async () => {
  api.request.mockResolvedValue({
    data: { ...order, status: 'closed', allowedActions: [] },
  });
  mount(<RepairDetail />, '/repairs/order');
  expect(await screen.findByText('工单已结束，记录保留供核对。')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: '验收通过', exact: true }),
  ).toBeNull();
  function keys(v: unknown, prefix = ''): string[] {
    return v && typeof v === 'object'
      ? Object.entries(v).flatMap(([k, x]) => keys(x, prefix + '.' + k))
      : [prefix];
  }
  expect(keys(zh.repair).sort()).toEqual(keys(en.repair).sort());
});

it('waits for a fresh form baseline instead of cached action data', async () => {
  let resolve!: (value: unknown) => void;
  const fresh = new Promise((r) => {
    resolve = r;
  });
  api.request.mockReturnValue(fresh);
  mount(<RepairForm />, '/repairs/order/accept', { ...order, version: 1 });
  expect(screen.queryByLabelText('说明 *')).toBeNull();
  resolve({ data: { ...order, version: 9 } });
  expect(await screen.findByLabelText('说明 *')).toBeVisible();
});
it('read-only empty copy asks an administrator and optional clearing stays valid', async () => {
  can.report = false;
  mount(<RepairList />, '/repairs');
  expect(
    await screen.findByText('暂无工单，可联系管理员登记报修或申请报修权限。'),
  ).toBeVisible();
  cleanup();
  can.report = true;
  const user = userEvent.setup();
  mount(<RepairForm />);
  await user.click(await screen.findByRole('button', { name: '保存' }));
  const location = screen.getByLabelText('具体位置');
  fireEvent.change(location, { target: { value: 'x'.repeat(301) } });
  expect(location).toHaveAttribute('aria-invalid', 'true');
  fireEvent.change(location, { target: { value: '' } });
  expect(location).toHaveAttribute('aria-invalid', 'false');
  const title = screen.getByLabelText('报修标题 *');
  fireEvent.change(title, { target: { value: 'x'.repeat(101) } });
  expect(title).toHaveAttribute('aria-invalid', 'true');
  fireEvent.change(title, { target: { value: '有效标题' } });
  expect(title).toHaveAttribute('aria-invalid', 'false');
});

it('suppresses stale picker options while a later page loads', async () => {
  const user = userEvent.setup();
  let resolve!: (value: unknown) => void;
  const later = new Promise((r) => {
    resolve = r;
  });
  api.request.mockImplementation(async (r) =>
    r.query?.page === 2
      ? later
      : {
          data: [{ id: 'a1', name: '首页资产' }],
          meta: { page: 1, pageSize: 20, total: 21 },
        },
  );
  mount(
    <RepairPicker
      kind='assets'
      name='assetId'
      value=''
      onChange={() => {}}
      required
    />,
  );
  expect(
    await screen.findByRole('combobox', { name: '报修资产 *', exact: true }),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: '下一页', exact: true }));
  await waitFor(() =>
    expect(
      screen.queryByRole('combobox', { name: '报修资产 *', exact: true }),
    ).toBeNull(),
  );
  resolve({
    data: [{ id: 'a2', name: '第二页资产' }],
    meta: { page: 2, pageSize: 20, total: 21 },
  });
  expect(
    await screen.findByRole('combobox', { name: '报修资产 *', exact: true }),
  ).toBeVisible();
});
it('gives a parent Back link without Retry for a missing action record', async () => {
  api.request.mockRejectedValue(
    new ApiClientError('missing', {
      status: 404,
      method: 'GET',
      url: '/repairOrders/missing',
    }),
  );
  mount(<RepairForm />, '/repairs/missing/accept');
  await screen.findByRole('alert');
  expect(
    screen.getByRole('link', { name: '返回', exact: true }),
  ).toHaveAttribute('href', '/repairs/missing');
  expect(
    screen.queryByRole('button', { name: '重试', exact: true }),
  ).toBeNull();
});
