import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import {
  render,
  within,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiClientError } from '@nocobase/app-client';
import zh from '../../client/locales/zh-CN.js';
import en from '../../client/locales/en-US.js';
import List from '../../client/pages/wecom/index.js';
import Detail from '../../client/pages/wecom/detail.js';
import New from '../../client/pages/wecom/new.js';
const { api, state } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  state: { can: true, actor: 'a', revision: 0 },
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
});
const english = await createTestI18nRuntime({
  locale: 'en-US',
  application: { namespace: 'nocoerp', resources: en },
});
const list = {
  data: {
    configuration: {
      enabled: true,
      corpId: 'corp',
      agentId: '1',
      directoryRead: true,
      directoryWrite: true,
      messages: false,
      autoSync: false,
    },
    items: [],
    total: 0,
  },
};
const preview = {
  data: {
    mapping: {
      id: 'one',
      kind: 'user',
      localId: 'local',
      remoteId: 'alice',
      localExists: true,
      remoteExists: true,
      baseline: { name: 'Before', enabled: true },
      state: 'synced',
      updatedAt: '2026-11-13T00:00:00Z',
    },
    local: { name: 'Local', enabled: true },
    remote: { name: 'Remote', enabled: true },
    suggested: 'conflict',
    fingerprint: 'a'.repeat(64),
    history: [],
  },
};
function mount(path = '/wecom', englishMode = false) {
  return render(
    <TestI18nProvider runtime={englishMode ? english : runtime}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path='/wecom' element={<List />}>
              <Route path='new' element={<New />} />
              <Route path=':id' element={<Detail />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </TestI18nProvider>,
  );
}
beforeEach(() => {
  state.can = true;
  api.request.mockReset();
  api.request.mockImplementation(async ({ path }) =>
    path === 'wecom/options'
      ? { data: { users: [], userTotal: 0, departments: [] } }
      : path === 'wecom/mappings/one'
        ? preview
        : list,
  );
});
afterEach(cleanup);
it('has one empty-state primary action, safe config status and disabled connection when unconfigured', async () => {
  mount();
  await screen.findByText('暂无同步映射');
  expect(screen.getAllByRole('button', { name: '新增同步映射' })).toHaveLength(
    1,
  );
  expect(screen.queryByDisplayValue('test-app-secret')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '检查连接' }));
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'wecom/check',
        method: 'POST',
        json: {},
      }),
    ),
  );
});
it('does not expose write actions to read-only users and supports English', async () => {
  state.can = false;
  mount('/wecom', true);
  await screen.findByText('No mappings yet');
  expect(
    screen.queryByRole('button', { name: 'New mapping' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Check connection' }),
  ).not.toBeInTheDocument();
});
it('search does not send intermediate composition and clear filters resets the URL query', async () => {
  mount();
  const input = await screen.findByPlaceholderText('搜索本地 ID、企微 ID');
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: 'zhong' } });
  await new Promise((r) => setTimeout(r, 350));
  expect(api.request.mock.calls.some(([x]) => x.query?.q === 'zhong')).toBe(
    false,
  );
  fireEvent.change(input, { target: { value: '中' } });
  fireEvent.compositionEnd(input, { data: '中' });
  await waitFor(() =>
    expect(api.request.mock.calls.some(([x]) => x.query?.q === '中')).toBe(
      true,
    ),
  );
  expect(screen.getAllByRole('button', { name: '新增同步映射' })).toHaveLength(
    1,
  );
  await userEvent.click(screen.getByRole('button', { name: '清除筛选' }));
  await waitFor(() => expect(input).toHaveValue(''));
});
it('requires a named confirmation and sends the reviewed fingerprint, retaining conflict failures', async () => {
  api.request.mockImplementation(async ({ path, method }) => {
    if (method === 'POST')
      throw new ApiClientError('changed', {
        status: 409,
        reason: 'WECOM_STALE',
      });
    return path === 'wecom/mappings/one' ? preview : list;
  });
  mount('/wecom/one?q=keep');
  await screen.findByText('资料对比');
  await userEvent.click(screen.getByRole('button', { name: '同步到系统' }));
  expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  await userEvent.click(
    screen.getAllByRole('button', { name: '同步到系统' }).at(-1)!,
  );
  await screen.findByText('资料已变化，请刷新对比后重新操作。');
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'wecom/mappings/one/sync',
      json: { direction: 'pull', fingerprint: 'a'.repeat(64) },
    }),
  );
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
});
it('mapping creation rejects both identities empty before sending and focuses the field', async () => {
  mount('/wecom/new');
  await screen.findByRole('dialog');
  await userEvent.click(screen.getByRole('button', { name: '创建' }));
  expect(
    await screen.findByText('至少选择本地记录或填写企微 ID。'),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('企微 ID')).toHaveFocus();
  expect(api.request.mock.calls.some(([x]) => x.method === 'POST')).toBe(false);
  await userEvent.type(screen.getByLabelText('企微 ID'), 'alice');
  expect(
    screen.queryByText('至少选择本地记录或填写企微 ID。'),
  ).not.toBeInTheDocument();
});
it('unknown outcome hides write controls and offers reconciliation only', async () => {
  api.request.mockImplementation(async ({ path }) =>
    path === 'wecom/mappings/one'
      ? {
          data: {
            ...preview.data,
            mapping: {
              ...preview.data.mapping,
              state: 'unknown',
              intent: preview.data.local,
            },
          },
        }
      : list,
  );
  mount('/wecom/one');
  await screen.findByRole('button', { name: '核实执行结果' });
  expect(
    screen.queryByRole('button', { name: '同步到企微' }),
  ).not.toBeInTheDocument();
  expect(screen.getByText('上次操作目标')).toBeInTheDocument();
});

it('clears a selected local user when searching a new options page', async () => {
  api.request.mockImplementation(async ({ path }) =>
    path === 'wecom/options'
      ? {
          data: {
            users: [{ id: 'alice-local', name: 'Alice' }],
            userTotal: 1,
            departments: [],
          },
        }
      : list,
  );
  mount('/wecom/new');
  await screen.findByRole('dialog');
  await userEvent.click(
    within(screen.getByRole('dialog')).getByLabelText(/类型/),
  );
  await userEvent.click(screen.getByRole('option', { name: '人员' }));
  screen.getByLabelText('本地记录').focus();
  await userEvent.keyboard('{ArrowDown}');
  await userEvent.click(
    await screen.findByRole('option', { name: 'Alice (alice-local)' }),
  );
  const search = screen.getByPlaceholderText('搜索本地用户名称、邮箱');
  await userEvent.type(search, 'Other');
  await waitFor(() =>
    expect(screen.getByLabelText('本地记录')).not.toHaveTextContent('Alice'),
  );
  await userEvent.click(screen.getByRole('button', { name: '创建' }));
  await screen.findByText('至少选择本地记录或填写企微 ID。');
  expect(api.request.mock.calls.some(([x]) => x.method === 'POST')).toBe(false);
});
