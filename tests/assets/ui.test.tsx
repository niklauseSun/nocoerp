import AssetDetail from '../../client/pages/assets/detail.js';
import { ApiClientError } from '@nocobase/app-client';
import en from '../../client/locales/en-US.js';
import { useState } from 'react';
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
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { assetDrafts } from '../../client/pages/assets/drafts.js';
import zh from '../../client/locales/zh-CN.js';
import Assets from '../../client/pages/assets/index.js';
import AssetForm from '../../client/pages/assets/form.js';
import {
  ContractAssetsSelector,
  MerchantAssetBindings,
} from '../../client/pages/assets/bindings.js';
const { api, permission } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  permission: { can: true },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => ({ show: vi.fn() }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationRevision: () => 0,
  useCan: () => permission,
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ session: { user: { id: 'assets-ui' } } }),
}));
const runtime = await createTestI18nRuntime({
  locale: 'zh-CN',
  application: { namespace: 'nocoerp', resources: zh },
});
function mount(
  element: React.ReactNode,
  path = '/assets',
  cached?: unknown,
  selectedRuntime = runtime,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (cached) client.setQueryData(['hyl', 'asset', 'a1'], cached);
  return render(
    <TestI18nProvider runtime={selectedRuntime}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path='/assets' element={<Assets />}>
              <Route path='new' element={element} />
              <Route path=':id/edit' element={element} />
            </Route>
            <Route path='/test' element={element} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </TestI18nProvider>,
  );
}
beforeEach(() => {
  assetDrafts.clear();
  api.request.mockReset();
  permission.can = true;
});
afterEach(cleanup);
it('shows ledger empty state, filters and hides write actions for readers', async () => {
  permission.can = false;
  api.request.mockResolvedValue({
    data: [],
    meta: { total: 0, page: 1, pageSize: 20 },
  });
  mount(<Assets />);
  expect(await screen.findByText('暂无资产')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: '新建资产' }),
  ).not.toBeInTheDocument();
  await userEvent.type(
    screen.getByRole('textbox', { name: '搜索资产名称或编号' }),
    'A1',
  );
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'assets',
        query: expect.objectContaining({ q: 'A1', page: 1 }),
      }),
    ),
  );
  expect(await screen.findByText('没有符合条件的资产')).toBeInTheDocument();
});
it('creates an automatically numbered project without sending readonly fields', async () => {
  api.request.mockImplementation(({ method }: { method?: string }) =>
    Promise.resolve(
      method === 'POST'
        ? { data: { id: 'saved' } }
        : { data: [], meta: { total: 0, page: 1, pageSize: 20 } },
    ),
  );
  mount(<AssetForm />, '/assets/new');
  const name = await screen.findByLabelText('名称 *');
  await userEvent.type(name, '海源里');
  await userEvent.type(screen.getByLabelText('地址'), '入口');
  expect(screen.queryByLabelText('编号')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'assets',
        method: 'POST',
        json: expect.objectContaining({
          name: '海源里',
          type: 'project',
          parentId: null,
          address: '入口',
        }),
      }),
    ),
  );
});
it('preserves edit values and required reason, sends CAS envelope', async () => {
  api.request.mockImplementation(
    ({ path, method }: { path: string; method?: string }) =>
      Promise.resolve(
        method === 'PATCH'
          ? { data: { id: 'a1' } }
          : path === 'assets/a1'
            ? {
                data: {
                  id: 'a1',
                  number: 'ZC1',
                  name: '旧名称',
                  type: 'project',
                  parentId: null,
                  area: '20',
                  lettableArea: '10',
                  state: 'normal',
                  address: '',
                  floor: '',
                  location: '',
                  ownershipType: '',
                  ownerName: '',
                  ownershipNumber: '',
                  manager: '',
                  notes: '',
                  version: 4,
                },
              }
            : { data: [], meta: { total: 0, page: 1, pageSize: 20 } },
      ),
  );
  mount(<AssetForm />, '/assets/a1/edit');
  const name = await screen.findByLabelText('名称 *');
  await waitFor(() => expect(name).toHaveValue('旧名称'));
  await userEvent.clear(name);
  await userEvent.type(name, '新名称');
  await userEvent.type(screen.getByLabelText('变更原因 *'), '调整名称');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'assets/a1',
        method: 'PATCH',
        json: expect.objectContaining({
          expectedVersion: 4,
          reason: '调整名称',
          values: expect.objectContaining({ name: '新名称' }),
        }),
      }),
    ),
  );
  const saved = api.request.mock.calls.find(
    ([args]) => args.method === 'PATCH',
  )?.[0].json.values;
  expect(saved).not.toHaveProperty('id');
  expect(saved).not.toHaveProperty('number');
});
it('selects available contract assets and removes a selection', async () => {
  api.request.mockResolvedValue({
    data: [
      {
        id: 'a1',
        name: '一号铺位',
        number: 'ZC1',
        type: 'unit',
        state: 'normal',
        lettableArea: '10',
      },
    ],
    meta: { total: 1, page: 1, pageSize: 20 },
  });
  function Selector() {
    const [ids, setIds] = useState<string[]>([]);
    return (
      <>
        <ContractAssetsSelector
          merchantId='m1'
          value={ids}
          onChange={setIds}
          disabled={false}
        />
        <output>{ids.join(',')}</output>
      </>
    );
  }
  mount(<Selector />, '/test');
  const checkbox = await screen.findByRole('checkbox', { name: /一号铺位/ });
  await userEvent.click(checkbox);
  expect(checkbox).toBeChecked();
  expect(screen.getByRole('status')).toHaveTextContent('a1');
  await userEvent.click(checkbox);
  expect(checkbox).not.toBeChecked();
});
it('merchant binding summaries remain readable while write actions are hidden', async () => {
  permission.can = false;
  api.request.mockResolvedValue({
    data: [
      {
        id: 'b1',
        assetId: 'a1',
        start: '2026-01-01',
        end: '',
        area: '10',
        asset: { name: '已绑定铺位', number: 'ZC1' },
      },
    ],
  });
  mount(<MerchantAssetBindings id='m1' />, '/test');
  expect(await screen.findByText(/已绑定铺位/)).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: '绑定资产' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: '结束绑定' }),
  ).not.toBeInTheDocument();
});

