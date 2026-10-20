import { ApiClientError } from '@nocobase/app-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  TestI18nProvider,
  createTestI18nRuntime,
} from '@nocobase/i18n/testing';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import zh from '../../client/locales/zh-CN.js';
import { BusinessList } from '../../client/pages/hyl/list.js';
import BusinessAction from '../../client/pages/hyl/action.js';
import BusinessDetail from '../../client/pages/hyl/detail.js';
import BusinessForm from '../../client/pages/hyl/form.js';
import Operations from '../../client/pages/tenant-operations/index.js';
import { drafts } from '../../client/pages/hyl/drafts.js';
const { api, state } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  state: { mobile: true, can: true },
}));
vi.mock('../../client/hooks/use-mobile.js', () => ({
  useIsMobile: () => state.mobile,
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => ({ show: vi.fn() }),
  useNavigationGuard: vi.fn(),
  useService: () => ({ repository: () => ({}) }),
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ session: { user: { id: 'TEST-mobile' } } }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationRevision: () => 0,
  useCan: () => ({ can: state.can }),
}));
vi.mock('../../client/pages/profit-sharing/related.js', () => ({
  SplitRelated: () => null,
}));
const runtime = await createTestI18nRuntime({
  locale: 'zh-CN',
  application: { namespace: 'nocoerp', resources: zh },
});
function Probe() {
  const l = useLocation();
  return <output data-testid='url'>{l.pathname + l.search}</output>;
}
function mount(
  element: React.ReactNode,
  entry: string,
  kind = 'settlements',
  child = ':id/confirm',
) {
  return render(
    <TestI18nProvider runtime={runtime}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter initialEntries={[entry]}>
          <Probe />
          <Routes>
            <Route path={'/' + kind} element={<Outlet context={{ kind }} />}>
              <Route
                index
                element={
                  entry.split('?')[0] === '/' + kind ? (
                    element
                  ) : (
                    <p>TEST destination</p>
                  )
                }
              />
              {child.startsWith(':id/') ? (
                <Route path=':id' element={<Outlet context={{ kind }} />}>
                  <Route index element={<p>TEST detail</p>} />
                  <Route path={child.slice(4)} element={element} />
                </Route>
              ) : (
                <Route path={child} element={element} />
              )}
            </Route>
            <Route path='/tenantOperations' element={element} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </TestI18nProvider>,
  );
}
const report = {
  id: 'TEST-report',
  number: 'TEST-R-001超长营业报送编号',
  name: 'TEST商户',
  status: 'returned',
  date: '2026-10-20',
  updatedAt: '2026-10-20T00:00:00Z',
  amountCents: '12345',
  version: 1,
  payload: {
    merchantId: 'TEST-merchant',
    date: '2026-10-20',
    source: 'cash',
    reference: 'TEST-REF',
    receipts: '123.45',
    refunds: '0',
    activity: '0',
    cash: '0',
    hospitality: '0',
    collected: '123.45',
    evidence: 'TEST凭证说明',
    notes: 'TEST备注',
  },
};
beforeEach(() => {
  api.request.mockReset();
  state.mobile = true;
  state.can = true;
  drafts.clear();
});
afterEach(cleanup);
it('uses phone report cards with the same links, status and server sort, while desktop keeps the table', async () => {
  const user = userEvent.setup();
  api.request.mockResolvedValue({ data: [report], meta: { total: 1 } });
  const view = mount(
    <BusinessList kind='revenueReports' />,
    '/revenueReports?q=TEST&status=returned',
    'revenueReports',
  );
  expect(
    await screen.findByRole('heading', { name: report.number }),
  ).toBeVisible();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: report.number })).toHaveAttribute(
    'href',
    '/revenueReports/TEST-report?q=TEST&status=returned',
  );
  expect(
    screen
      .getAllByText('已退回')
      .find((el) => el.getAttribute('data-slot') === 'badge')!,
  ).toBeVisible();
  await user.click(screen.getByRole('combobox', { name: '排序方式' }));
  await user.click(await screen.findByRole('option', { name: '金额 · 升序' }));
  await waitFor(() =>
    expect(api.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          orderBy: 'amountCents:asc',
          q: 'TEST',
          status: 'returned',
        }),
      }),
    ),
  );
  view.unmount();
  state.mobile = false;
  mount(
    <BusinessList kind='revenueReports' />,
    '/revenueReports',
    'revenueReports',
  );
  expect(await screen.findByRole('table')).toBeVisible();
  expect(
    screen.queryByRole('combobox', { name: '排序方式' }),
  ).not.toBeInTheDocument();
});
it('keeps service filters and direct detail links in phone cards', async () => {
  api.request.mockImplementation(async ({ path }) =>
    path.endsWith('/options')
      ? {
          data: {
            manage: false,
            merchants: [{ id: 'TEST-m', name: 'TEST商户' }],
          },
        }
      : {
          data: {
            items: [
              {
                id: 'TEST-service',
                name: 'TEST长中文服务标题',
                date: '2026-10-20',
                status: 'processing',
                type: 'complaint',
                detail: 'TEST商户',
                updatedAt: '2026-10-20T00:00:00Z',
                path: 'service/TEST-service',
              },
            ],
          },
          meta: { total: 1, page: 1, pageSize: 20 },
        },
  );
  mount(
    <Operations />,
    '/tenantOperations?view=tenantService&type=complaint&q=TEST',
  );
  expect(
    await screen.findByRole('heading', { name: 'TEST长中文服务标题' }),
  ).toBeVisible();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: 'TEST长中文服务标题' }),
  ).toHaveAttribute(
    'href',
    '/tenantOperations/service/TEST-service?view=tenantService&type=complaint&q=TEST',
  );
  expect(screen.getByRole('combobox', { name: '排序方式' })).toBeVisible();
});
it('preserves Chinese dispute text on conflict and writes the explicitly reloaded version', async () => {
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
      return { data: { id: 'TEST-s', version: 4 } };
    }
    return {
      data: {
        id: 'TEST-s',
        number: 'TEST结算单',
        status: 'confirmation',
        version,
        confirmationModes: ['online'],
        payload: {},
        events: [],
      },
    };
  });
  mount(
    <BusinessAction />,
    '/settlements/TEST-s/dispute?status=confirmation',
    'settlements',
    ':id/dispute',
  );
  await user.type(
    await screen.findByLabelText('原因或处理说明 *'),
    'TEST金额有疑问',
  );
  await user.click(
    screen.getByRole('button', { name: '提出异议', exact: true }),
  );
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(screen.getByLabelText('原因或处理说明 *')).toHaveValue(
    'TEST金额有疑问',
  );
  await user.click(screen.getByRole('button', { name: '刷新' }));
  await waitFor(() =>
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
  );
  await user.click(
    screen.getByRole('button', { name: '提出异议', exact: true }),
  );
  await waitFor(() => expect(posts).toBe(2));
  expect(
    api.request.mock.calls
      .filter(([r]) => r.method === 'POST')
      .map(([r]) => r.json.expectedVersion),
  ).toEqual([1, 3]);
  await waitFor(() =>
    expect(screen.getByTestId('url')).toHaveTextContent(
      '/settlements/TEST-s?status=confirmation',
    ),
  );
});
it('renders settlement revenue, deductions and payment records as cards for review', async () => {
  api.request.mockResolvedValue({
    data: {
      id: 'TEST-s',
      number: 'TEST结算单',
      status: 'confirmation',
      version: 1,
      amountCents: '9000',
      confirmationModes: ['online'],
      payload: {
        start: '2026-10-01',
        end: '2026-10-15',
        amounts: { turnover: '100', fee: '10', payable: '90' },
        contract: {
          method: 'fixed',
          fixedFee: '10',
          basis: 'receipts',
          cycle: 'half',
          start: '2026-10-01',
          end: '2026-10-31',
        },
        revenues: [report],
        expenses: [
          {
            ...report,
            id: 'TEST-e',
            number: 'TEST费用',
            payload: {
              amount: '5',
              category: 'water',
              responsibility: 'company',
            },
          },
        ],
      },
      payments: [
        {
          reference: 'TEST付款',
          date: '2026-10-20',
          amount: '20',
          actor: 'TEST财务',
        },
      ],
      events: [],
    },
  });
  mount(
    <BusinessDetail kindOverride='settlements' />,
    '/settlements/TEST-s',
    'settlements',
    ':id',
  );
  expect(
    await screen.findByRole('heading', { name: 'TEST结算单', level: 1 }),
  ).toBeVisible();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: report.number })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'TEST费用' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'TEST付款' })).toBeVisible();
  expect(screen.getByText(/请先核对本期营业额/)).toBeVisible();
});
it('groups report editing, retains decimal and Chinese drafts after save failure, then returns to the same filter', async () => {
  const user = userEvent.setup();
  let writes = 0;
  api.request.mockImplementation(async ({ path, method }) => {
    if (method === 'PATCH') {
      writes++;
      if (writes === 1) throw new TypeError('TEST offline');
      return { data: { ...report, version: 2 } };
    }
    if (path === 'merchants')
      return {
        data: [{ id: 'TEST-merchant', name: 'TEST商户', number: 'TEST-M' }],
        meta: { total: 1 },
      };
    if (path.startsWith('merchants/'))
      return {
        data: { id: 'TEST-merchant', name: 'TEST商户', number: 'TEST-M' },
      };
    return { data: report };
  });
  mount(
    <BusinessForm />,
    '/revenueReports/edit/TEST-report?q=TEST&status=returned',
    'revenueReports',
    'edit/:id',
  );
  expect(
    await screen.findByRole('heading', { name: '营业金额' }),
  ).toBeVisible();
  const receipts = await screen.findByLabelText(/^实收金额/);
  expect(receipts).toHaveAttribute('inputmode', 'decimal');
  const notes = screen.getByLabelText('备注');
  await user.clear(notes);
  await user.type(notes, 'TEST手机补报说明');
  await user.click(screen.getByRole('button', { name: '保存', exact: true }));
  await screen.findByRole('alert');
  expect(notes).toHaveValue('TEST手机补报说明');
  await user.click(screen.getByRole('button', { name: '保存', exact: true }));
  await waitFor(() => expect(writes).toBe(2));
  await waitFor(() =>
    expect(screen.getByTestId('url')).toHaveTextContent(
      '/revenueReports?q=TEST&status=returned',
    ),
  );
  expect(
    api.request.mock.calls
      .filter(([r]) => r.method === 'PATCH')
      .every(([r]) => r.json.values.notes === 'TEST手机补报说明'),
  ).toBe(true);
});

