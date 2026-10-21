vi.stubGlobal(
  'matchMedia',
  vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
);
import { ApiClientError } from '@nocobase/app-client';
import Detail from '../../client/pages/messages/detail.js';
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
import zh from '../../client/locales/zh-CN.js';
import List from '../../client/pages/messages/list.js';
import Preferences from '../../client/pages/messages/preferences.js';
const { api } = vi.hoisted(() => ({ api: { request: vi.fn() } }));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useNavigationGuard: vi.fn(),
  useApiClient: () => api,
  useToaster: () => ({ show: vi.fn() }),
}));
const runtime = await createTestI18nRuntime({
  locale: 'zh-CN',
  application: { namespace: 'nocoerp', resources: zh },
});
const pref = {
  version: 1,
  enabled: true,
  contracts: true,
  bills: true,
  repairs: true,
  purchases: true,
  contractDays: 30,
  billDays: 7,
  locale: 'zh-CN',
  createdAt: '',
  updatedAt: '',
  lastCheckedAt: '',
  lastError: '',
};
function mount(
  el: React.ReactNode,
  path = '/messageTodos',
  pattern = path,
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }),
) {
  return render(
    <TestI18nProvider runtime={runtime}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={pattern} element={el} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </TestI18nProvider>,
  );
}
beforeEach(() => {
  api.request.mockReset();
  api.request.mockImplementation(async (v) =>
    v.path === 'messagePreferences'
      ? { data: pref }
      : { data: [], meta: { page: 1, pageSize: 20, total: 0 } },
  );
});
afterEach(cleanup);
it('shows a single empty-state Check and refreshes the list and preferences', async () => {
  mount(<List />);
  await screen.findByText('暂无待处理事项');
  expect(screen.getAllByRole('button', { name: '检查提醒' })).toHaveLength(1);
  const count = api.request.mock.calls.length;
  await userEvent.click(screen.getByRole('button', { name: '刷新' }));
  await waitFor(() => expect(api.request.mock.calls.length).toBe(count + 2));
});
it('search composition does not emit intermediate Chinese text', async () => {
  mount(<List />);
  const input = await screen.findByPlaceholderText('搜索业务单号或标题');
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: 'het' } });
  expect(api.request.mock.calls.some(([v]) => v.query?.q === 'het')).toBe(
    false,
  );
  fireEvent.compositionEnd(input, { data: '合同' });
  fireEvent.change(input, { target: { value: '合同' } });
  await waitFor(() =>
    expect(api.request.mock.calls.some(([v]) => v.query?.q === '合同')).toBe(
      true,
    ),
  );
});
it('validates threshold bounds, focuses the invalid field, saves one atomic settings draft', async () => {
  mount(<Preferences />, '/messagePreferences');
  const input = await screen.findByLabelText('合同提前提醒天数（1–90） *');
  await userEvent.clear(input);
  await userEvent.type(input, '91');
  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));
  await screen.findByText('请输入 1 至 90 的整数。');
  expect(api.request.mock.calls.every(([v]) => v.method !== 'POST')).toBe(true);
  await waitFor(() =>
    expect(document.activeElement?.id).toBe('cashier-contractDays'),
  );
  await userEvent.clear(input);
  await userEvent.type(input, '10');
  api.request.mockImplementation(async (v) =>
    v.method === 'POST'
      ? { data: { ...pref, contractDays: 10, version: 2 } }
      : { data: { ...pref, contractDays: 10, version: 2 } },
  );
  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: '保存设置' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true),
  );
  expect(
    api.request.mock.calls.find(([v]) => v.method === 'POST')?.[0].json,
  ).toMatchObject({
    expectedVersion: 1,
    values: { contractDays: 10, enabled: true },
  });
});
it('preserves the settings draft on a network failure and offers retry', async () => {
  mount(<Preferences />, '/messagePreferences');
  const input = await screen.findByLabelText('合同提前提醒天数（1–90） *');
  await userEvent.clear(input);
  await userEvent.type(input, '15');
  api.request.mockImplementation(async (v) => {
    if (v.method === 'POST') throw Error('offline');
    return { data: pref };
  });
  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));
  await screen.findByRole('alert');
  expect((input as HTMLInputElement).value).toBe('15');
  expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
});

it('keeps a clear action with matching results and settings carries the origin query', async () => {
  api.request.mockImplementation(async (v) =>
    v.path === 'messagePreferences'
      ? { data: pref }
      : {
          data: [
            {
              id: 'test',
              number: 'CGSQ-1',
              title: '采购',
              kind: 'purchases',
              reason: 'purchaseReview',
              status: 'active',
              dueOn: '2026-10-19',
              updatedAt: '2026-10-19T12:00:00Z',
            },
          ],
          meta: { page: 1, pageSize: 20, total: 1 },
        },
  );
  mount(<List />, '/messageTodos?q=CGSQ', '/messageTodos');
  await screen.findByText('采购申请待审批');
  expect(screen.getAllByRole('button', { name: '清除筛选' })).toHaveLength(1);
  expect(
    screen
      .getByRole('button', { name: '提醒设置' })
      .closest('a')
      ?.getAttribute('href') ??
      screen.getByRole('button', { name: '提醒设置' }).getAttribute('href'),
  ).toContain('?q=CGSQ');
});
it('a fresh404 removes cached business details and invalidates the parent list', async () => {
  const id = '10101010-1010-4010-8010-101010101010',
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['hyl', 'messageTodos', {}], { data: [] });
  api.request.mockResolvedValue({
    data: {
      id,
      number: 'CGSQ-PRIVATE',
      title: 'Private source',
      kind: 'purchases',
      reason: 'purchaseReview',
      status: 'active',
      dueOn: '2026-10-19',
      generation: 1,
      createdAt: '',
      updatedAt: '',
      path: '/procurement/requests/test',
      notificationId: 'native',
      deliveryStatus: 'completed',
      canRetry: false,
    },
  });
  mount(
    <Detail />,
    '/messageTodos/' + id,
    '/messageTodos/:messageTodoId',
    client,
  );
  await screen.findByRole('button', { name: '打开业务记录' });
  api.request.mockRejectedValue(
    new ApiClientError('Missing', {
      status: 404,
      method: 'GET',
      url: '/messageTodos/' + id,
    }),
  );
  await userEvent.click(screen.getByRole('button', { name: '刷新' }));
  await screen.findByRole('alert');
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: '打开业务记录' })).toBeNull(),
  );
  expect(screen.queryByText('Private source')).toBeNull();
  expect(client.getQueryState(['hyl', 'messageTodos', {}])?.isInvalidated).toBe(
    true,
  );
  expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
});

vi.mock('@nocobase/app-plugin-authorization/client', async (original) => ({
  ...(await original<
    typeof import('@nocobase/app-plugin-authorization/client')
  >()),
  useAuthorizationRevision: () => 0,
}));

vi.mock('@nocobase/app-plugin-authentication/client', async (original) => ({
  ...(await original<
    typeof import('@nocobase/app-plugin-authentication/client')
  >()),
  useAuthentication: () => ({ session: { user: { id: 'business-test' } } }),
}));