it('holds edit prefill until a fresh response arrives despite cached detail', async () => {
  let resolve!: (value: unknown) => void;
  const fresh = new Promise((resolveResponse) => {
    resolve = resolveResponse;
  });
  const row = {
    id: 'a1',
    name: '服务器最新',
    number: 'ZC1',
    type: 'project',
    parentId: null,
    area: '10',
    lettableArea: '10',
    state: 'normal',
    address: '',
    floor: '',
    location: '',
    ownershipType: '',
    ownerName: '',
    ownershipNumber: '',
    manager: '',
    notes: '',
    version: 9,
  };
  api.request.mockImplementation(({ path }: { path: string }) =>
    path === 'assets/a1'
      ? fresh
      : Promise.resolve({
          data: [],
          meta: { total: 0, page: 1, pageSize: 20 },
        }),
  );
  mount(<AssetForm />, '/assets/a1/edit', {
    data: { ...row, name: '缓存旧名', version: 2 },
  });
  expect(screen.queryByDisplayValue('缓存旧名')).not.toBeInTheDocument();
  resolve({ data: row });
  expect(await screen.findByDisplayValue('服务器最新')).toBeInTheDocument();
});
it('keeps typed form content after a network failure and allows retry', async () => {
  let attempts = 0;
  api.request.mockImplementation(({ method }: { method?: string }) =>
    method === 'POST'
      ? ++attempts === 1
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ data: { id: 'saved', name: '保留输入' } })
      : Promise.resolve({
          data: [],
          meta: { total: 0, page: 1, pageSize: 20 },
        }),
  );
  mount(<AssetForm />, '/assets/new');
  await userEvent.type(await screen.findByLabelText('名称 *'), '保留输入');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.getByLabelText('名称 *')).toHaveValue('保留输入');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(attempts).toBe(2));
});
it('does not search unfinished Chinese composition and resets pagination on commit', async () => {
  api.request.mockResolvedValue({
    data: [],
    meta: { total: 0, page: 3, pageSize: 20 },
  });
  mount(<Assets />, '/assets?page=3');
  const input = await screen.findByRole('textbox', {
    name: '搜索资产名称或编号',
  });
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: 'hai' } });
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(api.request.mock.calls.some(([args]) => args.query?.q === 'hai')).toBe(
    false,
  );
  fireEvent.change(input, { target: { value: '海源' } });
  fireEvent.compositionEnd(input, { data: '海源' });
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'assets',
        query: expect.objectContaining({ q: '海源', page: 1 }),
      }),
    ),
  );
});

