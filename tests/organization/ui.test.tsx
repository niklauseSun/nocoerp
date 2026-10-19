import en from '../../client/locales/en-US.js';
import { useOrg } from '../../client/pages/organization/hooks.js';
import { ErrorBox } from '../../client/pages/organization/common.js';
import Users from '../../client/pages/organization/users.js';
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
import { MemoryRouter, Routes, Route } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiClientError } from '@nocobase/app-client';
import zh from '../../client/locales/zh-CN.js';
import Departments from '../../client/pages/organization/departments.js';
import NewDepartment from '../../client/pages/organization/new-department.js';
import Projects from '../../client/pages/organization/projects.js';
import RoleForm from '../../client/pages/organization/role-form.js';
import { useBusinessQuery } from '../../client/pages/hyl/hooks.js';
import { useScopedQuery } from '../../client/hooks/use-scoped-query.js';
const { api, state } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  state: { actor: 'a', revision: 0, can: true },
}));
vi.stubGlobal(
  'matchMedia',
  vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
);
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useNavigationGuard: vi.fn(),
  useToaster: () => ({ show: vi.fn() }),
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ session: { user: { id: state.actor } } }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useCan: () => ({ can: state.can, isPending: false }),
  useAuthorizationRevision: () => state.revision,
}));
const runtime = await createTestI18nRuntime({
    locale: 'zh-CN',
    application: { namespace: 'nocoerp', resources: zh },
  }),
  department = {
    id: 'd',
    title: '演示部门',
    parentId: null,
    active: true,
    version: 0,
  },
  snapshot = {
    data: { departments: [department], members: [], projects: [], names: {} },
  },
  options = {
    data: {
      users: [
        {
          id: 'u',
          name: '演示用户',
          email: 'demo@example.test',
          disabledAt: null,
        },
      ],
      userTotal: 1,
      projects: [{ id: 'p', name: '演示项目' }],
      projectTotal: 1,
    },
  };