it('shows frozen amounts before online confirmation and prevents duplicate touch submissions', async () => {
  const user = userEvent.setup();
  let finish: ((v: unknown) => void) | undefined;
  api.request.mockImplementation(async ({ method }) =>
    method === 'POST'
      ? await new Promise((resolve) => {
          finish = resolve;
        })
      : {
          data: {
            id: 'TEST-s',
            number: 'TEST结算单',
            status: 'confirmation',
            version: 4,
            confirmationModes: ['online'],
            payload: {
              start: '2026-10-01',
              end: '2026-10-15',
              amounts: {
                turnover: '100',
                fee: '10',
                rent: '0',
                deductions: '0',
                payable: '90',
              },
            },
          },
        },
  );
  mount(<BusinessAction />, '/settlements/TEST-s/confirm?status=confirmation');
  expect(await screen.findByText(/请先核对本期营业额/)).toBeVisible();
  expect(screen.getByText('¥90.00')).toBeVisible();
  const button = screen.getByRole('button', { name: '确认', exact: true });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  expect(button).toBeDisabled();
  expect(
    screen.getByRole('button', { name: '取消', exact: true }),
  ).toBeDisabled();
  await user.click(button);
  expect(
    api.request.mock.calls.filter(([r]) => r.method === 'POST'),
  ).toHaveLength(1);
  expect(
    api.request.mock.calls.find(([r]) => r.method === 'POST')?.[0].json,
  ).toMatchObject({ confirmation: 'online', expectedVersion: 4 });
  finish?.({ data: { id: 'TEST-s', version: 5 } });
  await waitFor(() =>
    expect(screen.getByTestId('url')).toHaveTextContent(
      '/settlements/TEST-s?status=confirmation',
    ),
  );
});

