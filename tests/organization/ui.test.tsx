import en from '../../client/locales/en-US.js';
import { useOrg } from '../../client/pages/organization/hooks.js';
import { ErrorBox } from '../../client/pages/organization/common.js';
import Users from '../../client/pages/organization/users/index.js';
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
import NewMember from '../../client/pages/organization/new-member.js';
import EditDepartment from '../../client/pages/organization/edit-department.js';
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
              <Route path='members/new' element={<NewMember />} />
              <Route path='edit/:departmentId' element={<EditDepartment />} />
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
  expect(await screen.findByRole('link', { name: /演示部门/ })).toBeVisible();
  expect(
    screen.queryByRole('button', { name: '保存', exact: true }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: '添加成员' }),
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
  mount(<Departments />, '/organization/departments/edit/d');
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
  const user = userEvent.setup();
  mount(<Departments />);
  await user.click(await screen.findByRole('button', { name: '添加成员' }));
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
    await screen.findByRole('button', { name: '演示用户的操作' }),
  );
  await user.click(
    await screen.findByRole('menuitem', { name: '移除', exact: true }),
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
  mount(<Departments />, '/organization/departments/edit/d');
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
  mount(<Departments />, '/organization/departments/edit/d');
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

it('renders collapsible department hierarchy and keeps ancestors visible during search', async () => {
  const user = userEvent.setup();
  const root = { ...department, id: 'root', title: '测试中心' };
  const child = {
    ...department,
    id: 'finance',
    title: '财务部',
    parentId: 'root',
  };
  const other = {
    ...department,
    id: 'operations',
    title: '运营部',
    parentId: 'root',
  };
  api.request.mockImplementation(({ path }: any) =>
    Promise.resolve(
      path === 'organization'
        ? {
            data: { ...snapshot.data, departments: [root, child, other] },
          }
        : options,
    ),
  );
  mount(<Departments />);
  const nav = await screen.findByRole('navigation', { name: '组织架构' });
  expect(within(nav).getByRole('link', { name: /财务部/ })).toBeVisible();
  await user.click(within(nav).getByRole('button', { name: '收起 测试中心' }));
  expect(within(nav).queryByRole('link', { name: /财务部/ })).toBeNull();
  await user.type(screen.getByPlaceholderText('按部门名称搜索'), '财务');
  expect(within(nav).getByRole('link', { name: /测试中心/ })).toBeVisible();
  await waitFor(() =>
    expect(within(nav).getByRole('link', { name: /财务部/ })).toBeVisible(),
  );
  expect(within(nav).queryByRole('link', { name: /运营部/ })).toBeNull();
  await user.click(within(nav).getByRole('link', { name: /财务部/ }));
  expect(within(nav).getByRole('link', { name: /财务部/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

it('shows only direct employees in the selected department and separates available accounts', async () => {
  const user = userEvent.setup();
  const second = { ...department, id: 'second', title: '第二部门' };
  api.request.mockImplementation(({ path }: any) =>
    Promise.resolve(
      path === 'organization'
        ? {
            data: {
              ...snapshot.data,
              departments: [department, second],
              members: [
                {
                  id: 'm',
                  departmentId: 'd',
                  userId: 'u',
                  active: true,
                  primary: true,
                },
                {
                  id: 'm2',
                  departmentId: 'second',
                  userId: 'u2',
                  active: true,
                  primary: false,
                },
              ],
              names: { u: '测试财务', u2: '测试运营' },
              memberProfiles: {
                u: { email: 'finance@example.test', disabledAt: null },
                u2: { email: 'ops@example.test', disabledAt: '2026-10-20' },
              },
            },
          }
        : options,
    ),
  );
  mount(<Departments />);
  const table = await screen.findByRole('table', {
    name: '演示部门 · 员工列表',
  });
  expect(within(table).getByText('finance@example.test')).toBeVisible();
  expect(within(table).queryByText('测试运营')).toBeNull();
  await user.type(
    screen.getByPlaceholderText('按员工姓名或邮箱搜索'),
    'missing',
  );
  await waitFor(() =>
    expect(within(table).queryByText('finance@example.test')).toBeNull(),
  );
  expect(within(table).getByText('没有匹配结果')).toBeVisible();
  await user.clear(screen.getByPlaceholderText('按员工姓名或邮箱搜索'));
  await waitFor(() =>
    expect(within(table).getByText('finance@example.test')).toBeVisible(),
  );

  expect(screen.queryByRole('dialog', { name: '添加成员' })).toBeNull();
  await user.click(screen.getByRole('button', { name: '添加成员' }));
  expect(screen.getByRole('combobox', { name: '用户' })).toBeVisible();
  expect(screen.getByRole('dialog', { name: '添加成员' })).toBeVisible();
  await user.click(
    within(screen.getByRole('dialog', { name: '添加成员' })).getByRole(
      'button',
      { name: '取消' },
    ),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const nav = screen.getByRole('navigation', { name: '组织架构' });
  await user.click(within(nav).getByRole('link', { name: /第二部门/ }));
  const next = await screen.findByRole('table', {
    name: '第二部门 · 员工列表',
  });
  expect(within(next).getByText('ops@example.test')).toBeVisible();
  expect(within(next).getByText('已停用')).toBeVisible();
  expect(within(next).queryByText('测试财务')).toBeNull();
  expect(screen.queryByRole('dialog', { name: '添加成员' })).toBeNull();
});

it('discards a pending member removal when navigating to another department and back', async () => {
  const user = userEvent.setup();
  api.request.mockImplementation(({ path }: any) =>
    Promise.resolve(
      path === 'organization'
        ? {
            data: {
              ...snapshot.data,
              departments: [
                department,
                { ...department, id: 'second', title: '第二部门' },
              ],
              members: [
                {
                  id: 'm',
                  departmentId: 'd',
                  userId: 'u',
                  active: true,
                  primary: true,
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
    await screen.findByRole('button', { name: '演示用户的操作' }),
  );
  await user.click(await screen.findByRole('menuitem', { name: '移除' }));
  expect(screen.getByRole('alertdialog')).toBeVisible();
  // A URL/history change can happen while a confirmation is open; bypass its pointer shield to exercise that navigation.
  fireEvent.click(screen.getByRole('link', { name: /第二部门/, hidden: true }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  fireEvent.click(screen.getByRole('link', { name: /演示部门/ }));
  await screen.findByRole('table', { name: '演示部门 · 员工列表' });
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(api.request.mock.calls.some(([args]) => args.method === 'PUT')).toBe(
    false,
  );
});

it('paginates a department roster and returns to the first page after employee search', async () => {
  const user = userEvent.setup();
  const members = Array.from({ length: 12 }, (_, index) => ({
    id: 'm' + index,
    userId: 'u' + index,
    departmentId: 'd',
    active: true,
    primary: true,
  }));
  api.request.mockImplementation(({ path }: any) =>
    Promise.resolve(
      path === 'organization'
        ? {
            data: {
              ...snapshot.data,
              members,
              names: Object.fromEntries(
                members.map((m, i) => [
                  m.userId,
                  '员工' + String(i).padStart(2, '0'),
                ]),
              ),
              memberProfiles: Object.fromEntries(
                members.map((m, i) => [
                  m.userId,
                  { email: 'staff' + i + '@example.test', disabledAt: null },
                ]),
              ),
            },
          }
        : options,
    ),
  );
  mount(<Departments />);
  const table = await screen.findByRole('table', {
    name: '演示部门 · 员工列表',
  });
  expect(within(table).getByText('员工00')).toBeVisible();
  expect(within(table).queryByText('员工11')).toBeNull();
  await user.click(
    within(table.parentElement!.parentElement!).getByRole('button', {
      name: '下一页',
    }),
  );
  expect(within(table).getByText('员工11')).toBeVisible();
  await user.type(
    screen.getByPlaceholderText('按员工姓名或邮箱搜索'),
    'staff0@',
  );
  await waitFor(() => expect(within(table).getByText('员工00')).toBeVisible());
  expect(within(table).queryByText('员工11')).toBeNull();
});

it('adds an employee through the add button and closes the form on successful save', async () => {
  const user = userEvent.setup();
  mount(<Departments />);
  await user.click(await screen.findByRole('button', { name: '添加成员' }));
  const panel = screen.getByRole('dialog', { name: '添加成员' });
  expect(
    within(panel).getByRole('button', { name: '添加', exact: true }),
  ).toBeDisabled();
  await user.click(within(panel).getByRole('combobox', { name: '用户' }));
  await user.click(
    await screen.findByRole('option', { name: '演示用户 · demo@example.test' }),
  );
  await user.click(within(panel).getByRole('checkbox', { name: '主部门' }));
  await user.click(
    within(panel).getByRole('button', { name: '添加', exact: true }),
  );
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'organization/departments/d/members',
        method: 'PUT',
        json: { userId: 'u', active: true, primary: true },
      }),
    ),
  );
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: '添加成员' })).toBeNull(),
  );
});

it('updates primary department directly from the employee actions menu', async () => {
  const user = userEvent.setup();
  api.request.mockImplementation(({ path, method }: any) =>
    Promise.resolve(
      method
        ? { data: {} }
        : path === 'organization'
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
    await screen.findByRole('button', { name: '演示用户的操作' }),
  );
  await user.click(await screen.findByRole('menuitem', { name: '设为主部门' }));
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'organization/departments/d/members',
        method: 'PUT',
        json: { userId: 'u', active: true, primary: true },
      }),
    ),
  );
  expect(screen.queryByRole('dialog', { name: '添加成员' })).toBeNull();
});

it('keeps member drafts on a rejected save and guards closing unsaved selections', async () => {
  const user = userEvent.setup();
  api.request.mockImplementation(({ path, method }: any) =>
    method
      ? Promise.reject(
          new ApiClientError('stale', { status: 409, reason: 'ORG_STALE' }),
        )
      : Promise.resolve(path === 'organization' ? snapshot : options),
  );
  mount(<Departments />, '/organization/departments/members/new?department=d');
  const dialog = await screen.findByRole('dialog', { name: '添加成员' });
  await user.click(within(dialog).getByRole('combobox', { name: '用户' }));
  await user.click(
    await screen.findByRole('option', { name: '演示用户 · demo@example.test' }),
  );
  await user.click(
    within(dialog).getByRole('button', { name: '添加', exact: true }),
  );
  expect(await within(dialog).findByRole('alert')).toBeVisible();
  expect(
    within(dialog).getByRole('combobox', { name: '用户' }),
  ).toHaveTextContent('演示用户');
  await user.click(within(dialog).getByRole('button', { name: '取消' }));
  const confirmation = await screen.findByRole('alertdialog');
  await user.click(
    within(confirmation).getByRole('button', { name: '放弃修改' }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('preserves selected account across picker pages and returns to the same filtered department', async () => {
  const user = userEvent.setup();
  api.request.mockImplementation(({ path, query, method }: any) =>
    Promise.resolve(
      method
        ? { data: {} }
        : path === 'organization'
          ? snapshot
          : {
              data: {
                ...options.data,
                userTotal: 21,
                users:
                  query?.page === 2
                    ? [
                        {
                          id: 'u2',
                          name: '其他账号',
                          email: 'other@example.test',
                          disabledAt: null,
                        },
                      ]
                    : options.data.users,
              },
            },
    ),
  );
  mount(
    <Departments />,
    '/organization/departments/members/new?department=d&employeeQ=keep&departmentQ=演示',
  );
  const dialog = await screen.findByRole('dialog', { name: '添加成员' });
  await user.click(within(dialog).getByRole('combobox', { name: '用户' }));
  await user.click(
    await screen.findByRole('option', { name: '演示用户 · demo@example.test' }),
  );
  await user.click(within(dialog).getByRole('button', { name: '下一页' }));
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'organization/options',
        query: expect.objectContaining({ page: 2 }),
      }),
    ),
  );
  expect(
    within(dialog).getByRole('combobox', { name: '用户' }),
  ).toHaveTextContent('演示用户');
  await user.click(
    within(dialog).getByRole('button', { name: '添加', exact: true }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const link = within(
    screen.getByRole('navigation', { name: '组织架构' }),
  ).getByRole('link', { name: /演示部门/ });
  const target = new URL(link.getAttribute('href')!, 'http://localhost');
  expect(target.pathname).toBe('/organization/departments');
  expect(target.searchParams.get('department')).toBe('d');
  expect(target.searchParams.get('employeeQ')).toBe('keep');
  expect(target.searchParams.get('departmentQ')).toBe('演示');
});

it('refuses a member dialog without an explicit department instead of adding to the first department', async () => {
  mount(<Departments />, '/organization/departments/members/new');
  const dialog = await screen.findByRole('dialog', { name: '添加成员' });
  expect(
    await within(dialog).findByText('请返回列表，选择要添加成员的部门。'),
  ).toBeVisible();
  expect(
    within(dialog).getByRole('button', { name: '添加', exact: true }),
  ).toBeDisabled();
  expect(api.request).not.toHaveBeenCalledWith(
    expect.objectContaining({ path: 'organization/options' }),
  );
});

it('denies read-only users entering the add-member route without loading account options', async () => {
  state.can = false;
  mount(<Departments />, '/organization/departments/members/new?department=d');
  const dialog = await screen.findByRole('dialog', { name: '添加成员' });
  expect(within(dialog).getByText('你没有此分区的访问权限。')).toBeVisible();
  expect(
    within(dialog).getByRole('button', { name: '添加', exact: true }),
  ).toBeDisabled();
  expect(api.request).not.toHaveBeenCalledWith(
    expect.objectContaining({ path: 'organization/options' }),
  );
});

it('opens edit from any tree node, saves that target and preserves the selected department and filters', async () => {
  const user = userEvent.setup();
  let child = {
    ...department,
    id: 'child',
    title: '财务部门',
    parentId: 'd',
    version: 7,
  };
  api.request.mockImplementation(({ path, method, json }: any) => {
    if (method) {
      child = { ...child, ...json, version: 8 };
      return Promise.resolve({ data: child });
    }
    return Promise.resolve(
      path === 'organization'
        ? { data: { ...snapshot.data, departments: [department, child] } }
        : options,
    );
  });
  mount(
    <Departments />,
    '/organization/departments?department=d&employeeQ=keep&departmentQ=部门',
  );
  const nav = await screen.findByRole('navigation', { name: '组织架构' });
  expect(screen.queryByLabelText('名称 *')).toBeNull();
  await user.click(
    within(nav).getByRole('button', { name: '财务部门的部门操作' }),
  );
  await user.click(
    await screen.findByRole('menuitem', { name: '编辑', exact: true }),
  );
  const dialog = await screen.findByRole('dialog', { name: '编辑部门' });
  const name = await within(dialog).findByLabelText('名称 *');
  expect(name).toHaveValue('财务部门');
  await user.clear(name);
  await user.type(name, '财务新部门');
  await user.click(
    within(dialog).getByRole('button', { name: '保存', exact: true }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'organization/departments/child',
      method: 'PATCH',
      json: { title: '财务新部门', parentId: 'd', active: true, version: 7 },
    }),
  );
  const selected = within(
    screen.getByRole('navigation', { name: '组织架构' }),
  ).getByRole('link', { name: /演示部门/ });
  expect(selected).toHaveAttribute('aria-current', 'page');
  const url = new URL(selected.getAttribute('href')!, 'http://localhost');
  expect(url.pathname).toBe('/organization/departments');
  expect(url.searchParams.get('department')).toBe('d');
  expect(url.searchParams.get('employeeQ')).toBe('keep');
  expect(url.searchParams.get('departmentQ')).toBe('部门');
  expect(
    within(screen.getByRole('navigation', { name: '组织架构' })).getByRole(
      'link',
      { name: /财务新部门/ },
    ),
  ).toBeVisible();
  expect(screen.queryByLabelText('名称 *')).toBeNull();
});

it.each([true, false])(
  'confirms department status changes with the original version (active=%s)',
  async (active) => {
    const user = userEvent.setup();
    api.request.mockImplementation(({ path, method }: any) =>
      Promise.resolve(
        method
          ? { data: {} }
          : path === 'organization'
            ? {
                data: {
                  ...snapshot.data,
                  departments: [{ ...department, active, version: 3 }],
                },
              }
            : options,
      ),
    );
    mount(<Departments />, '/organization/departments/edit/d?department=d');
    const dialog = await screen.findByRole('dialog', { name: '编辑部门' });
    await within(dialog).findByLabelText('名称 *');
    await user.click(
      within(dialog).getByRole('button', {
        name: active ? '停用' : '启用',
        exact: true,
      }),
    );
    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByRole('heading')).toHaveTextContent('演示部门');
    await user.click(
      within(confirm).getByRole('button', {
        name: active ? '停用' : '启用',
        exact: true,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'organization/departments/d',
        method: 'PATCH',
        json: {
          title: '演示部门',
          parentId: null,
          active: !active,
          version: 3,
        },
      }),
    );
  },
);

it('keeps edit drafts while refreshing in the background and requires confirmation before closing', async () => {
  const user = userEvent.setup();
  const { cache } = mount(
    <Departments />,
    '/organization/departments/edit/d?department=d',
  );
  const dialog = await screen.findByRole('dialog', { name: '编辑部门' });
  const name = await within(dialog).findByLabelText('名称 *');
  await user.clear(name);
  await user.type(name, '本地草稿');
  cache.setQueryData(['organization', 'a', 0, 'organization', undefined], {
    data: {
      ...snapshot.data,
      departments: [{ ...department, title: '其他人修改', version: 9 }],
    },
  });
  expect(name).toHaveValue('本地草稿');
  expect(
    within(dialog).getByRole('button', { name: '停用', exact: true }),
  ).toBeDisabled();
  await user.click(
    within(dialog).getByRole('button', { name: '取消', exact: true }),
  );
  const confirm = await screen.findByRole('alertdialog');
  await user.click(within(confirm).getByRole('button', { name: '放弃修改' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(api.request.mock.calls.some(([args]) => args.method === 'PATCH')).toBe(
    false,
  );
});

it('preserves edit drafts and their close guard when an explicit stale reload fails', async () => {
  const user = userEvent.setup();
  let failRead = false;
  api.request.mockImplementation(({ path, method }: any) => {
    if (method)
      return Promise.reject(
        new ApiClientError('stale', { status: 409, reason: 'ORG_STALE' }),
      );
    if (path === 'organization' && failRead)
      return Promise.reject(new Error('offline'));
    return Promise.resolve(path === 'organization' ? snapshot : options);
  });
  mount(<Departments />, '/organization/departments/edit/d?department=d');
  const name = await screen.findByLabelText('名称 *');
  await user.clear(name);
  await user.type(name, '保留的草稿');
  await user.click(screen.getByRole('button', { name: '保存', exact: true }));
  await user.click(
    await screen.findByRole('button', { name: '重新加载', exact: true }),
  );
  const reset = await screen.findByRole('alertdialog');
  failRead = true;
  await user.click(
    within(reset).getByRole('button', { name: '重新加载', exact: true }),
  );
  expect(await within(reset).findByRole('alert')).toBeVisible();
  expect(screen.getByLabelText('名称 *')).toHaveValue('保留的草稿');
  await user.click(
    within(reset).getByRole('button', { name: '取消', exact: true }),
  );
  await user.click(screen.getByRole('button', { name: '取消', exact: true }));
  expect(await screen.findByRole('alertdialog')).toHaveTextContent('放弃修改');
});

it('retains a dirty edit draft when a refreshed snapshot no longer contains the target', async () => {
  const user = userEvent.setup();
  const { cache } = mount(
    <Departments />,
    '/organization/departments/edit/d?department=d',
  );
  const name = await screen.findByLabelText('名称 *');
  await user.clear(name);
  await user.type(name, '已被删除的部门草稿');
  cache.setQueryData(['organization', 'a', 0, 'organization', undefined], {
    data: { ...snapshot.data, departments: [] },
  });
  await screen.findByText('该部门不存在，请关闭弹窗后重新选择。');
  expect(screen.getByLabelText('名称 *')).toHaveValue('已被删除的部门草稿');
  expect(screen.getByLabelText('名称 *')).toBeDisabled();
  expect(
    screen.queryByRole('button', { name: '保存', exact: true }),
  ).toBeNull();
  await user.click(screen.getByRole('button', { name: '取消', exact: true }));
  expect(await screen.findByRole('alertdialog')).toHaveTextContent('放弃修改');
  expect(api.request.mock.calls.some(([args]) => args.method === 'PATCH')).toBe(
    false,
  );
});

const nestedRoster = {
  ...snapshot.data,
  departments: [
    department,
    { ...department, id: 'child', parentId: 'd', title: '子部门' },
    { ...department, id: 'grandchild', parentId: 'child', title: '孙部门' },
    { ...department, id: 'outside', title: '其他组织' },
  ],
  members: [
    { id: 'm1', userId: 'u', departmentId: 'd', active: true, primary: true },
    {
      id: 'm2',
      userId: 'u',
      departmentId: 'child',
      active: true,
      primary: false,
    },
    {
      id: 'm3',
      userId: 'v',
      departmentId: 'grandchild',
      active: true,
      primary: true,
    },
    {
      id: 'm4',
      userId: 'w',
      departmentId: 'outside',
      active: true,
      primary: true,
    },
    {
      id: 'm5',
      userId: 'removed',
      departmentId: 'child',
      active: false,
      primary: false,
    },
  ],
  names: {
    u: '跨部门员工',
    v: '孙部门员工',
    w: '外部员工',
    removed: '已移除员工',
  },
  memberProfiles: {
    u: { email: 'shared@example.test', disabledAt: null },
    v: { email: 'grandchild@example.test', disabledAt: null },
  },
};
function mockNestedRoster() {
  api.request.mockImplementation(({ path, method }: any) =>
    Promise.resolve(
      method
        ? { data: {} }
        : path === 'organization'
          ? { data: nestedRoster }
          : options,
    ),
  );
}
it('counts distinct subtree employees and defaults to a deduplicated roster with direct-only filtering', async () => {
  const user = userEvent.setup();
  state.can = false;
  mockNestedRoster();
  mount(<Departments />, '/organization/departments?department=d');
  const root = await screen.findByRole('link', { name: /演示部门/ });
  expect(within(root).getByLabelText('2 名成员（含下级）')).toBeVisible();
  let table = screen.getByRole('table', { name: '演示部门 · 员工列表' });
  expect(within(table).getAllByText('跨部门员工')).toHaveLength(1);
  expect(within(table).getByText('孙部门员工')).toBeVisible();
  expect(within(table).getByText('子部门')).toBeVisible();
  expect(within(table).getByText('孙部门')).toBeVisible();
  expect(within(table).queryByText('外部员工')).toBeNull();
  expect(within(table).queryByText('已移除员工')).toBeNull();
  await user.click(screen.getByRole('switch', { name: '仅直属成员' }));
  table = screen.getByRole('table', { name: '演示部门 · 员工列表' });
  expect(within(table).getByText('跨部门员工')).toBeVisible();
  expect(within(table).queryByText('孙部门员工')).toBeNull();
  expect(within(root).getByLabelText('2 名成员（含下级）')).toBeVisible();
  await user.click(screen.getByRole('switch', { name: '仅直属成员' }));
  table = screen.getByRole('table', { name: '演示部门 · 员工列表' });
  await user.type(
    screen.getByPlaceholderText('按员工姓名或邮箱搜索'),
    'grandchild@',
  );
  expect(within(table).getByText('孙部门员工')).toBeVisible();
  await waitFor(() =>
    expect(within(table).queryByText('跨部门员工')).toBeNull(),
  );
  expect(api.request.mock.calls.some(([r]) => r.method)).toBe(false);
});
it('targets the actual child membership when acting from a parent roster', async () => {
  const user = userEvent.setup();
  mockNestedRoster();
  mount(<Departments />, '/organization/departments?department=d');
  await user.click(
    await screen.findByRole('button', { name: '跨部门员工的操作' }),
  );
  await user.click(
    await screen.findByRole('menuitem', {
      name: '设为主部门 · 子部门',
      exact: true,
    }),
  );
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'organization/departments/child/members',
        method: 'PUT',
        json: { userId: 'u', active: true, primary: true },
      }),
    ),
  );
  await user.click(screen.getByRole('button', { name: '跨部门员工的操作' }));
  await user.click(
    await screen.findByRole('menuitem', { name: '移除 · 子部门', exact: true }),
  );
  const dialog = screen.getByRole('alertdialog');
  expect(within(dialog).getByRole('heading')).toHaveTextContent('子部门');
  await user.click(
    within(dialog).getByRole('button', { name: '移除', exact: true }),
  );
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'organization/departments/child/members',
        method: 'PUT',
        json: { userId: 'u', active: false, primary: false },
      }),
    ),
  );
});