function mount(el: React.ReactNode, path = '/organization/departments') {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <TestI18nProvider runtime={runtime}>
      <QueryClientProvider client={cache}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path='/organization/departments' element={<Departments />}>
              <Route path='new' element={<NewDepartment />} />
            </Route>
            <Route path='/organization/users' element={<Users />} />
            <Route path='/organization/projects' element={<Projects />} />
            <Route path='/organization/roles/:roleKey' element={el} />
            <Route path='/query' element={el} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </TestI18nProvider>,
  );
  return { view, cache };
}
beforeEach(() => {
  state.actor = 'a';
  state.revision = 0;
  state.can = true;
  api.request.mockReset();
  api.request.mockImplementation(({ path, method }: any) => {
    if (method) return Promise.resolve({ data: { ...department } });
    if (path === 'organization') return Promise.resolve(snapshot);
    if (path === 'organization/options') return Promise.resolve(options);
    return Promise.resolve({ data: [] });
  });
});
afterEach(cleanup);
it('renders departments and read-only cards without mutation controls', async () => {
  state.can = false;
  mount(<Departments />);
  expect(
    await screen.findByText('演示部门', {
      selector: 'div[data-slot="card-title"]',
    }),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: '保存', exact: true }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: '添加或更新成员' }),
  ).not.toBeInTheDocument();
});
it('retains draft on server rejection and submits exact department version', async () => {
  const user = userEvent.setup();
  api.request.mockImplementation(({ path, method }: any) =>
    method
      ? Promise.reject(
          new ApiClientError('stale', { status: 409, reason: 'ORG_STALE' }),
        )
      : Promise.resolve(path === 'organization' ? snapshot : options),
  );
  mount(<Departments />);
  await screen.findByLabelText('名称 *');
  await user.clear(screen.getByLabelText('名称 *'));
  await user.type(screen.getByLabelText('名称 *'), '新名称');
  await user.click(screen.getByRole('button', { name: '保存', exact: true }));
  expect(await screen.findByText(/配置已变更/)).toBeVisible();
  expect(screen.getByLabelText('名称 *')).toHaveValue('新名称');
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      method: 'PATCH',
      json: { title: '新名称', parentId: null, active: true, version: 0 },
    }),
  );
});
it('new department validates required name and calls server only on valid submission', async () => {
  const user = userEvent.setup();
  mount(<NewDepartment />, '/organization/departments/new');
  await screen.findByRole('heading', { name: '新增部门' });
  await user.click(screen.getByRole('button', { name: '创建', exact: true }));
  expect(api.request.mock.calls.filter(([x]) => x.method)).toHaveLength(0);
  await user.type(screen.getAllByLabelText('名称 *').at(-1)!, '测试部门');
  await user.click(screen.getByRole('button', { name: '创建', exact: true }));
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'organization/departments',
        method: 'POST',
        json: { title: '测试部门', parentId: null, active: true, version: 0 },
      }),
    ),
  );
});
it('shows empty project assignments and keeps grant disabled without both targets', async () => {
  mount(<Projects />, '/organization/projects');
  expect(await screen.findByText('暂无授权记录。')).toBeVisible();
  expect(
    screen.getByRole('button', { name: '授权', exact: true }),
  ).toBeDisabled();
});
it('denies role section without fetching the permission catalogue', async () => {
  state.can = false;
  mount(<RoleForm />, '/organization/roles/test');
  expect(await screen.findByText('你没有此分区的访问权限。')).toBeVisible();
  expect(api.request).not.toHaveBeenCalledWith(
    expect.objectContaining({ path: 'authorization/permissionSets/options' }),
  );
});
it('shape loading then retryable errors; no retry on forbidden', async () => {
  api.request.mockRejectedValue(new ApiClientError('denied', { status: 403 }));
  mount(<Departments />);
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: '重试' }),
  ).not.toBeInTheDocument();
});
function QueryProbe({ direct = false }: { direct?: boolean }) {
  const a = useBusinessQuery<{ data: string }>('contracts', { page: 1 }),
    b = useScopedQuery({
      queryKey: ['hyl', 'asset', 'one'],
      enabled: direct,
      queryFn: () => api.request<{ data: string }>({ path: 'assets/one' }),
      placeholderData: (old) => old,
    });
  return <p>{(direct ? b : a).data?.data ?? 'loading'}</p>;
}
it('never shows a previous user’s cached business data after session switch', async () => {
  api.request.mockResolvedValue({ data: 'user A only' });
  const { view } = mount(<QueryProbe />, '/query');
  await screen.findByText('user A only');
  state.actor = 'b';
  api.request.mockImplementation(() => new Promise(() => {}));
  view.rerender(
    <TestI18nProvider runtime={runtime}>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <QueryProbe />
        </MemoryRouter>
      </QueryClientProvider>
    </TestI18nProvider>,
  );
  expect(screen.queryByText('user A only')).not.toBeInTheDocument();
});
it('permissions revision removes cached direct asset data even with pagination continuity', async () => {
  api.request.mockResolvedValue({ data: 'old grant only' });
  const cache = new QueryClient(),
    wrap = () => (
      <TestI18nProvider runtime={runtime}>
        <QueryClientProvider client={cache}>
          <MemoryRouter>
            <QueryProbe direct />
          </MemoryRouter>
        </QueryClientProvider>
      </TestI18nProvider>
    );
  const view = render(wrap());
  await screen.findByText('old grant only');
  state.revision = 1;
  api.request.mockImplementation(() => new Promise(() => {}));
  view.rerender(wrap());
  expect(screen.queryByText('old grant only')).not.toBeInTheDocument();
});
it('IME composition does not send partial pinyin to the member search', async () => {
  mount(<Departments />);
  const input = await screen.findByPlaceholderText('按姓名或邮箱搜索用户');
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: 'zhong' } });
  await new Promise((r) => setTimeout(r, 300));
  expect(
    api.request.mock.calls.filter(([x]) => x.query?.q === 'zhong'),
  ).toHaveLength(0);
  fireEvent.compositionEnd(input, { data: '中' });
  fireEvent.change(input, { target: { value: '中' } });
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ q: '中' }) }),
    ),
  );
});
it('role editor saves the complete definition and preserves an unrelated custom scope', async () => {
  const user = userEvent.setup(),
    grants = [
      {
        resource: { type: 'composite', id: 'legacy' },
        actions: [
          {
            action: 'read',
            policy: {
              type: 'composite',
              scopes: {
                records: {
                  type: 'recordAccess',
                  key: 'customFilter',
                  params: { filter: { id: 'one' } },
                },
              },
            },
          },
        ],
      },
    ];
  api.request.mockImplementation(({ path, method }: any) => {
    if (method) return Promise.resolve({ data: {} });
    if (path === 'authorization/permissionSets/test')
      return Promise.resolve({
        data: { key: 'test', title: '测试角色', grants },
      });
    if (path === 'authorization/permissionSets/options')
      return Promise.resolve({
        data: {
          sections: [],
          recordAccess: [],
          subjectTypes: [],
          collections: [],
        },
      });
    if (path === 'organization') return Promise.resolve(snapshot);
    if (path === 'organization/options') return Promise.resolve(options);
    return Promise.resolve({ data: [] });
  });
  mount(<RoleForm />, '/organization/roles/test');
  await screen.findByLabelText('名称 *');
  await user.clear(screen.getByLabelText('名称 *'));
  await user.type(screen.getByLabelText('名称 *'), '新角色名');
  await user.click(screen.getByRole('button', { name: '保存', exact: true }));
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PATCH',
        json: { key: 'test', title: '新角色名', grants },
      }),
    ),
  );
});
it('protected root role remains read-only even for an otherwise allowed editor', async () => {
  api.request.mockImplementation(({ path }: any) => {
    if (path === 'authorization/permissionSets/root')
      return Promise.resolve({
        data: {
          key: 'root',
          title: 'Root',
          grants: [],
          protection: {
            owner: 'platform',
            allow: ['assign', 'revoke'],
            assignableTo: ['user'],
          },
        },
      });
    if (path === 'authorization/permissionSets/options')
      return Promise.resolve({
        data: {
          sections: [],
          recordAccess: [],
          subjectTypes: [],
          collections: [],
        },
      });
    if (path === 'organization') return Promise.resolve(snapshot);
    if (path === 'organization/options') return Promise.resolve(options);
    return Promise.resolve({ data: [] });
  });
  mount(<RoleForm />, '/organization/roles/root');
  expect(await screen.findByLabelText('名称 *')).toBeDisabled();
  expect(
    screen.queryByRole('button', { name: '保存', exact: true }),
  ).not.toBeInTheDocument();
});
it('user directory displays role labels from the public Users catalogue', async () => {
  api.request.mockImplementation(({ path }: any) =>
    path === 'users'
      ? Promise.resolve({
          data: [
            {
              id: 'u',
              name: '演示用户',
              email: 'x@example.test',
              disabledAt: null,
              roleScopes: { app: ['reader'] },
            },
          ],
          meta: { page: 1, pageSize: 20, total: 1 },
        })
      : Promise.resolve({
          data: {
            roleScopes: [
              {
                key: 'app',
                options: [{ value: 'reader', label: '业务查看员' }],
              },
            ],
          },
        }),
  );
  mount(<Users />, '/organization/users');
  expect(
    await screen.findByRole('link', { name: '业务查看员' }),
  ).toHaveAttribute('href', '/organization/roles/reader');
  expect(screen.getByText('直接角色')).toBeVisible();
});
it('organization settings have complete English copy', async () => {
  const english = await createTestI18nRuntime({
    locale: 'en-US',
    application: { namespace: 'nocoerp', resources: en },
  });
  render(
    <TestI18nProvider runtime={english}>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <Projects />
        </MemoryRouter>
      </QueryClientProvider>
    </TestI18nProvider>,
  );
  expect(await screen.findByText('No access assignments yet.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Grant access' })).toBeDisabled();
});

