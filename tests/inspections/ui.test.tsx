import Scheduling from '../../client/pages/inspections/scheduling.js';
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
  fireEvent,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import zh from '../../client/locales/zh-CN.js';
import List from '../../client/pages/inspections/list.js';
import Form from '../../client/pages/inspections/form.js';
import Detail from '../../client/pages/inspections/detail.js';
const { api, can, toast } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  can: { value: true, report: true },
  toast: { show: vi.fn() },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useNavigationGuard: vi.fn(),
  useApiClient: () => api,
  useToaster: () => toast,
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationRevision: () => 0,
  useCan: ({ action }: { action: string }) => ({
    can: can.value && (action !== 'report' || can.report),
  }),
}));
const runtime = await createTestI18nRuntime({
  locale: 'zh-CN',
  application: { namespace: 'nocoerp', resources: zh },
});
const row = {
  id: 'task',
  number: 'XJ-TEST',
  title: 'Facility checks',
  type: 'inspection',
  status: 'running',
  version: 1,
  assetId: 'asset',
  assigneeId: 'admin',
  day: '2026-10-18',
  dueOn: '2026-10-19',
  allowedActions: ['save', 'report', 'submit'],
  blockedActions: { submit: 'INSPECTION_RESULTS_INCOMPLETE' },
  payload: {
    assigneeName: 'Admin',
    items: [
      { id: 'one', name: 'Door', standard: 'Close securely' },
      { id: 'two', name: 'Light', standard: '' },
    ],
    results: [],
  },
  events: { data: [], meta: { page: 1, pageSize: 20, total: 0 } },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
function mount(node: React.ReactNode, path = '/inspections/tasks/task/save') {
  return render(
    <TestI18nProvider runtime={runtime}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path='/inspections/tasks/:inspectionTaskId/save'
              element={node}
            />
            <Route
              path='/inspections/tasks/:inspectionTaskId/submit'
              element={node}
            />
            <Route
              path='/inspections/tasks/:inspectionTaskId'
              element={path.endsWith('/save') ? <p>Saved</p> : node}
            />
            <Route path='*' element={node} />
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
  toast.show.mockReset();
  api.request.mockImplementation(async (r) =>
    r.method === 'POST' || r.path === 'inspectionTasks/task'
      ? { data: row }
      : { data: [], meta: { page: 1, pageSize: 20, total: 0 } },
  );
});
it('shows one create action in the empty plan list and restricts denied records', async () => {
  mount(<List kind='plans' />, '/inspections/plans');
  expect(await screen.findByText('暂无记录')).toBeVisible();
  expect(screen.getAllByRole('button', { name: '新建计划' })).toHaveLength(1);
  cleanup();
  can.value = false;
  mount(<List kind='tasks' />, '/inspections/tasks');
  expect(
    await screen.findByText('没有此区块的访问权限，请联系管理员。'),
  ).toBeVisible();
});
it('validates plan inputs before writing and preserves Chinese input editing', async () => {
  const user = userEvent.setup();
  mount(<Form kind='plans' />, '/inspections/plans/new');
  await user.click(await screen.findByRole('button', { name: '保存' }));
  expect(await screen.findAllByText('请完成此项。')).not.toHaveLength(0);
  expect(api.request.mock.calls.every(([r]) => r.method !== 'POST')).toBe(true);
  const title = screen.getByLabelText('标题 *');
  await user.type(title, '消防巡检');
  await user.type(title, '{ArrowLeft}复');
  expect(title).toHaveValue('消防巡复检');
  expect(title).toHaveAttribute('aria-invalid', 'false');
});
it('saves partial results without requiring every item', async () => {
  const user = userEvent.setup();
  mount(<Form kind='tasks' />);
  await user.click(await screen.findByRole('button', { name: '保存' }));
  await waitFor(() =>
    expect(
      api.request.mock.calls.some(
        ([r]) =>
          r.method === 'POST' &&
          r.json.action === 'save' &&
          r.json.results.length === 0,
      ),
    ).toBe(true),
  );
});
it('shows the reason for a disabled submission', async () => {
  mount(<Detail kind='tasks' />, '/inspections/tasks/task');
  expect(
    await screen.findByRole('button', { name: '提交审核' }),
  ).toBeDisabled();
  expect(screen.getByText('请先保存全部检查项的结论。')).toBeVisible();
});
it('keeps an unknown submission immutable and retries the same operation', async () => {
  const user = userEvent.setup(),
    writes: any[] = [];
  api.request.mockImplementation(async (r) => {
    if (r.method === 'POST') {
      writes.push(r.json);
      throw new ApiClientError('failure', {
        status: 500,
        method: 'POST',
        url: '/api/inspectionTasks/task/actions',
      });
    }
    return { data: row };
  });
  mount(<Form kind='tasks' />, '/inspections/tasks/task/submit');
  await user.type(await screen.findByLabelText('操作说明 *'), '全部检查完成');
  await user.click(screen.getByRole('button', { name: '提交审核' }));
  expect(
    await screen.findByText('上次操作结果未知，请保留输入并重试原操作。'),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: '提交审核' }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[0]).toEqual(writes[1]);
  expect(screen.getByLabelText('操作说明 *')).toBeDisabled();
});
it('defers search updates during composition and preserves the local input', async () => {
  const user = userEvent.setup();
  mount(<List kind='tasks' />, '/inspections/tasks');
  const input = await screen.findByRole('textbox', {
    name: '搜索编号、标题或资产',
  });
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: 'qingjie' } });
  await new Promise((r) => setTimeout(r, 350));
  expect(api.request.mock.calls.some(([r]) => r.query?.q === 'qingjie')).toBe(
    false,
  );
  fireEvent.compositionEnd(input, { target: { value: '清洁' } });
  await waitFor(() =>
    expect(api.request.mock.calls.some(([r]) => r.query?.q === '清洁')).toBe(
      true,
    ),
  );
  expect(input).toHaveValue('清洁');
  await user.type(input, '{ArrowLeft}保');
  expect(input).toHaveValue('清保洁');
});
it.each([403, 404, 500])(
  'keeps the detail error recoverable for status %s',
  async (status) => {
    api.request.mockRejectedValue(
      new ApiClientError('failure', {
        status,
        method: 'GET',
        url: '/inspectionTasks/task',
      }),
    );
    mount(<Detail kind='tasks' />, '/inspections/tasks/task');
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.getByRole('link', { name: '返回' })).toBeVisible();
    if (status === 500)
      expect(screen.getByRole('button', { name: '重试' })).toBeVisible();
    else expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
  },
);

