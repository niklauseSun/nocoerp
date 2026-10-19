import en from '../../client/locales/en-US.js';
import Home from '../../client/pages/home/index.js';
vi.mock('../../client/hooks/use-mobile.js', () => ({
  useIsMobile: () => true,
}));
import {
  render,
  screen,
  cleanup,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  TestI18nProvider,
  createTestI18nRuntime,
} from '@nocobase/i18n/testing';
import { ApiClientError } from '@nocobase/app-client';
import zh from '../../client/locales/zh-CN.js';
import Workbench from '../../client/pages/workbench/index.js';
import TodoDetail from '../../client/pages/messages/detail.js';
const { api, state } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  state: { actor: 'a', revision: 0, denied: [] as string[], pending: false },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => ({ show: vi.fn() }),
  useNavigationGuard: vi.fn(),
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ session: { user: { id: state.actor } } }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useCan: ({ resource }: any) => ({
    can: !state.denied.includes(resource.id),
    isPending: state.pending,
  }),
  useAuthorizationRevision: () => state.revision,
}));
const runtime = await createTestI18nRuntime({
  locale: 'zh-CN',
  application: { namespace: 'nocoerp', resources: zh },
});
function mount(path = '/workbench', localeRuntime = runtime) {
  return render(
    <TestI18nProvider runtime={localeRuntime}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path='/' element={<Home />} />
            <Route path='/workbench' element={<Workbench />}>
              <Route path='todos/:messageTodoId' element={<TodoDetail />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </TestI18nProvider>,
  );
}
const todo = {
  id: 't',
  number: 'HT001',
  title: '演示合同',
  deliveryStatus: 'pending',
  generation: 1,
  createdAt: '2026-10-20T00:00:00Z',
  updatedAt: '2026-10-20T00:00:00Z',
  reason: 'contractExpiry',
  kind: 'contracts',
  status: 'active',
  dueOn: '2026-10-20',
  path: '/contracts/c',
};
beforeEach(() => {
  state.actor = 'a';
  state.revision = 0;
  state.denied = [];
  state.pending = false;
  api.request.mockReset();
  api.request.mockImplementation(({ path }: any) =>
    Promise.resolve(
      path === 'messageTodos/t'
        ? { data: todo }
        : {
            data: path === 'messageTodos' ? [todo] : [],
            meta: { total: path === 'messageTodos' ? 9 : 0 },
          },
    ),
  );
});
afterEach(cleanup);
it('shows bounded real data and all authorized original feature destinations', async () => {
  mount();
  expect(await screen.findByText('共 9 条')).toBeVisible();
  const nav = screen.getByRole('navigation', { name: '常用功能' });
  expect(within(nav).getByRole('button', { name: '水电抄表' })).toHaveAttribute(
    'href',
    '/energy/readings',
  );
  expect(within(nav).getAllByRole('button')).toHaveLength(6);
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'messageTodos',
      query: expect.objectContaining({ pageSize: 5, status: 'active' }),
    }),
  );
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'approvalRequests',
      query: expect.objectContaining({ view: 'pending', pageSize: 5 }),
    }),
  );
});
it('requires both existing page and business permission and never reads denied approval data', async () => {
  state.denied = ['hyl-approvals', 'hyl.repairs', 'hyl-energy'];
  mount();
  expect(
    await screen.findByText(
      '当前账号没有审批查看权限，请联系管理员按岗位授权。',
    ),
  ).toBeVisible();
  const nav = screen.getByRole('navigation', { name: '常用功能' });
  expect(
    within(nav).queryByRole('button', { name: '审批', exact: true }),
  ).not.toBeInTheDocument();
  expect(
    within(nav).queryByRole('button', { name: '工单报修' }),
  ).not.toBeInTheDocument();
  expect(
    within(nav).queryByRole('button', { name: '水电抄表' }),
  ).not.toBeInTheDocument();
  expect(
    api.request.mock.calls.some(([x]) => x.path === 'approvalRequests'),
  ).toBe(false);
});
it('does not show fake totals while loading or retry forbidden responses', async () => {
  api.request.mockImplementation(() => new Promise(() => {}));
  const view = mount();
  expect(screen.getAllByRole('status', { name: '加载中' })).toHaveLength(2);
  expect(screen.queryByText(/共 \d+ 条/)).not.toBeInTheDocument();
  view.unmount();
  api.request.mockRejectedValue(new ApiClientError('denied', { status: 403 }));
  mount();
  expect(await screen.findAllByRole('alert')).toHaveLength(2);
  expect(
    screen.queryByRole('button', { name: '重试' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText('共 0 条')).not.toBeInTheDocument();
});
it('opens todo over workbench and returns to the same workbench URL', async () => {
  const user = userEvent.setup();
  mount('/workbench?retained=1');
  await user.click(
    await screen.findByRole('link', { name: 'HT001 · 演示合同' }),
  );
  const back = await screen.findByRole('link', { name: '返回' });
  expect(back).toHaveAttribute('href', '/workbench?retained=1');
  await user.click(back);
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: '手机工作台' })).toBeVisible(),
  );
});

it('lands on the phone workbench without requesting desktop dashboard data', async () => {
  mount('/');
  expect(
    await screen.findByRole('heading', { name: '手机工作台' }),
  ).toBeVisible();
  expect(
    api.request.mock.calls.some(([x]) => x.path.includes('dashboard')),
  ).toBe(false);
});

it('renders English workbench copy with real counts', async () => {
  const english = await createTestI18nRuntime({
    locale: 'en-US',
    application: { namespace: 'nocoerp', resources: en },
  });
  mount('/workbench', english);
  expect(
    await screen.findByRole('heading', { name: 'Mobile workbench' }),
  ).toBeVisible();
  expect(await screen.findByText('9 total')).toBeVisible();
});
it('hides protected entries and requests while authorization is pending', async () => {
  state.pending = true;
  mount();
  expect(await screen.findByText('共 9 条')).toBeVisible();
  expect(screen.getByRole('status', { name: '加载中' })).toBeVisible();
  expect(
    within(screen.getByRole('navigation', { name: '常用功能' })).getAllByRole(
      'button',
    ),
  ).toHaveLength(2);
  expect(
    api.request.mock.calls.some(([x]) => x.path === 'approvalRequests'),
  ).toBe(false);
  expect(
    screen.queryByText('当前账号没有审批查看权限，请联系管理员按岗位授权。'),
  ).not.toBeInTheDocument();
});