it('hides direct confirmation without permission and explains unavailable confirmation modes', async () => {
  state.can = false;
  const row = {
    id: 'TEST-s',
    number: 'TEST结算单',
    status: 'confirmation',
    version: 1,
    confirmationModes: ['online'],
    payload: {},
  };
  api.request.mockResolvedValue({ data: row });
  const view = mount(<BusinessAction />, '/settlements/TEST-s/confirm');
  await screen.findByLabelText('确认方式 *');
  expect(
    screen.queryByRole('button', { name: '确认', exact: true }),
  ).not.toBeInTheDocument();
  expect(api.request.mock.calls.some(([r]) => r.method === 'POST')).toBe(false);
  view.unmount();
  state.can = true;
  api.request.mockResolvedValue({ data: { ...row, confirmationModes: [] } });
  mount(<BusinessAction />, '/settlements/TEST-s/confirm');
  expect(await screen.findByText(/当前确认方式不可用/)).toBeVisible();
  expect(
    screen.getByRole('button', { name: '确认', exact: true }),
  ).toBeDisabled();
});
it.each([403, 404])(
  'removes cached detail actions after refresh returns %s',
  async (status) => {
    const user = userEvent.setup();
    let fail = false;
    api.request.mockImplementation(async () => {
      if (fail)
        throw new ApiClientError('TEST denied', {
          status,
          reason: status === 404 ? 'RECORD_NOT_FOUND' : 'ACCESS_DENIED',
        });
      return {
        data: {
          id: 'TEST-s',
          number: 'TEST结算单',
          status: 'confirmation',
          version: 1,
          amountCents: '0',
          confirmationModes: ['online'],
          payload: {
            amounts: { payable: '0' },
            contract: {},
            revenues: [],
            expenses: [],
          },
          events: [],
        },
      };
    });
    mount(
      <BusinessDetail kindOverride='settlements' />,
      '/settlements/TEST-s',
      'settlements',
      ':id',
    );
    await screen.findByRole('button', { name: '确认', exact: true });
    fail = true;
    await user.click(screen.getByRole('button', { name: '刷新' }));
    await screen.findByRole('alert');
    expect(
      screen.queryByRole('button', { name: '确认', exact: true }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '提出异议', exact: true }),
    ).not.toBeInTheDocument();
  },
);
it('clears submitted dispute validation as Chinese input is corrected', async () => {
  const user = userEvent.setup();
  api.request.mockResolvedValue({
    data: {
      id: 'TEST-s',
      number: 'TEST结算单',
      status: 'confirmation',
      version: 1,
      confirmationModes: ['online'],
      payload: {},
    },
  });
  mount(
    <BusinessAction />,
    '/settlements/TEST-s/dispute',
    'settlements',
    ':id/dispute',
  );
  const text = await screen.findByLabelText('原因或处理说明 *');
  const submit = screen.getByRole('button', { name: '提出异议', exact: true });
  await waitFor(() => expect(submit).toBeEnabled());
  await user.click(submit);
  expect(text).toHaveFocus();
  expect(screen.getByText('请填写此项。')).toBeVisible();
  await user.type(text, 'TEST手机输入');
  expect(screen.queryByText('请填写此项。')).not.toBeInTheDocument();
  expect(api.request.mock.calls.some(([r]) => r.method === 'POST')).toBe(false);
});
