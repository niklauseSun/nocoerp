import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  render,
  screen,
  within,
  waitFor,
  cleanup,
  act,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi, it, expect, beforeEach, afterEach } from 'vitest';
import { ApiClientError } from '@nocobase/app-client';
import zh from '../../client/locales/zh-CN.js';
import Users from '../../client/pages/organization/users/index.js';
import NewEmployee from '../../client/pages/organization/users/new.js';
import EditEmployee from '../../client/pages/organization/users/edit.js';
import ResetPassword from '../../client/pages/organization/users/reset-password.js';
const { api, state, toast } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  state: { permissions: new Set<string>(), users: [] as any[] },
  toast: { show: vi.fn() },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useNavigationGuard: vi.fn(),
  useToaster: () => toast,
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ session: { user: { id: 'admin' } } }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationRevision: () => 0,
  useCan: ({ resource, action }: any) => ({
    can: resource.type === 'settings' || state.permissions.has(action),
    isPending: false,
  }),
}));
const runtime = await createTestI18nRuntime({
  locale: 'zh-CN',
  application: { namespace: 'nocoerp', resources: zh },
});
const options = {
  data: {
    roleScopes: [
      {
        key: 'app',
        label: '岗位',
        labelI18nKey: 'page.roles',
        labelI18nNs: 'TEST-missing-plugin-namespace',
        selection: 'multiple',
        requiredOnCreate: true,
        options: [
          { value: 'finance', label: '财务岗位' },
          { value: 'root', label: '受保护管理员', assignable: false },
        ],
      },
    ],
  },
};
const account = {
  id: 'u1',
  name: '测试员工甲',
  email: 'one@example.test',
  username: 'staffone',
  emailVerified: false,
  disabledAt: null,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  roleScopes: { app: ['finance'] },
};
function mount(path = '/organization/users') {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <TestI18nProvider runtime={runtime}>
      <QueryClientProvider client={cache}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path='/organization/users' element={<Users />}>
              <Route path='new' element={<NewEmployee />} />
              <Route path='edit/:userId' element={<EditEmployee />} />
              <Route path='resetPassword/:userId' element={<ResetPassword />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </TestI18nProvider>,
  );
  return cache;
}
beforeEach(() => {
  state.permissions = new Set([
    'read',
    'create',
    'assign-role',
    'update',
    'disable',
    'enable',
    'reset-password',
  ]);
  state.users = [{ ...account }];
  toast.show.mockReset();
  api.request.mockReset();
  api.request.mockImplementation(({ path, method, query, json }: any) => {
    if (!method && path === 'users/options') return Promise.resolve(options);
    if (!method && path === 'users') {
      const filtered = state.users.filter((u) =>
        (u.name + ' ' + u.email).includes(query?.q ?? ''),
      );
      return Promise.resolve({
        data: filtered,
        meta: { page: query?.page ?? 1, pageSize: 20, total: filtered.length },
      });
    }
    if (path === 'users' && method === 'POST') {
      const created = {
        ...account,
        id: 'new',
        name: json.name,
        email: json.email,
        username: json.username,
        roleScopes: json.roleScopes ?? {},
      };
      state.users.push(created);
      return Promise.resolve({ data: created });
    }
    if (method === 'PATCH') {
      const u = state.users.find((u) => path === 'users/' + u.id);
      Object.assign(u, json);
      return Promise.resolve({ data: { ...u } });
    }
    if (path.endsWith('/disable') || path.endsWith('/enable')) {
      const u = state.users.find((u) => path.startsWith('users/' + u.id + '/'));
      u.disabledAt = path.endsWith('/disable') ? '2026-10-20' : null;
      return Promise.resolve({ data: { ...u } });
    }
    if (path.endsWith('/resetPassword')) return Promise.resolve(undefined);
    return Promise.reject(new Error('Unexpected test API path ' + path));
  });
});
afterEach(cleanup);
it('creates an employee using a modal and only assignable roles', async () => {
  const user = userEvent.setup();
  mount();
  await user.click(await screen.findByRole('button', { name: '新增员工' }));
  const dialog = await screen.findByRole('dialog', { name: '新增员工' });
  await within(dialog).findByLabelText('员工姓名 *');
  expect(within(dialog).queryByText('受保护管理员')).toBeNull();
  expect(within(dialog).getByText(/^用户角色/)).toBeVisible();
  expect(within(dialog).queryByText('page.roles')).toBeNull();
  await user.type(within(dialog).getByLabelText('员工姓名 *'), '新员工');
  await user.type(within(dialog).getByLabelText('邮箱 *'), 'new@example.test');
  await user.type(
    within(dialog).getByLabelText('初始密码 *'),
    'Ui-only-test-123!',
  );
  await user.type(
    within(dialog).getByLabelText('确认密码 *'),
    'Ui-only-test-123!',
  );
  await user.click(within(dialog).getByRole('checkbox', { name: '财务岗位' }));
  await user.click(
    within(dialog).getByRole('button', { name: '创建', exact: true }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(api.request).toHaveBeenCalledWith({
    path: 'users',
    method: 'POST',
    json: {
      name: '新员工',
      email: 'new@example.test',
      password: 'Ui-only-test-123!',
      roleScopes: { app: ['finance'] },
    },
  });
  expect(await screen.findByText('新员工', { selector: 'span' })).toBeVisible();
  expect(JSON.stringify(toast.show.mock.calls)).not.toContain(
    'Ui-only-test-123!',
  );
});
it('validates identity, required role and matching passwords before create', async () => {
  const user = userEvent.setup();
  mount('/organization/users/new');
  const dialog = await screen.findByRole('dialog', { name: '新增员工' });
  await within(dialog).findByLabelText('员工姓名 *');
  await user.click(
    within(dialog).getByRole('button', { name: '创建', exact: true }),
  );
  expect(within(dialog).getByText('请输入员工姓名。')).toBeVisible();
  expect(within(dialog).getByLabelText('员工姓名 *')).toHaveFocus();
  expect(api.request.mock.calls.some(([r]) => r.method)).toBe(false);
});
it('edits the correct employee without changing roles or passwords and preserves directory search', async () => {
  const user = userEvent.setup();
  mount('/organization/users?userQ=测试');
  await user.click(
    await screen.findByRole('button', { name: '测试员工甲的操作' }),
  );
  await user.click(
    await screen.findByRole('menuitem', { name: '编辑', exact: true }),
  );
  const dialog = await screen.findByRole('dialog', { name: '编辑员工' });
  const name = await within(dialog).findByLabelText('员工姓名 *');
  expect(name).toHaveValue('测试员工甲');
  expect(within(dialog).queryByLabelText('初始密码 *')).toBeNull();
  await user.clear(name);
  await user.type(name, '测试新姓名');
  await user.click(
    within(dialog).getByRole('button', { name: '保存', exact: true }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(api.request).toHaveBeenCalledWith({
    path: 'users/u1',
    method: 'PATCH',
    json: {
      name: '测试新姓名',
      email: 'one@example.test',
      username: 'staffone',
    },
  });
  expect(screen.getByPlaceholderText('按姓名或邮箱搜索用户')).toHaveValue(
    '测试',
  );
  expect(
    await screen.findByText('测试新姓名', { selector: 'span' }),
  ).toBeVisible();
});
it('requires named disable confirmation and offers enable afterwards', async () => {
  const user = userEvent.setup();
  mount();
  await user.click(
    await screen.findByRole('button', { name: '测试员工甲的操作' }),
  );
  await user.click(
    await screen.findByRole('menuitem', { name: '停用', exact: true }),
  );
  const confirm = await screen.findByRole('alertdialog');
  expect(within(confirm).getByRole('heading')).toHaveTextContent('测试员工甲');
  expect(api.request.mock.calls.some(([r]) => r.method)).toBe(false);
  await user.click(
    within(confirm).getByRole('button', { name: '停用', exact: true }),
  );
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(api.request).toHaveBeenCalledWith({
    path: 'users/u1/disable',
    method: 'POST',
  });
  await user.click(screen.getByRole('button', { name: '测试员工甲的操作' }));
  await user.click(
    await screen.findByRole('menuitem', { name: '启用', exact: true }),
  );
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: '启用',
      exact: true,
    }),
  );
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(api.request).toHaveBeenCalledWith({
    path: 'users/u1/enable',
    method: 'POST',
  });
});
it('shows protected-role refusal inside the status confirmation', async () => {
  const user = userEvent.setup();
  const original = api.request.getMockImplementation()!;
  api.request.mockImplementation((args) =>
    args.method
      ? Promise.reject(
          new ApiClientError('protected', {
            status: 400,
            reason: 'LAST_ASSIGNMENT',
          }),
        )
      : original(args),
  );
  mount();
  await user.click(
    await screen.findByRole('button', { name: '测试员工甲的操作' }),
  );
  await user.click(
    await screen.findByRole('menuitem', { name: '停用', exact: true }),
  );
  const confirm = await screen.findByRole('alertdialog');
  await user.click(
    within(confirm).getByRole('button', { name: '停用', exact: true }),
  );
  expect(await within(confirm).findByRole('alert')).toHaveTextContent(
    '最后一名有效成员',
  );
  expect(screen.getByRole('alertdialog')).toBeVisible();
});
it('resets password only through its route form and does not reveal it in feedback', async () => {
  const user = userEvent.setup();
  mount();
  await user.click(
    await screen.findByRole('button', { name: '测试员工甲的操作' }),
  );
  await user.click(
    await screen.findByRole('menuitem', { name: '重置密码', exact: true }),
  );
  const dialog = await screen.findByRole('dialog', { name: '重置员工密码' });
  await within(dialog).findByLabelText('新密码 *');
  await user.type(
    within(dialog).getByLabelText('新密码 *'),
    'New-test-secret-123!',
  );
  await user.type(
    within(dialog).getByLabelText('确认密码 *'),
    'New-test-secret-123!',
  );
  await user.click(
    within(dialog).getByRole('button', { name: '重置密码', exact: true }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(api.request).toHaveBeenCalledWith({
    path: 'users/u1/resetPassword',
    method: 'POST',
    json: { password: 'New-test-secret-123!' },
  });
  expect(JSON.stringify(toast.show.mock.calls)).not.toContain(
    'New-test-secret',
  );
});
it('hides unauthorized actions and rejects direct protected form routes', async () => {
  state.permissions = new Set(['read']);
  const user = userEvent.setup();
  mount('/organization/users/edit/u1');
  const dialog = await screen.findByRole('dialog', { name: '编辑员工' });
  expect(within(dialog).getByText('你没有此分区的访问权限。')).toBeVisible();
  expect(
    within(dialog).queryByRole('button', { name: '保存', exact: true }),
  ).toBeNull();
  await user.click(
    within(dialog).getByRole('button', { name: '取消', exact: true }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.queryByRole('button', { name: '新增员工' })).toBeNull();
  expect(screen.queryByRole('button', { name: '测试员工甲的操作' })).toBeNull();
});
it('does not create without assign-role and shows one create button on the true empty state', async () => {
  state.users = [];
  mount();
  expect(await screen.findByText('暂无用户。')).toBeVisible();
  expect(screen.getAllByRole('button', { name: '新增员工' })).toHaveLength(1);
});
it('keeps a failed edit draft and warns before discarding it', async () => {
  const original = api.request.getMockImplementation()!;
  api.request.mockImplementation((args) =>
    args.method
      ? Promise.reject(
          new ApiClientError('duplicate', {
            status: 409,
            reason: 'USER_IDENTITY_CONFLICT',
          }),
        )
      : original(args),
  );
  const user = userEvent.setup();
  mount('/organization/users/edit/u1');
  const dialog = await screen.findByRole('dialog', { name: '编辑员工' });
  const name = await within(dialog).findByLabelText('员工姓名 *');
  await user.clear(name);
  await user.type(name, '保留草稿');
  await user.click(
    within(dialog).getByRole('button', { name: '保存', exact: true }),
  );
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    '已被使用',
  );
  expect(name).toHaveValue('保留草稿');
  await user.click(
    within(dialog).getByRole('button', { name: '取消', exact: true }),
  );
  const confirm = await screen.findByRole('alertdialog');
  await user.click(within(confirm).getByRole('button', { name: '放弃修改' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
it('never edits another employee when the target is outside the current filtered page', async () => {
  mount('/organization/users/edit/other?userQ=测试');
  const dialog = await screen.findByRole('dialog', { name: '编辑员工' });
  expect(
    await within(dialog).findByText('当前列表中未找到该员工'),
  ).toBeVisible();
  expect(
    within(dialog).queryByRole('button', { name: '保存', exact: true }),
  ).toBeNull();
  expect(api.request.mock.calls.some(([r]) => r.method)).toBe(false);
});

it('requires both create and assign-role for employee creation', async () => {
  state.permissions = new Set(['read', 'create']);
  mount('/organization/users/new');
  const dialog = await screen.findByRole('dialog', { name: '新增员工' });
  expect(within(dialog).getByText('你没有此分区的访问权限。')).toBeVisible();
  expect(
    within(dialog).queryByRole('button', { name: '创建', exact: true }),
  ).toBeNull();
  expect(api.request.mock.calls.some(([r]) => r.method)).toBe(false);
});
it('offers only password reset when other row actions are not granted', async () => {
  state.permissions = new Set(['read', 'reset-password']);
  const user = userEvent.setup();
  mount();
  await user.click(
    await screen.findByRole('button', { name: '测试员工甲的操作' }),
  );
  expect(
    screen.getByRole('menuitem', { name: '重置密码', exact: true }),
  ).toBeVisible();
  expect(
    screen.queryByRole('menuitem', { name: '编辑', exact: true }),
  ).toBeNull();
  expect(
    screen.queryByRole('menuitem', { name: '停用', exact: true }),
  ).toBeNull();
});
it('blocks repeated reset submissions and closing while the password request is pending', async () => {
  const user = userEvent.setup();
  let finish: (() => void) | undefined;
  const original = api.request.getMockImplementation()!;
  api.request.mockImplementation((args) =>
    args.path.endsWith('/resetPassword')
      ? new Promise<void>((resolve) => {
          finish = resolve;
        })
      : original(args),
  );
  mount('/organization/users/resetPassword/u1');
  const dialog = await screen.findByRole('dialog', { name: '重置员工密码' });
  await within(dialog).findByLabelText('新密码 *');
  await user.type(
    within(dialog).getByLabelText('新密码 *'),
    'Test-pending-123!',
  );
  await user.type(
    within(dialog).getByLabelText('确认密码 *'),
    'Test-pending-123!',
  );
  await user.dblClick(
    within(dialog).getByRole('button', { name: '重置密码', exact: true }),
  );
  expect(
    api.request.mock.calls.filter(([r]) => r.method === 'POST'),
  ).toHaveLength(1);
  expect(
    within(dialog).getByRole('button', { name: '取消', exact: true }),
  ).toBeDisabled();
  await user.keyboard('{Escape}');
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(screen.queryByRole('alertdialog')).toBeNull();
  await act(async () => {
    finish!();
  });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('maps server password policy errors inline and focuses the password input', async () => {
  const original = api.request.getMockImplementation()!;
  api.request.mockImplementation((args) =>
    args.path.endsWith('/resetPassword')
      ? Promise.reject(
          new ApiClientError('short', {
            status: 400,
            reason: 'PASSWORD_TOO_SHORT',
          }),
        )
      : original(args),
  );
  const user = userEvent.setup();
  mount('/organization/users/resetPassword/u1');
  const dialog = await screen.findByRole('dialog', { name: '重置员工密码' });
  const password = await within(dialog).findByLabelText('新密码 *');
  await user.type(password, 'short');
  await user.type(within(dialog).getByLabelText('确认密码 *'), 'short');
  await user.click(
    within(dialog).getByRole('button', { name: '重置密码', exact: true }),
  );
  await waitFor(() => expect(password).toHaveAttribute('aria-invalid', 'true'));
  await waitFor(() => expect(password).toHaveFocus());
  expect(password).toHaveValue('short');
  expect(password).toHaveAttribute('aria-describedby', 'staff-error-password');
});
it('refreshes the directory and removes submission after a target 404 without losing the draft', async () => {
  const original = api.request.getMockImplementation()!;
  api.request.mockImplementation((args) =>
    args.method
      ? Promise.reject(
          new ApiClientError('missing', {
            status: 404,
            reason: 'USER_NOT_FOUND',
          }),
        )
      : original(args),
  );
  const user = userEvent.setup();
  mount('/organization/users/edit/u1');
  const dialog = await screen.findByRole('dialog', { name: '编辑员工' });
  const name = await within(dialog).findByLabelText('员工姓名 *');
  await user.clear(name);
  await user.type(name, '丢失目标的草稿');
  const reads = api.request.mock.calls.filter(
    ([r]) => r.path === 'users',
  ).length;
  await user.click(
    within(dialog).getByRole('button', { name: '保存', exact: true }),
  );
  await waitFor(() =>
    expect(
      within(dialog).queryByRole('button', { name: '保存', exact: true }),
    ).toBeNull(),
  );
  expect(name).toHaveValue('丢失目标的草稿');
  expect(
    api.request.mock.calls.filter(([r]) => r.path === 'users').length,
  ).toBeGreaterThan(reads);
});
