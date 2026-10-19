import { ApiClientError } from '@nocobase/app-client';
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
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import zh from '../../client/locales/zh-CN.js';
import Submit from '../../client/pages/approvals/submit.js';
import Detail from '../../client/pages/approvals/detail.js';
import ConfigForm from '../../client/pages/approvals/config-form.js';
import { ApprovalPanel } from '../../client/pages/approvals/panel.js';
const { api, can } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  can: { value: true },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useNavigationGuard: vi.fn(),
  useApiClient: () => api,
  useToaster: () => ({ show: vi.fn() }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationRevision: () => 0,
  useCan: () => ({ can: can.value, isPending: false }),
}));
const runtime = await createTestI18nRuntime({
  locale: 'zh-CN',
  application: { namespace: 'nocoerp', resources: zh },
});
const approval = {
  id: 'a',
  kind: 'purchases',
  sourceId: 'p',
  status: 'pending',
  version: 1,
  round: 1,
  level: 0,
  sourceVersion: 1,
  applicantName: '申请人',
  canDecide: true,
  canCancel: true,
  payload: {
    source: {},
    number: 'TEST-1',
    title: '采购',
    comment: '申请说明',
    configRevision: 1,
    stages: [
      { name: '一级', candidates: [{ id: 'one', name: '张审核' }] },
      { name: '二级', candidates: [{ id: 'two', name: '李审核' }] },
    ],
  },
  events: { data: [], meta: { page: 1, pageSize: 20, total: 0 } },
};
function mount(
  el: React.ReactNode,
  path = '/approvals/requests/a',
  pattern = '/approvals/requests/:approvalRequestId',
) {
  return render(
    <TestI18nProvider runtime={runtime}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
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
  can.value = true;
  api.request.mockReset();
  api.request.mockImplementation(async (v) =>
    v.path === 'approvalProjects'
      ? { data: [{ id: 'project', name: '演示项目' }] }
      : v.path === 'approvalPeople'
        ? {
            data: [
              { id: 'one', name: '张审核' },
              { id: 'two', name: '李审核' },
            ],
            meta: { page: 1, pageSize: 20, total: 2 },
          }
        : v.path.startsWith('approvalConfigs/')
          ? {
              data: {
                id: 'project:purchases',
                revision: 1,
                enabled: true,
                levels: [
                  {
                    name: '一级',
                    userIds: ['one'],
                    users: [{ id: 'one', name: '张审核', active: true }],
                  },
                ],
              },
            }
          : { data: approval },
  );
});
afterEach(cleanup);
it('requires comments and a named destructive confirmation before rejection', async () => {
  mount(<Detail />);
  const u = userEvent.setup();
  await screen.findByText('申请说明');
  await u.click(screen.getByRole('button', { name: '驳回申请' }));
  expect(api.request.mock.calls.some(([v]) => v.method === 'POST')).toBe(false);
  expect(screen.getByText('请填写说明或意见。')).toBeVisible();
  await u.type(screen.getByRole('textbox', { name: /申请说明/ }), '补充理由');
  await u.click(screen.getByRole('button', { name: '驳回申请' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByText('驳回申请 · TEST-1')).toBeVisible();
  expect(api.request.mock.calls.some(([v]) => v.method === 'POST')).toBe(false);
  await u.click(within(dialog).getByRole('button', { name: '驳回申请' }));
  await waitFor(() =>
    expect(
      api.request.mock.calls.some(
        ([v]) => v.json?.action === 'reject' && v.json.comment === '补充理由',
      ),
    ).toBe(true),
  );
});
it('hides stale cached detail and actions after a permission loss', async () => {
  let denied = false;
  api.request.mockImplementation(async () => {
    if (denied)
      throw new ApiClientError('Denied', {
        status: 404,
        reason: 'APPROVAL_NOT_FOUND',
      });
    return { data: approval };
  });
  mount(<Detail />);
  await screen.findByText('申请说明');
  denied = true;
  await userEvent.click(screen.getByRole('button', { name: '刷新' }));
  await waitFor(() =>
    expect(screen.queryByText('申请说明')).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByRole('button', { name: '通过本级' }),
  ).not.toBeInTheDocument();
});
it('keeps source navigation contextual including its filters', async () => {
  api.request.mockResolvedValue({
    data: {
      required: true,
      canSubmit: true,
      request: { id: 'a', status: 'pending' },
      levels: [],
    },
  });
  mount(
    <ApprovalPanel kind='purchases' id='p' />,
    '/procurement/requests/p?q=lamp',
    '/procurement/requests/:id',
  );
  expect(
    await screen.findByRole('button', { name: '查看审批详情' }),
  ).toHaveAttribute(
    'href',
    '/procurement/requests/p/approvalRequests/a?q=lamp',
  );
});
it('adds sequential levels and renders configuration read-only without save', async () => {
  can.value = false;
  mount(
    <ConfigForm />,
    '/approvals/configs/project/purchases',
    '/approvals/configs/:approvalProjectId/:approvalKind',
  );
  expect(
    await screen.findByText('你可以查看配置，修改需要本项目的审批配置权限。'),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: '保存配置' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: /审批层级 1/ })).toBeDisabled();
});
it('focuses the invalid level name, clears the corrected error and offers guarded footer cancel', async () => {
  mount(
    <ConfigForm />,
    '/approvals/configs/project/purchases',
    '/approvals/configs/:approvalProjectId/:approvalKind',
  );
  const u = userEvent.setup(),
    field = await screen.findByRole('textbox', { name: /审批层级 1/ });
  await waitFor(() => expect(field).toHaveValue('一级'));
  await u.clear(field);
  await u.click(screen.getByRole('button', { name: '保存配置' }));
  await waitFor(() => expect(field).toHaveFocus());
  expect(screen.getByText('请填写 1–60 字的层级名称。')).toBeVisible();
  await u.type(field, '一级复核');
  expect(
    screen.queryByText('请填写 1–60 字的层级名称。'),
  ).not.toBeInTheDocument();
  expect(
    screen
      .getByRole('button', { name: '保存配置' })
      .closest('[data-slot="card-content"]'),
  ).toBeTruthy();
  await u.click(screen.getByRole('button', { name: '取消' }));
  expect(await screen.findByRole('alertdialog')).toHaveTextContent(
    '放弃审批配置修改 · 演示项目',
  );
  expect(api.request.mock.calls.some(([v]) => v.method === 'POST')).toBe(false);
});
it('does not expose editable controls before the server configuration baseline arrives', async () => {
  api.request.mockImplementation(async (v) =>
    v.path.startsWith('approvalConfigs/')
      ? new Promise(() => {})
      : v.path === 'approvalProjects'
        ? { data: [{ id: 'project', name: '演示项目' }] }
        : { data: [], meta: { page: 1, pageSize: 20, total: 0 } },
  );
  mount(
    <ConfigForm />,
    '/approvals/configs/project/purchases',
    '/approvals/configs/:approvalProjectId/:approvalKind',
  );
  await waitFor(() =>
    expect(
      api.request.mock.calls.some(
        ([v]) => v.path === 'approvalConfigs/project/purchases',
      ),
    ).toBe(true),
  );
  expect(
    screen.queryByRole('textbox', { name: /审批层级 1/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: '保存配置' }),
  ).not.toBeInTheDocument();
});
it('previews authoritative source version and business amount before submission', async () => {
  api.request.mockResolvedValue({
    data: {
      kind: 'purchases',
      id: 'p',
      number: 'PREVIEW-1',
      title: '灯具采购',
      version: 4,
      status: 'draft',
      required: true,
      canSubmit: true,
      levels: [{ name: '一级复核', count: 2 }],
      snapshot: {
        amountCents: '10000',
        neededOn: '2026-10-31',
        reason: '维修照明',
      },
    },
  });
  mount(
    <Submit />,
    '/procurement/requests/p/approvalSubmit?approvalKind=purchases&approvalSourceId=p',
    '/procurement/requests/:id/approvalSubmit',
  );
  expect(await screen.findByText('提交单据版本 4')).toBeVisible();
  expect(screen.getByText('¥100.00')).toBeVisible();
  expect(screen.getByText('维修照明')).toBeVisible();
  expect(screen.getByText('一级复核 · 配置候选人 2 人')).toBeVisible();
});
it('freezes an unknown decision outcome and retries the identical request before adopting its result', async () => {
  let posts = 0,
    current = { ...approval };
  api.request.mockImplementation(async (v) => {
    if (v.method === 'POST') {
      posts++;
      if (posts === 1) throw Error('Network interrupted');
      current = {
        ...approval,
        status: 'approved',
        version: 2,
        canDecide: false,
        canCancel: false,
      };
    }
    return { data: current };
  });
  mount(<Detail />);
  const u = userEvent.setup();
  await screen.findByText('申请说明');
  await u.type(screen.getByRole('textbox', { name: /申请说明/ }), '同意采购');
  await u.click(screen.getByRole('button', { name: '通过本级' }));
  const dialog = await screen.findByRole('alertdialog');
  await u.click(within(dialog).getByRole('button', { name: '通过本级' }));
  await waitFor(() =>
    expect(
      within(dialog).getByRole('button', { name: '重试同一请求' }),
    ).toBeEnabled(),
  );
  expect(screen.getByLabelText(/申请说明/)).toBeDisabled();
  await u.click(within(dialog).getByRole('button', { name: '重试同一请求' }));
  await screen.findByText('审批通过');
  const submitted = api.request.mock.calls
    .filter(([v]) => v.method === 'POST')
    .map(([v]) => v.json);
  expect(submitted).toHaveLength(2);
  expect(submitted[1]).toEqual(submitted[0]);
  expect(
    screen.queryByRole('button', { name: '通过本级' }),
  ).not.toBeInTheDocument();
});

vi.mock('@nocobase/app-plugin-authentication/client', async (original) => ({
  ...(await original<
    typeof import('@nocobase/app-plugin-authentication/client')
  >()),
  useAuthentication: () => ({ session: { user: { id: 'business-test' } } }),
}));
