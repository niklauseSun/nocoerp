import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import {
  TestI18nProvider,
  createTestI18nRuntime,
} from '@nocobase/i18n/testing';
import zh from '../../client/locales/zh-CN.js';
import Logs from '../../client/pages/operation-logs/index.js';
import Detail from '../../client/pages/operation-logs/detail.js';
import { logDay, logQuery } from '../../client/pages/operation-logs/data.js';
vi.stubGlobal(
  'matchMedia',
  vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
);
const state = vi.hoisted(() => ({
  fetching: false,
  loaded: true,
  error: null as unknown,
  empty: false,
  refetch: vi.fn(),
  calls: vi.fn(),
}));
const row = {
  id: '12345678-1234-4234-8234-123456789012',
  createdAt: '2026-10-21T02:00:00.000Z',
  actorName: '测试管理员',
  actorId: 'admin-id',
  module: 'organization',
  action: 'organizationCreateDepartment',
  targetId: 'department-id',
  method: 'POST',
  pathTemplate: '/api/organization/departments',
  result: 'success',
  httpStatus: 200,
  errorCode: '',
  requestId: 'request-id',
  durationMs: 10,
};
vi.mock('../../client/pages/operation-logs/data.js', async (original) => ({
  ...(await original<object>()),
  useLogs: (path: string, q: unknown) => {
    state.calls(path, q);
    return {
      data:
        state.fetching && !state.loaded
          ? undefined
          : path === '/operationLogs'
            ? {
                data: state.empty ? [] : [row],
                meta: { page: 1, pageSize: 20, total: state.empty ? 0 : 1 },
              }
            : { data: row },
      isFetching: state.fetching,
      isError: !!state.error,
      error: state.error,
      refetch: state.refetch,
    };
  },
}));
const runtime = await createTestI18nRuntime({
  locale: 'zh-CN',
  application: { namespace: 'nocoerp', resources: zh },
});
afterEach(() => {
  cleanup();
  state.fetching = false;
  state.loaded = true;
  state.error = null;
  state.empty = false;
  vi.clearAllMocks();
});
function setup(url = '/operationLogs') {
  const router = createMemoryRouter(
    [
      {
        path: '/operationLogs',
        Component: Logs,
        children: [{ path: ':id', Component: Detail }],
      },
    ],
    { initialEntries: [url] },
  );
  render(
    <TestI18nProvider runtime={runtime}>
      <RouterProvider router={router} />
    </TestI18nProvider>,
  );
  return router;
}
it('searches with IME, resets page, refreshes, opens detail and closes without losing filters', async () => {
  const router = setup('/operationLogs?page=3&module=organization'),
    user = userEvent.setup();
  const search = screen.getByRole('textbox');
  await user.type(search, 'abc');
  expect(router.state.location.search).toContain('q=abc');
  expect(router.state.location.search).not.toContain('page=3');
  fireEvent.compositionStart(search);
  fireEvent.change(search, { target: { value: '测试' } });
  fireEvent.compositionEnd(search, { data: '测试' });
  expect(screen.getByRole('textbox')).toHaveValue('测试');
  expect(state.calls).toHaveBeenLastCalledWith(
    '/operationLogs',
    expect.objectContaining({ q: '测试', module: 'organization' }),
  );
  await user.click(screen.getByRole('button', { name: '刷新' }));
  expect(state.refetch).toHaveBeenCalledOnce();
  const searchBefore = router.state.location.search;
  await user.click(screen.getByRole('link', { name: '12345678' }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(screen.getByText('请求编号')).toBeInTheDocument();
  expect(screen.getByText('request-id')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '删除' })).toBeNull();
  await user.keyboard('{Escape}');
  await waitFor(() =>
    expect(router.state.location.pathname).toBe('/operationLogs'),
  );
  expect(router.state.location.search).toBe(searchBefore);
  expect(screen.getByRole('link', { name: '12345678' })).toHaveFocus();
  await user.click(screen.getByRole('button', { name: '清空筛选' }));
  expect(router.state.location.search).toBe('');
});
it('renders empty, no-results, loading and retryable errors without showing stale records', async () => {
  state.empty = true;
  const router = setup();
  expect(screen.getByText('暂无操作日志')).toBeInTheDocument();
  await userEvent.setup().type(screen.getByRole('textbox'), 'missing');
  expect(screen.getByText('没有匹配的操作日志')).toBeInTheDocument();
  expect(router.state.location.search).toContain('q=missing');
  cleanup();
  state.empty = false;
  state.fetching = true;
  state.loaded = false;
  setup();
  expect(screen.queryByRole('link', { name: '12345678' })).toBeNull();
  expect(screen.getByRole('button', { name: '刷新' })).toBeDisabled();
  cleanup();
  state.fetching = false;
  state.error = new Error('private error body');
  setup();
  expect(screen.queryByText('private error body')).toBeNull();
  expect(screen.queryByRole('link', { name: '12345678' })).toBeNull();
  await userEvent.setup().click(screen.getByRole('button', { name: '重试' }));
  expect(state.refetch).toHaveBeenCalled();
});
it('converts date filters to inclusive Beijing days without sending unrelated query params', () => {
  expect(
    logQuery(new URLSearchParams('from=2026-10-21&to=2026-10-22&extra=secret')),
  ).toEqual({
    from: '2026-10-21T00:00:00.000+08:00',
    to: '2026-10-22T23:59:59.999+08:00',
  });
});

it('ignores malformed date URL values rather than formatting invalid dates', () => {
  expect(logDay('2026-02-30')).toBe('');
  expect(logDay('bad')).toBe('');
  expect(logDay('2026-02-28')).toBe('2026-02-28');
  expect(logQuery(new URLSearchParams('from=bad&to=2026-99-99'))).toEqual({});
});

it('keeps rows visible during refresh and reports a reversed date range', () => {
  state.fetching = true;
  setup();
  expect(screen.getByRole('link', { name: '12345678' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '刷新' })).toBeDisabled();
  cleanup();
  state.fetching = false;
  setup('/operationLogs?from=2026-10-22&to=2026-10-21');
  expect(
    screen.getByText('开始日期不能晚于结束日期，请重新选择日期范围。'),
  ).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: '12345678' })).toBeNull();
});

it('applies a range preset atomically and preserves other filters', async () => {
  const router = setup('/operationLogs?module=organization&page=4'),
    user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '操作日期范围' }));
  await user.click(screen.getByRole('button', { name: '近7天' }));
  const params = new URLSearchParams(router.state.location.search);
  expect(params.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(params.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(params.get('module')).toBe('organization');
  expect(params.has('page')).toBe(false);
});
