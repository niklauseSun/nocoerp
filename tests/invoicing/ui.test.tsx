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
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import zh from '../../client/locales/zh-CN.js';
import InvoiceList from '../../client/pages/invoicing/list.js';
import Backfill from '../../client/pages/invoicing/backfill.js';
import { ChildTable } from '../../client/pages/invoicing/common.js';
import InvoiceAction from '../../client/pages/invoicing/action.js';
const { api, toaster, can } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  toaster: { show: vi.fn() },
  can: { value: true },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => toaster,
  useNavigationGuard: vi.fn(),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationRevision: () => 0,
  useCan: () => ({ can: can.value }),
}));
const runtime = await createTestI18nRuntime({
  locale: 'zh-CN',
  application: { namespace: 'nocoerp', resources: zh },
});
function Where() {
  const l = useLocation();
  return <output>{l.pathname + l.search}</output>;
}
function mount(
  element: React.ReactNode,
  path = '/invoicing/sources',
  route = '/invoicing/sources',
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
            <Route
              path={route}
              element={
                <>
                  {element}
                  <Where />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </TestI18nProvider>,
  );
}
afterEach(cleanup);
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  api.request.mockReset();
  toaster.show.mockReset();
  can.value = true;
});
it('shows the true empty state once and keeps typed query while paginating', async () => {
  api.request.mockImplementation(
    async ({ query }: { query?: Record<string, string | number> }) => ({
      data: query?.q
        ? [
            {
              id: 's',
              number: 'SIM-T-1',
              version: 1,
              allowedActions: ['invoiceIssue'],
              availableCents: '100',
              requiredRedCents: '0',
              paidCents: '100',
              netIssuedCents: '0',
              status: 'ready',
              updatedAt: '2026-10-18',
              payload: {
                merchantName: '测试',
                contractNumber: 'C',
                billNumber: 'B',
              },
            },
          ]
        : [],
      meta: {
        page: Number(query?.page ?? 1),
        pageSize: 20,
        total: query?.q ? 21 : 0,
      },
    }),
  );
  mount(<InvoiceList />);
  expect(
    await screen.findByRole('button', { name: '补建开票任务' }),
  ).toBeVisible();
  expect(screen.getAllByRole('button', { name: '补建开票任务' })).toHaveLength(
    1,
  );
  const search = screen.getByPlaceholderText('搜索任务、商户、合同或账单');
  await userEvent.type(search, 'abc');
  await waitFor(() => expect(screen.getByText('SIM-T-1')).toBeVisible());
  expect(search).toHaveValue('abc');
  fireEvent.compositionStart(search);
  fireEvent.change(search, { target: { value: 'abc中文' } });
  fireEvent.compositionEnd(search, { data: '中文' });
  await userEvent.click(screen.getByRole('button', { name: '下一页' }));
  expect(screen.getByText(/\/invoicing\/sources\?q=abc/)).toHaveTextContent(
    'page=2',
  );
});
it('does not request invoice records without the business right', () => {
  can.value = false;
  mount(<InvoiceList />);
  expect(screen.getByText('无权查看或办理，请联系管理员。')).toBeVisible();
  expect(api.request).not.toHaveBeenCalled();
});
it('red preview is read-only; only the destructive named confirmation writes', async () => {
  const invoice = {
    id: 'i',
    number: 'SIM-B-DEMO',
    version: 1,
    payload: { buyer: { name: '买方' }, seller: { name: '销方' } },
    lines: {
      data: [{ id: 'l', feeType: 'rent', remainingCents: '10000' }],
      meta: { page: 1, pageSize: 20, total: 1 },
    },
  };
  api.request.mockImplementation(async ({ path }: { path: string }) => ({
    data: path.endsWith('/previewRed')
      ? {
          previewHash: 'hash',
          expectedSources: [],
          grossCents: '5000',
          netCents: '5000',
          taxCents: '0',
        }
      : path.endsWith('/red')
        ? { outcome: 'failed', invoice: null }
        : invoice,
  }));
  mount(
    <InvoiceAction />,
    '/invoicing/invoices/i/red',
    '/invoicing/invoices/:invoiceId/red',
  );
  await screen.findByRole('heading', { name: '模拟红冲' });
  await userEvent.click(
    screen.getByRole('button', { name: '预览', exact: true }),
  );
  expect(screen.getAllByText('请填写此字段。')).toHaveLength(2);
  const amount = screen.getByLabelText(/租金/);
  await userEvent.clear(amount);
  await userEvent.type(amount, '50');
  await userEvent.type(screen.getByLabelText('原因 *'), '退款');
  await userEvent.type(screen.getByLabelText('依据 / 凭证 *'), '演示');
  expect(screen.queryByText('请填写此字段。')).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('button', { name: '预览', exact: true }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: '模拟红冲', exact: true }),
    ).toBeEnabled(),
  );
  expect(
    api.request.mock.calls.filter(([r]) => r.path.endsWith('/red')),
  ).toHaveLength(0);
  await userEvent.click(
    screen.getByRole('button', { name: '模拟红冲', exact: true }),
  );
  expect(await screen.findByRole('alertdialog')).toHaveTextContent(
    'SIM-B-DEMO',
  );
  expect(screen.getByRole('alertdialog')).toHaveTextContent('不能撤回');
  await userEvent.click(
    screen.getAllByRole('button', { name: '模拟红冲', exact: true }).at(-1)!,
  );
  await waitFor(() =>
    expect(
      api.request.mock.calls.filter(([r]) => r.path.endsWith('/red')),
    ).toHaveLength(1),
  );
});

