import { ApiClientError } from '@nocobase/app-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  TestI18nProvider,
  createTestI18nRuntime,
} from '@nocobase/i18n/testing';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import zh from '../../client/locales/zh-CN.js';
import en from '../../client/locales/en-US.js';
import ServiceDetailPage from '../../client/pages/tenant-operations/service-detail.js';
import BatchSource from '../../client/pages/tenant-operations/batch-source.js';
import ServiceForm from '../../client/pages/tenant-operations/service-form.js';
import ServiceAction from '../../client/pages/tenant-operations/service-action.js';
import BatchForm from '../../client/pages/tenant-operations/batch-form.js';
import BankImport from '../../client/pages/tenant-operations/bank-import.js';
import BankBatch from '../../client/pages/tenant-operations/bank-batch.js';
import BankResolution from '../../client/pages/tenant-operations/bank-resolution.js';
import Operations from '../../client/pages/tenant-operations/index.js';
const { api, toast } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  toast: vi.fn(),
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useNavigationGuard: vi.fn(),
  useToaster: () => ({ show: toast }),
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ session: { user: { id: 'TEST-user' } } }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useCan: () => ({ can: true }),
  useAuthorizationRevision: () => 0,
}));
vi.stubGlobal(
  'matchMedia',
  vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
);
const runtime = await createTestI18nRuntime({
    locale: 'zh-CN',
    application: { namespace: 'nocoerp', resources: zh },
  }),
  english = await createTestI18nRuntime({
    locale: 'en-US',
    application: { namespace: 'nocoerp', resources: en },
  });
const merchant = '11111111-1111-4111-8111-111111111111',
  contract = '22222222-2222-4222-8222-222222222222',
  record = '33333333-3333-4333-8333-333333333333';