it('keeps draft on version conflict and retries with the explicitly reloaded version', async () => {
  let version = 1;
  let attempts = 0;
  const row = {
    id: 'a1',
    name: '原名称',
    number: 'ZC1',
    type: 'project',
    parentId: null,
    area: '10',
    lettableArea: '10',
    state: 'normal',
    address: '',
    floor: '',
    location: '',
    ownershipType: '',
    ownerName: '',
    ownershipNumber: '',
    manager: '',
    notes: '',
  };
  api.request.mockImplementation(
    ({ path, method }: { path: string; method?: string }) => {
      if (method === 'PATCH') {
        if (++attempts === 1) {
          version = 2;
          const error = new ApiClientError('conflict', {
            status: 409,
            method: 'PATCH',
            url: '/assets/a1',
          });
          Object.defineProperty(error, 'reason', { value: 'VERSION_CONFLICT' });
          return Promise.reject(error);
        }
        return Promise.resolve({ data: { ...row, version: 3 } });
      }
      return Promise.resolve(
        path === 'assets/a1'
          ? { data: { ...row, version } }
          : { data: [], meta: { total: 0, page: 1, pageSize: 20 } },
      );
    },
  );
  mount(<AssetForm />, '/assets/a1/edit');
  const name = await screen.findByLabelText('名称 *');
  await userEvent.clear(name);
  await userEvent.type(name, '保留修改');
  await userEvent.type(screen.getByLabelText('变更原因 *'), '调整');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await userEvent.click(
    await screen.findByRole('button', { name: '加载最新版本并保留输入' }),
  );
  expect(name).toHaveValue('保留修改');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PATCH',
        json: expect.objectContaining({
          expectedVersion: 2,
          values: expect.objectContaining({ name: '保留修改' }),
        }),
      }),
    ),
  );
});
it('renders the project form in English with complete field labels', async () => {
  const english = await createTestI18nRuntime({
    locale: 'en-US',
    application: { namespace: 'nocoerp', resources: en },
  });
  api.request.mockResolvedValue({
    data: [],
    meta: { total: 0, page: 1, pageSize: 20 },
  });
  mount(<AssetForm />, '/assets/new', undefined, english);
  expect(await screen.findByLabelText('Name *')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  expect(screen.getByText('Ownership and management')).toBeInTheDocument();
});

it('renders the asset card with readable parent, attachment empty state and append-only change history', async () => {
  const row = {
    id: 'a1',
    name: '一号铺位',
    number: 'ZC1',
    type: 'unit',
    parentId: 'p1',
    area: '20',
    lettableArea: '15',
    state: 'normal',
    address: '海源里',
    floor: '1',
    location: '东侧',
    ownershipType: '自有',
    ownerName: '景区',
    ownershipNumber: 'TEST',
    manager: '管理员',
    notes: '资产备注',
    version: 0,
    createdAt: '2026-10-16T00:00:00Z',
    updatedAt: '2026-10-16T00:00:00Z',
  };
  api.request.mockImplementation(({ path }: { path: string }) =>
    Promise.resolve(
      path === 'assets/a1'
        ? { data: row }
        : path === 'assets/p1'
          ? {
              data: {
                ...row,
                id: 'p1',
                name: '主街楼栋',
                number: 'ZC2',
                parentId: null,
              },
            }
          : path.endsWith('/history')
            ? {
                data: [
                  {
                    id: 'h1',
                    actor: '管理员',
                    action: 'create',
                    reason: '建立台账',
                    createdAt: row.createdAt,
                    before: null,
                    after: { name: row.name },
                  },
                ],
                meta: { total: 1, page: 1, pageSize: 20 },
              }
            : path.endsWith('/associations')
              ? { data: { merchants: [], contracts: [], restricted: true } }
              : { data: [], meta: { total: 0, page: 1, pageSize: 20 } },
    ),
  );
  render(
    <TestI18nProvider runtime={runtime}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter initialEntries={['/assets/a1?filePage=2']}>
          <Routes>
            <Route path='/assets/:id' element={<AssetDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </TestI18nProvider>,
  );
  expect(
    await screen.findByRole('heading', { name: '一号铺位' }),
  ).toBeInTheDocument();
  expect(await screen.findByText('主街楼栋 · ZC2')).toBeInTheDocument();
  expect(await screen.findByText('暂无附件')).toBeInTheDocument();
  expect(await screen.findByText('建立台账')).toBeInTheDocument();
  expect(screen.getByText('部分关联信息受查看权限限制。')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '新增附件' })).toHaveAttribute(
    'href',
    '/assets/a1/files/new?filePage=2',
  );
});