it('distinguishes restricted cash from an empty authorized subtable', () => {
  mount(
    <ChildTable
      name='cash'
      page={{
        data: [],
        meta: { page: 1, pageSize: 20, total: 0 },
        restricted: true,
      }}
      columns={['number']}
      set={() => {}}
    />,
  );
  expect(screen.getByText('无权查看或办理，请联系管理员。')).toBeVisible();
  expect(screen.queryByText('暂无记录')).not.toBeInTheDocument();
});
it('revalidates backfill reason after the first attempt', async () => {
  api.request.mockResolvedValue({
    data: [],
    meta: { page: 1, pageSize: 20, total: 0 },
  });
  mount(
    <Backfill />,
    '/invoicing/sources/backfill',
    '/invoicing/sources/backfill',
  );
  await userEvent.click(
    screen.getByRole('button', { name: '预览', exact: true }),
  );
  expect(screen.getAllByText('请填写此字段。')).toHaveLength(2);
  await userEvent.type(screen.getByLabelText('原因 *'), '补建');
  expect(screen.getAllByText('请填写此字段。')).toHaveLength(1);
});
it('configuration list separates the contract, merchant, buyer and seller', async () => {
  api.request.mockResolvedValue({
    data: [
      {
        id: 'c',
        contractId: 'contract',
        contractNumber: 'HT-DEMO',
        merchantName: '商户示例',
        version: 1,
        enabled: true,
        autoIssue: true,
        updatedAt: '2026-10-18',
        allowedActions: ['invoiceConfigure'],
        searchText: 'MUST NOT SHOW',
        payload: { buyer: { name: '购方示例' }, seller: { name: '销方示例' } },
      },
    ],
    meta: { page: 1, pageSize: 20, total: 1 },
  });
  mount(<InvoiceList />, '/invoicing/configs', '/invoicing/configs');
  expect(await screen.findByRole('link', { name: 'HT-DEMO' })).toBeVisible();
  expect(screen.getByText('商户示例')).toBeVisible();
  expect(screen.getByText('购方示例')).toBeVisible();
  expect(screen.getByText('销方示例')).toBeVisible();
  expect(screen.queryByText('MUST NOT SHOW')).not.toBeInTheDocument();
});

vi.mock('@nocobase/app-plugin-authentication/client', async (original) => ({
  ...(await original<
    typeof import('@nocobase/app-plugin-authentication/client')
  >()),
  useAuthentication: () => ({ session: { user: { id: 'business-test' } } }),
}));

it('searches a source bill in one input with merchant, contract and period and clears its preview', async () => {
  const bill = {
    id: 'bill-a',
    number: 'ZD-001',
    merchantName: '商户甲',
    contractNumber: 'HT-001',
    start: '2026-10-01',
    end: '2026-10-31',
    payload: { contract: { title: '十月租赁合同', number: 'HT-001' } },
  };
  api.request.mockImplementation(async (r) =>
    r.path === 'invoiceSources/preview'
      ? {
          data: {
            sourceHash: 'hash',
            paidCents: '10000',
            netIssuedCents: '0',
            availableCents: '10000',
            requiredRedCents: '0',
          },
        }
      : { data: [bill], meta: { page: 1, pageSize: 20, total: 1 } },
  );
  mount(
    <Backfill />,
    '/invoicing/sources/backfill',
    '/invoicing/sources/backfill',
  );
  const user = userEvent.setup(),
    input = screen.getByRole('combobox', { name: '来源账单 *' });
  expect(screen.getByPlaceholderText('搜索账单编号、商户或合同')).toBe(input);
  await user.type(input, '十月');
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'bills',
        query: expect.objectContaining({ q: '十月' }),
      }),
    ),
  );
  await user.click(
    await screen.findByRole('option', {
      name: 'ZD-001 · 商户甲 · 十月租赁合同 · HT-001 · 2026-10-01 – 2026-10-31',
    }),
  );
  await user.type(screen.getByLabelText('原因 *'), '历史收款补建');
  await user.click(screen.getByRole('button', { name: '预览', exact: true }));
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'invoiceSources/preview',
        json: { billId: 'bill-a' },
      }),
    ),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: '补建开票任务', exact: true }),
    ).toBeEnabled(),
  );
  await user.click(screen.getByRole('button', { name: '清空来源账单选择' }));
  expect(input).toHaveValue('');
  expect(input).toHaveFocus();
  expect(
    screen.getByRole('button', { name: '补建开票任务', exact: true }),
  ).toBeDisabled();
});

it('keeps a selected source bill caption across pages while suppressing stale loading options', async () => {
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  api.request.mockImplementation(async (r) =>
    r.query?.page === 2
      ? pending
      : {
          data: [
            {
              id: 'a',
              number: 'ZD-A',
              merchantName: null,
              contractNumber: 'HT-A',
              payload: { contract: {} },
            },
          ],
          meta: { page: 1, pageSize: 20, total: 21 },
        },
  );
  mount(
    <Backfill />,
    '/invoicing/sources/backfill',
    '/invoicing/sources/backfill',
  );
  const user = userEvent.setup(),
    input = screen.getByRole('combobox', { name: '来源账单 *' });
  await user.click(input);
  await user.click(await screen.findByRole('option', { name: 'ZD-A · HT-A' }));
  await user.click(input);
  await user.click(screen.getByRole('button', { name: '下一页', exact: true }));
  expect(screen.queryByRole('option', { name: 'ZD-A · HT-A' })).toBeNull();
  expect(input).toHaveValue('ZD-A · HT-A');
  finish({
    data: [{ id: 'b', number: 'ZD-B', merchantName: '商户乙' }],
    meta: { page: 2, pageSize: 20, total: 21 },
  });
  expect(
    await screen.findByRole('option', { name: 'ZD-B · 商户乙' }),
  ).toBeVisible();
  expect(input).toHaveValue('ZD-A · HT-A');
});