function Probe() {
  const l = useLocation();
  return <output data-testid='delivery-url'>{l.pathname + l.search}</output>;
}
function mount(
  node: React.ReactNode,
  entry: string,
  path: string,
  lang = runtime,
) {
  return render(
    <TestI18nProvider runtime={lang}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter initialEntries={[entry]}>
          <Probe />
          <Routes>
            <Route path={path} element={node} />
            <Route path='*' element={<p>TEST destination</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </TestI18nProvider>,
  );
}
beforeEach(() => {
  api.request.mockReset();
  toast.mockClear();
});
afterEach(cleanup);
it('TEST service creation validates on submit, accepts Chinese editing and preserves list filters on success', async () => {
  const user = userEvent.setup();
  api.request.mockImplementation(async ({ method }) =>
    method === 'POST'
      ? { data: { id: record } }
      : {
          data: {
            manage: false,
            merchants: [{ id: merchant, name: 'TEST商户' }],
          },
        },
  );
  mount(
    <ServiceForm />,
    '/tenantOperations/service/new?view=tenantService&q=TEST&page=2',
    '/tenantOperations/service/new',
  );
  await screen.findByLabelText('标题 *');
  await user.click(
    screen.getByRole('button', { name: '创建服务记录', exact: true }),
  );
  expect(screen.getByLabelText('标题 *')).toHaveFocus();
  expect(
    api.request.mock.calls.filter(([r]) => r.method === 'POST'),
  ).toHaveLength(0);
  await user.type(screen.getByLabelText('标题 *'), 'TEST投诉测试');
  await user.type(screen.getByLabelText('正文 *'), 'TEST处理内容');
  await user.click(
    screen.getByRole('button', { name: '创建服务记录', exact: true }),
  );
  await waitFor(() =>
    expect(screen.getByTestId('delivery-url')).toHaveTextContent(
      '/tenantOperations/service/' +
        record +
        '?view=tenantService&q=TEST&page=2',
    ),
  );
  expect(
    api.request.mock.calls.find(([r]) => r.method === 'POST')![0].json,
  ).toMatchObject({
    title: 'TEST投诉测试',
    body: 'TEST处理内容',
    merchantId: merchant,
    type: 'complaint',
  });
});
it('TEST service conflict retains reply text and requires explicit reload before using a newer version', async () => {
  const user = userEvent.setup();
  let version = 1,
    posts = 0;
  api.request.mockImplementation(async ({ method }) => {
    if (method === 'POST') {
      posts++;
      if (posts === 1) {
        version = 3;
        throw new ApiClientError('Changed', {
          status: 409,
          reason: 'VERSION_CONFLICT',
        });
      }
      return { data: { id: record } };
    }
    return {
      data: {
        id: record,
        title: 'TEST诉求',
        version,
        allowedActions: ['reply'],
      },
    };
  });
  mount(
    <ServiceAction />,
    `/tenantOperations/service/${record}/action/reply?view=tenantService`,
    `/tenantOperations/service/:serviceId/action/:serviceAction`,
  );
  await user.type(await screen.findByLabelText('处理说明 *'), 'TEST保留草稿');
  await user.click(
    screen.getByRole('button', { name: '登记处理回复', exact: true }),
  );
  expect(await screen.findByText(/记录已变化，输入已保留/)).toBeVisible();
  expect(screen.getByLabelText('处理说明 *')).toHaveValue('TEST保留草稿');
  await user.click(screen.getByRole('button', { name: '重新加载记录' }));
  await waitFor(() =>
    expect(
      screen.queryByText(/记录已变化，输入已保留/),
    ).not.toBeInTheDocument(),
  );
  await user.click(
    screen.getByRole('button', { name: '登记处理回复', exact: true }),
  );
  await waitFor(() => expect(posts).toBe(2));
  expect(
    api.request.mock.calls
      .filter(([r]) => r.method === 'POST')
      .map(([r]) => r.json.expectedVersion),
  ).toEqual([1, 3]);
});
it('TEST batch preview exposes blocked sources and only generates explicitly selected contracts', async () => {
  const user = userEvent.setup(),
    preview = {
      items: [
        {
          id: contract,
          number: 'TEST-C-1',
          name: 'TEST商户',
          canGenerate: true,
          reason: '',
        },
        {
          id: record,
          number: 'TEST-C-2',
          name: 'TEST缺报',
          canGenerate: false,
          reason: 'REPORTING_INCOMPLETE',
        },
      ],
      projects: [],
    };
  api.request.mockImplementation(async ({ path, method }) =>
    method === 'POST' && path === 'tenantOperations/batches'
      ? { data: { id: record, number: 'TEST批次' } }
      : { data: preview },
  );
  mount(
    <BatchForm />,
    '/tenantOperations/batch/new?view=batches&month=2026-10',
    '/tenantOperations/batch/new',
  );
  await user.click(await screen.findByRole('button', { name: '预览结算范围' }));
  expect(
    await screen.findByText('有效合同日仍有未报或未审核营业报送'),
  ).toBeVisible();
  expect(
    screen.getByRole('checkbox', { name: '选择记录 TEST-C-2' }),
  ).toHaveAttribute('aria-disabled', 'true');
  await user.click(screen.getByRole('checkbox', { name: '选择记录 TEST-C-1' }));
  await user.click(
    screen.getByRole('button', { name: '创建结算批次', exact: true }),
  );
  await waitFor(() =>
    expect(screen.getByTestId('delivery-url')).toHaveTextContent(
      '/tenantOperations/batch/' + record + '?view=batches&month=2026-10',
    ),
  );
  expect(
    api.request.mock.calls.find(
      ([r]) => r.method === 'POST' && r.path === 'tenantOperations/batches',
    )![0].json.contractIds,
  ).toEqual([contract]);
});
it('TEST mapped CSV import previews exact cents before committing any row', async () => {
  const user = userEvent.setup();
  api.request.mockImplementation(async ({ path }) =>
    path.endsWith('previewImport')
      ? {
          data: {
            total: 1,
            issues: [],
            rows: [
              {
                externalId: 'TEST-CSV',
                date: '2026-10-20',
                reference: 'TEST-REF',
                amountCents: '10001',
                method: 'bank',
              },
            ],
          },
        }
      : { data: [{ id: record }] },
  );
  mount(
    <BankImport />,
    '/tenantOperations/import?view=reconciliation&month=2026-10',
    '/tenantOperations/import',
  );
  await user.type(screen.getByLabelText('账单账户标识 *'), 'TEST非真实银行');
  const content =
      'externalId,date,reference,amountCents,method\nTEST-CSV,2026-10-20,TEST-REF,10001,bank',
    file = new File([content], 'TEST-bank.csv', { type: 'text/csv' });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new TextEncoder().encode(content).buffer,
  });
  await user.upload(screen.getByLabelText('CSV 文件 *'), file);
  await user.click(screen.getByRole('button', { name: '预览账单' }));
  expect(await screen.findByText('¥100.01')).toBeVisible();
  expect(
    api.request.mock.calls.filter(([r]) => r.path.endsWith('/import')),
  ).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: '确认导入' }));
  await waitFor(() =>
    expect(screen.getByTestId('delivery-url')).toHaveTextContent(
      '/tenantOperations?view=reconciliation&month=2026-10',
    ),
  );
  expect(
    api.request.mock.calls.find(([r]) => r.path.endsWith('/import'))![0].json
      .rows[0].amountCents,
  ).toBe('10001');
});
it('TEST selected bank matches show signed totals and per-row failures without inventing a receipt', async () => {
  const user = userEvent.setup();
  api.request.mockImplementation(async ({ method }) =>
    method === 'POST'
      ? { data: [{ rowId: record, status: 'failed', reason: 'MATCH_INVALID' }] }
      : {
          data: {
            items: [
              {
                row: {
                  id: record,
                  externalId: 'TEST-MATCH',
                  date: '2026-10-20',
                  amountCents: '-10000',
                },
                candidates: [{ id: 'TEST-event' }],
                canWrite: true,
              },
            ],
          },
        },
  );
  mount(
    <BankBatch />,
    `/tenantOperations/matchBatch?view=reconciliation&rowIds=${record}`,
    '/tenantOperations/matchBatch',
  );
  expect((await screen.findAllByText('-¥100.00'))[0]).toBeVisible();
  await user.type(screen.getByLabelText('匹配依据/差异说明 *'), 'TEST核对依据');
  await user.click(screen.getByRole('button', { name: '确认匹配' }));
  expect(
    await screen.findByText('匹配结果：成功 0 项，失败 1 项。'),
  ).toBeVisible();
  expect(
    api.request.mock.calls.find(([r]) => r.method === 'POST')![0].path,
  ).toBe('tenantOperations/reconciliation/confirmBatch');
});
it('TEST discrepancy history remains visible and a readonly source cannot write', async () => {
  api.request.mockResolvedValue({
    data: {
      row: {
        id: record,
        externalId: 'TEST-DIFF',
        date: '2026-10-20',
        amountCents: '100',
      },
      mayConfirm: false,
      resolutions: [
        {
          id: contract,
          createdAt: '2026-10-20T00:00:00Z',
          actor: 'TEST财务',
          nextDate: '2026-10-21',
          conclusion: 'investigating',
          note: 'TEST继续调查',
        },
      ],
    },
  });
  mount(
    <BankResolution />,
    `/tenantOperations/resolve/${record}?view=reconciliation`,
    '/tenantOperations/resolve/:bankRowId',
  );
  expect(await screen.findByText('TEST继续调查')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: '保存', exact: true }),
  ).not.toBeInTheDocument();
});
it('TEST new views are Chinese/English, keep filtered create entry and clearly distinguish local checks from real integrations', async () => {
  api.request.mockImplementation(async ({ path }) =>
    path.endsWith('/options')
      ? {
          data: {
            manage: true,
            merchants: [{ id: merchant, name: 'TEST商户' }],
          },
        }
      : path.endsWith('/integrations')
        ? {
            data: {
              canRun: false,
              items: [
                {
                  type: 'payments',
                  status: 'testOnly',
                  path: '/profit-sharing',
                  checks: [],
                },
              ],
            },
          }
        : { data: { items: [] }, meta: { total: 0, page: 1, pageSize: 20 } },
  );
  mount(
    <Operations />,
    '/tenantOperations?view=tenantService&q=TEST',
    '/tenantOperations',
  );
  expect(await screen.findByText('没有匹配的记录')).toBeVisible();
  expect(
    screen.getAllByRole('button', { name: '新建租户服务记录', exact: true }),
  ).toHaveLength(1);
  cleanup();
  mount(
    <Operations />,
    '/tenantOperations?view=integrations',
    '/tenantOperations',
    english,
  );
  expect(
    await screen.findByText('TEST only; real provider not configured'),
  ).toBeVisible();
  expect(
    screen.getByText(/A local pass does not prove remote integration/),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Run TEST self-check' }),
  ).not.toBeInTheDocument();
});

