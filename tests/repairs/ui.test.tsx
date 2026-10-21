import filePlugin from '@nocobase/app-plugin-file/client';
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
  useService: () => ({ repository: () => ({}) }),
  useToaster: () => ({ show: vi.fn() }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationRevision: () => 0,
  useCan: ({ action }: { action: string }) => ({
    can: can.value && (action !== 'report' || can.report),
  }),
}));
const runtime = await createTestI18nRuntime({
  locale: 'zh-CN',
  namespaces: { '@nocobase/app-plugin-file': filePlugin().locales ?? {} },
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
  await user.click(
    screen.getByRole('combobox', { name: '报修资产 *', exact: true }),
  );
  await screen.findByRole('option', { name: '首页资产' });
  await user.click(screen.getByRole('button', { name: '下一页', exact: true }));
  await waitFor(() =>
    expect(screen.queryByRole('option', { name: '首页资产' })).toBeNull(),
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

vi.mock('@nocobase/app-plugin-authentication/client', async (original) => ({
  ...(await original<
    typeof import('@nocobase/app-plugin-authentication/client')
  >()),
  useAuthentication: () => ({ session: { user: { id: 'business-test' } } }),
}));

it('uploads acceptance photos, removes one selection and saves only retained IDs', async () => {
  let count = 0;
  const writes: any[] = [];
  api.request.mockImplementation(async (r) => {
    if (r.path === 'repairFiles/uploadOne') {
      const id = 'photo-' + ++count,
        file = r.body.get('file');
      return {
        data: {
          record: {
            id,
            filename: file.name,
            ext: 'png',
            mimeType: 'image/png',
            size: file.size,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            contentUrl: '/main/uploads/repairPhotos/' + id + '.png',
          },
          createdTargets: [],
        },
      };
    }
    if (r.method === 'POST') {
      writes.push(r);
      throw new ApiClientError('failure', {
        status: 500,
        method: 'POST',
        url: r.path,
      });
    }
    return { data: order };
  });
  mount(<RepairForm />, '/repairs/order/accept');
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('说明 *'), '图片验收');
  await user.upload(screen.getByLabelText('选择图片'), [
    new File(['a'], '现场一.png', { type: 'image/png' }),
    new File(['b'], '现场二.png', { type: 'image/png' }),
  ]);
  await screen.findByRole('button', { name: '移除图片: 现场一.png' });
  expect(
    screen.getByRole('button', { name: '预览图片: 现场一.png' }),
  ).toBeVisible();
  await user.click(
    screen.getByRole('button', { name: '移除图片: 现场一.png' }),
  );
  expect(
    screen.getByRole('button', { name: '选择图片', exact: true }),
  ).toHaveFocus();
  await user.click(
    screen.getByRole('button', { name: '验收通过', exact: true }),
  );
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: '验收通过',
      exact: true,
    }),
  );
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].json.photoIds).toEqual(['photo-2']);
  const uploads = api.request.mock.calls
    .map(([r]) => r)
    .filter((r) => r.path === 'repairFiles/uploadOne');
  expect(uploads[0].query).toEqual({
    assetId: 'asset',
    orderId: 'order',
    stage: 'acceptance',
  });
});

it('blocks submit and close for mixed failed/in-flight photos until failures are cancelled and uploads finish', async () => {
  let fail!: (reason: unknown) => void, finish!: (value: unknown) => void;
  const first = new Promise((_r, reject) => {
      fail = reject;
    }),
    second = new Promise((resolve) => {
      finish = resolve;
    });
  let count = 0;
  api.request.mockImplementation(async (r) =>
    r.path === 'repairFiles/uploadOne'
      ? ++count === 1
        ? first
        : second
      : { data: order },
  );
  mount(<RepairForm />, '/repairs/order/accept');
  const user = userEvent.setup();
  await user.upload(await screen.findByLabelText('选择图片'), [
    new File(['a'], '失败.png', { type: 'image/png' }),
    new File(['b'], '处理中.png', { type: 'image/png' }),
  ]);
  await waitFor(() => expect(count).toBe(2));
  expect(
    screen.getByRole('button', { name: '验收通过', exact: true }),
  ).toBeDisabled();
  fail(new Error('File upload failed.'));
  await screen.findByRole('button', { name: '重试上传: 失败.png' });
  expect(
    screen.getByRole('button', { name: '验收通过', exact: true }),
  ).toBeDisabled();
  expect(
    screen.getByRole('button', { name: '取消', exact: true }),
  ).toBeDisabled();
  await user.click(screen.getByRole('button', { name: '取消 失败.png' }));
  expect(
    screen.getByRole('button', { name: '验收通过', exact: true }),
  ).toBeDisabled();
  finish({
    data: {
      record: {
        id: 'photo',
        filename: '处理中.png',
        ext: 'png',
        mimeType: 'image/png',
        size: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        contentUrl: '/main/uploads/repairPhotos/photo.png',
      },
      createdTargets: [],
    },
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: '验收通过', exact: true }),
    ).toBeEnabled(),
  );
});

it('returns focus to the chooser after removing a photo from a full nine-photo selection', async () => {
  const photos = Array.from({ length: 9 }, (_, i) => ({
    id: 'photo-' + i,
    filename: '现场' + i + '.png',
    ext: 'png',
    mimeType: 'image/png',
    size: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    contentUrl: '/main/uploads/repairPhotos/photo-' + i + '.png',
  }));
  api.request.mockResolvedValue({
    data: {
      ...order,
      status: 'reported',
      photos: { report: photos, processing: [], acceptance: [] },
    },
  });
  mount(<RepairForm />, '/repairs/order/edit');
  const choose = await screen.findByRole('button', {
    name: '选择图片',
    exact: true,
  });
  expect(choose).toBeDisabled();
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: '移除图片: 现场0.png' }));
  expect(choose).toBeEnabled();
  await waitFor(() => expect(choose).toHaveFocus());
});

it('uses the shared contract title and merchant fallback in repair associations', async () => {
  api.request.mockResolvedValue({
    data: [
      {
        id: 'c1',
        number: 'HT-1',
        name: '商户甲',
        payload: { title: '维修关联租约' },
      },
      { id: 'c2', number: 'HT-2', name: '商户乙', payload: { title: ' ' } },
    ],
    meta: { page: 1, pageSize: 20, total: 2 },
  });
  mount(
    <RepairPicker
      kind='contracts'
      name='contractId'
      value=''
      onChange={() => {}}
      required={false}
    />,
  );
  await userEvent
    .setup()
    .click(screen.getByRole('combobox', { name: '租赁合同' }));
  expect(
    await screen.findByRole('option', { name: '维修关联租约 · HT-1' }),
  ).toBeVisible();
  expect(screen.getByRole('option', { name: '商户乙 · HT-2' })).toBeVisible();
});