it('retains creation in the filtered-empty plan header', async () => {
  mount(<List kind='plans' />, '/inspections/plans?inspectionplansq=none');
  expect(await screen.findByText('没有符合条件的记录')).toBeVisible();
  expect(screen.getAllByRole('button', { name: '新建计划' })).toHaveLength(1);
});

it('explains scheduler pause and reports its named success without exposing raw reasons', async () => {
  const user = userEvent.setup(),
    schedule = {
      id: 'schedule',
      key: 'inspections.dispatch',
      enabled: true,
      scheduleStatus: 'active',
      targetState: 'ready',
      runCount: 1,
      completedCount: 0,
    };
  api.request.mockImplementation(async (r) => {
    if (r.path === 'scheduler/schedules')
      return { data: [schedule], meta: { page: 1, pageSize: 20, total: 1 } };
    if (r.method === 'POST') {
      schedule.enabled = false;
      schedule.scheduleStatus = 'paused';
      return { data: schedule };
    }
    return {
      data: [
        {
          id: 'run',
          status: 'failed',
          startedAt: new Date().toISOString(),
          reason: 'UNRECOGNIZED_INTERNAL_CODE',
        },
      ],
      meta: {},
    };
  });
  mount(<Scheduling />, '/inspections/scheduling');
  expect(await screen.findByText('可执行')).toBeVisible();
  expect(screen.queryByText('UNRECOGNIZED_INTERNAL_CODE')).toBeNull();
  expect(
    await screen.findByText('本次调度未完成，请管理员查看调度详情。'),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: '暂停' }));
  expect(
    await screen.findByText(
      '暂停后所有巡检计划停止自动生成任务，现有任务仍可处理，也可手动补生成。',
    ),
  ).toBeVisible();
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: '暂停',
    }),
  );
  await waitFor(() =>
    expect(toast.show).toHaveBeenCalledWith({ title: '暂停成功：“自动调度”' }),
  );
});

vi.mock('@nocobase/app-plugin-authentication/client', async (original) => ({
  ...(await original<
    typeof import('@nocobase/app-plugin-authentication/client')
  >()),
  useAuthentication: () => ({ session: { user: { id: 'business-test' } } }),
}));