it('TEST withdrawn notice conflict can explicitly reload its version', async () => {
  const user = userEvent.setup();
  let version = 1,
    posts = 0;
  api.request.mockImplementation(async ({ method }) => {
    if (method === 'POST') {
      posts++;
      if (posts === 1) {
        version = 2;
        throw new ApiClientError('Changed', {
          status: 409,
          reason: 'VERSION_CONFLICT',
        });
      }
      return { data: { id: record } };
    }
    return {
      data: {
        id: record,
        title: 'TEST撤回公告',
        version,
        allowedActions: ['withdraw'],
      },
    };
  });
  mount(
    <ServiceAction />,
    `/tenantOperations/service/${record}/action/withdraw?view=tenantService`,
    '/tenantOperations/service/:serviceId/action/:serviceAction',
  );
  await user.click(
    await screen.findByRole('button', { name: '撤回', exact: true }),
  );
  await user.click(await screen.findByRole('button', { name: '重新加载记录' }));
  await user.click(screen.getByRole('button', { name: '撤回', exact: true }));
  await waitFor(() => expect(posts).toBe(2));
  expect(
    api.request.mock.calls
      .filter(([r]) => r.method === 'POST')
      .map(([r]) => r.json.expectedVersion),
  ).toEqual([1, 2]);
});
it('TEST completed tenant acknowledgement remains visible with a reason', async () => {
  api.request.mockResolvedValue({
    data: {
      id: record,
      title: 'TEST已读公告',
      number: 'TEST-S',
      status: 'published',
      type: 'notice',
      merchantName: 'TEST商户',
      start: '2026-10-20',
      dueDate: '2026-10-21',
      version: 2,
      payload: {},
      body: 'TEST正文',
      events: [],
      allowedActions: [],
      completedActions: ['read'],
    },
  });
  mount(
    <ServiceDetailPage />,
    `/tenantOperations/service/${record}?view=tenantService`,
    '/tenantOperations/service/:serviceId',
  );
  expect(
    await screen.findByRole('button', { name: /已完成，无需重复操作/ }),
  ).toBeDisabled();
});
it('TEST source detail returns to the exact batch and filters', async () => {
  api.request.mockResolvedValue({
    data: {
      id: record,
      number: 'TEST合同',
      status: 'active',
      payload: {},
      amountCents: '0',
    },
  });
  mount(
    <BatchSource />,
    `/tenantOperations/batch/${merchant}/contract/${record}?view=batches&month=2026-10&q=TEST`,
    '/tenantOperations/batch/:batchId/contract/:id',
  );
  await screen.findByText('TEST合同');
  expect(
    screen
      .getAllByRole('link')
      .some(
        (a) =>
          a.getAttribute('href') ===
          `/tenantOperations/batch/${merchant}?view=batches&month=2026-10&q=TEST`,
      ),
  ).toBe(true);
});