it('keeps rejected member removal feedback inside the named confirmation', async () => {
  const user = userEvent.setup();
  api.request.mockImplementation(({ path, method }: any) =>
    method
      ? Promise.reject(
          new ApiClientError('stale', { status: 409, reason: 'ORG_STALE' }),
        )
      : Promise.resolve(
          path === 'organization'
            ? {
                data: {
                  ...snapshot.data,
                  members: [
                    {
                      id: 'm',
                      departmentId: 'd',
                      userId: 'u',
                      active: true,
                      primary: false,
                    },
                  ],
                  names: { u: '演示用户' },
                },
              }
            : options,
        ),
  );
  mount(<Departments />);
  await user.click(
    await screen.findByRole('button', { name: '移除', exact: true }),
  );
  const dialog = screen.getByRole('alertdialog');
  expect(within(dialog).getByRole('heading').textContent).toContain('演示用户');
  await user.click(
    within(dialog).getByRole('button', { name: '移除', exact: true }),
  );
  expect(await within(dialog).findByRole('alert')).toBeVisible();
  expect(
    within(dialog).getByRole('button', { name: '移除', exact: true }),
  ).toBeEnabled();
  expect(dialog.querySelector('p p')).toBeNull();
});
it('validates whitespace names inline and focuses the dialog field without submitting', async () => {
  const user = userEvent.setup();
  mount(<NewDepartment />, '/organization/departments/new');
  const dialog = await screen.findByRole('dialog'),
    name = within(dialog).getByLabelText('名称 *');
  await user.type(name, '   ');
  await user.click(
    within(dialog).getByRole('button', { name: '创建', exact: true }),
  );
  expect(await within(dialog).findByText('请输入非空部门名称。')).toBeVisible();
  expect(name).toHaveAttribute('aria-invalid', 'true');
  expect(name).toHaveFocus();
  expect(api.request.mock.calls.filter(([x]) => x.method)).toHaveLength(0);
  await user.type(name, '部门');
  expect(name).toHaveAttribute('aria-invalid', 'false');
});
it('maps rejected parent selection inline and keeps its draft', async () => {
  const user = userEvent.setup();
  api.request.mockImplementation(({ path, method }: any) =>
    method
      ? Promise.reject(
          new ApiClientError('cycle', { status: 409, reason: 'ORG_CYCLE' }),
        )
      : Promise.resolve(path === 'organization' ? snapshot : options),
  );
  mount(<Departments />);
  await user.click(
    await screen.findByRole('button', { name: '保存', exact: true }),
  );
  const parent = screen.getByLabelText('上级部门');
  await waitFor(() => expect(parent).toHaveAttribute('aria-invalid', 'true'));
  expect(parent).toHaveAttribute('aria-describedby', 'org-parent-error');
  await waitFor(() => expect(parent).toHaveFocus());
  expect(screen.getByLabelText('名称 *')).toHaveValue('演示部门');
});
function OrgQueryProbe({ page }: { page: number }) {
  const r = useOrg<{ data: string }>('users', { page });
  return <p>{r.data?.data ?? 'loading'}</p>;
}
it('keeps rows through same-user paging but clears them on authorization or account change', async () => {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let page = 1;
  const wrap = () => (
    <TestI18nProvider runtime={runtime}>
      <QueryClientProvider client={cache}>
        <OrgQueryProbe page={page} />
      </QueryClientProvider>
    </TestI18nProvider>
  );
  api.request.mockResolvedValue({ data: 'previous page' });
  const view = render(wrap());
  await screen.findByText('previous page');
  api.request.mockImplementation(() => new Promise(() => {}));
  page = 2;
  view.rerender(wrap());
  expect(screen.getByText('previous page')).toBeVisible();
  state.revision = 1;
  view.rerender(wrap());
  expect(screen.queryByText('previous page')).not.toBeInTheDocument();
  api.request.mockResolvedValue({ data: 'revised page' });
  cache.setQueryData(['organization', 'a', 1, 'users', { page: 2 }], {
    data: 'revised page',
  });
  await screen.findByText('revised page');
  state.actor = 'b';
  api.request.mockImplementation(() => new Promise(() => {}));
  view.rerender(wrap());
  expect(screen.queryByText('revised page')).not.toBeInTheDocument();
});
it('offers sign-in for expired sessions and return navigation for deleted roles', async () => {
  const view = mount(
    <ErrorBox error={new ApiClientError('expired', { status: 401 })} />,
    '/query',
  );
  expect(screen.getByRole('button', { name: '重新登录' })).toHaveAttribute(
    'href',
    '/login',
  );
  view.view.unmount();
  api.request.mockRejectedValue(new ApiClientError('missing', { status: 404 }));
  mount(<RoleForm />, '/organization/roles/missing');
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: '重试' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('link')).toHaveAttribute(
    'href',
    '/organization/roles',
  );
});

it('reloads stale department only after confirming discard and replaces its draft', async () => {
  const user = userEvent.setup();
  let latest = false;
  api.request.mockImplementation(({ path, method }: any) =>
    method
      ? Promise.reject(
          new ApiClientError('stale', { status: 409, reason: 'ORG_STALE' }),
        )
      : Promise.resolve(
          path === 'organization'
            ? latest
              ? {
                  data: {
                    ...snapshot.data,
                    departments: [
                      { ...department, title: '服务器最新部门', version: 1 },
                    ],
                  },
                }
              : snapshot
            : options,
        ),
  );
  mount(<Departments />);
  const name = await screen.findByLabelText('名称 *');
  await user.clear(name);
  await user.type(name, '未保存草稿');
  await user.click(screen.getByRole('button', { name: '保存', exact: true }));
  await user.click(
    await screen.findByRole('button', { name: '重新加载', exact: true }),
  );
  const dialog = screen.getByRole('alertdialog');
  expect(
    within(dialog).getByText('重新加载最新配置将放弃当前未保存的修改。'),
  ).toBeVisible();
  latest = true;
  await user.click(
    within(dialog).getByRole('button', { name: '重新加载', exact: true }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText('名称 *')).toHaveValue('服务器最新部门'),
  );
});
