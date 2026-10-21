import Refund from '../../client/pages/cashier/refund.js';
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
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import zh from '../../client/locales/zh-CN.js';
import CashierContract from '../../client/pages/cashier/contract.js';
import Checkout from '../../client/pages/cashier/checkout.js';
import Reconciliation from '../../client/pages/cashier/reconciliation.js';
import CashierAction from '../../client/pages/cashier/action.js';
const { api, can, toaster } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  can: { value: true, denied: new Set<string>() },
  toaster: { show: vi.fn() },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => toaster,
  useNavigationGuard: vi.fn(),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationRevision: () => 0,
  useCan: ({ action }: { action: string }) => ({
    can: can.value && !can.denied.has(action),
  }),
}));
vi.mock('../../client/pages/hyl/common.js', async (original) => ({
  ...(await original<typeof import('../../client/pages/hyl/common.js')>()),
  RecordPicker: ({
    id,
    value,
    onChange,
    disabled,
  }: {
    id: string;
    value: string;
    onChange: (v: string) => void;
    disabled: boolean;
  }) => (
    <input
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));
const runtime = await createTestI18nRuntime({
  locale: 'zh-CN',
  application: { namespace: 'nocoerp', resources: zh },
});
function mount(element: React.ReactNode, path: string) {
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
              path='/cashier/orders'
              element={
                <>
                  <p>收银单列表</p>
                  <Outlet />
                </>
              }
            >
              <Route path='new' element={element} />
              <Route path=':orderId/edit' element={element} />
              <Route path=':orderId/void' element={element} />
              <Route path=':orderId' element={<p>登记完成</p>} />
            </Route>
            <Route path='*' element={element} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </TestI18nProvider>,
  );
}
const bill = {
  id: 'b1',
  number: 'ZD-TEST',
  contractId: 'c1',
  merchantId: 'm1',
  version: 2,
  remainingCents: '100000',
  lease: { version: 0, status: 'active' },
  payload: { contract: { number: 'HT-TEST' } },
};
beforeEach(() => {
  can.value = true;
  can.denied.clear();
  api.request.mockReset();
  toaster.show.mockReset();
  api.request.mockImplementation(async ({ path }: { path: string }) =>
    path === 'bills'
      ? { data: [bill], meta: { total: 1, page: 1, pageSize: 10 } }
      : path === 'bills/b1'
        ? { data: bill }
        : {
            data: {
              id: 'o1',
              number: 'SY-TEST',
              version: 0,
              status: 'draft',
              allowedActions: ['cashierReverse'],
              payload: {},
            },
          },
  );
});
afterEach(cleanup);
it('preserves checkout input and a saved draft identity when posting has an uncertain failure', async () => {
  mount(<Checkout />, '/cashier/orders/new');
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('商户 *'), 'm1');
  await user.click(screen.getByRole('combobox', { name: '已选账单' }));
  await user.click(await screen.findByRole('option', { name: /ZD-TEST/ }));
  await screen.findByText(/ZD-TEST · HT-TEST/);
  await user.click(screen.getByRole('button', { name: '添加实收分笔' }));
  const amounts = screen.getAllByLabelText('金额 *');
  await user.clear(amounts[0]);
  await user.type(amounts[0], '600');
  await user.type(amounts[1], '600');
  await user.type(screen.getByLabelText('支付流水号 *'), 'CASH-TEST');
  await user.type(screen.getByLabelText('凭证 *'), '模拟银行回单');
  await user.type(screen.getByLabelText('分合同金额 · HT-TEST *'), '600');
  let posts = 0;
  const writes: Record<string, unknown>[] = [];
  api.request.mockImplementation(
    async (request: {
      path: string;
      method?: string;
      json?: Record<string, unknown>;
    }) => {
      if (request.method === 'POST')
        writes.push(request as unknown as Record<string, unknown>);
      if (request.path === 'cashierOrders/preview')
        return {
          data: {
            receivedCents: '60000',
            allocatedCents: '60000',
            depositCents: '0',
            unusedCents: '0',
            contracts: [
              {
                contractId: 'c1',
                receivedCents: '60000',
                allocatedCents: '60000',
                depositCents: '0',
                unusedCents: '0',
              },
            ],
          },
        };
      if (request.path === 'cashierOrders')
        return {
          data: { id: 'o1', number: 'SY-TEST', version: 0, status: 'draft' },
        };
      if (request.path === 'cashierOrders/o1/post') {
        posts++;
        if (posts === 1)
          throw new ApiClientError('uncertain', {
            status: 500,
            method: 'POST',
            url: '/cashierOrders/o1/post',
          });
        return {
          data: { id: 'o1', number: 'SY-TEST', version: 3, status: 'posted' },
        };
      }
      return { data: [bill], meta: { total: 1, page: 1, pageSize: 10 } };
    },
  );
  await user.click(screen.getByRole('button', { name: '预览', exact: true }));
  expect(await screen.findByText('分合同预览')).toBeInTheDocument();
  await user.click(
    await screen.findByRole('button', { name: '登记', exact: true }),
  );
  let confirm = await screen.findByRole('alertdialog');
  await user.click(
    within(confirm).getByRole('button', { name: '登记', exact: true }),
  );
  await waitFor(() => expect(posts).toBe(1));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: '登记', exact: true }),
    ).not.toBeDisabled(),
  );
  await user.click(screen.getByRole('button', { name: '登记', exact: true }));
  confirm = await screen.findByRole('alertdialog');
  await user.click(
    within(confirm).getByRole('button', { name: '登记', exact: true }),
  );
  await screen.findByText('登记完成');
  expect(writes.filter((r) => r.path === 'cashierOrders')).toHaveLength(1);
  const calls = writes.filter((r) => r.path === 'cashierOrders/o1/post');
  expect(calls).toHaveLength(2);
  expect(calls[0].json).toEqual(calls[1].json);
});
it('renders fixed dialog footer and revalidates missing evidence after submit', async () => {
  mount(<CashierAction />, '/cashier/orders/o1/void');
  const user = userEvent.setup();
  const reason = await screen.findByLabelText('原因 *');
  const submit = screen.getByRole('button', { name: '作废', exact: true });
  expect(submit.closest('form')).toBeNull();
  expect(submit).toHaveAttribute('form', reason.closest('form')!.id);
  await user.click(submit);
  await waitFor(() => expect(reason).toHaveFocus());
  await user.type(reason, '错误登记');
  expect(reason).toHaveAttribute('aria-invalid', 'false');
  expect(screen.getByLabelText('凭证 *')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
});
it('invalidates reconciliation preview when scope or day changes and rejects a nonzero unexplained difference', async () => {
  api.request.mockResolvedValue({
    data: {
      day: '2026-10-18',
      scope: 'own',
      sourceHash: 'a'.repeat(64),
      cashCents: '20000',
      netCents: '20000',
      receivedCents: '20000',
      refundedCents: '0',
      events: [],
      channels: {},
      unclassified: false,
    },
  });
  mount(<Reconciliation />, '/cashier/reconciliations/new');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '预览', exact: true }));
  await user.type(await screen.findByLabelText('实盘现金 *'), '199');
  await user.type(screen.getByLabelText('凭证 *'), '盘点单');
  await user.click(
    screen.getByRole('button', { name: '确认核对', exact: true }),
  );
  expect(
    await screen.findByText('差额不为零，请填写原因。'),
  ).toBeInTheDocument();
  expect(
    api.request.mock.calls.filter(([r]) => r.method === 'POST'),
  ).toHaveLength(0);
});

it('explains denied direct checkout and hides the form when receipt capability is missing', async () => {
  can.denied.add('receiptReceive');
  mount(<Checkout />, '/cashier/orders/new');
  expect(await screen.findByText(zh.billing.restricted)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '返回' })).toHaveAttribute(
    'href',
    '/cashier/orders',
  );
  expect(
    screen.queryByRole('button', { name: '预览' }),
  ).not.toBeInTheDocument();
  expect(api.request).not.toHaveBeenCalled();
});

it('refreshes both the source contract and its independent lease summary', async () => {
  let summaries = 0;
  api.request.mockImplementation(async ({ path }: { path: string }) =>
    path.endsWith('/leaseSummary')
      ? { data: { status: ++summaries === 1 ? 'terminated' : 'closed' } }
      : {
          data: { id: 'c1', number: 'HT-SOURCE', payload: { title: 'source' } },
        },
  );
  mount(<CashierContract />, '/cashier/source-contract');
  const user = userEvent.setup();
  await screen.findByText(zh.lease.states.terminated);
  await user.click(screen.getByRole('button', { name: '刷新' }));
  await screen.findByText('已结清归档');
  expect(summaries).toBe(2);
});

vi.mock('@nocobase/app-plugin-authentication/client', async (original) => ({
  ...(await original<
    typeof import('@nocobase/app-plugin-authentication/client')
  >()),
  useAuthentication: () => ({ session: { user: { id: 'business-test' } } }),
}));

it('can clear a full checkout selection and its contract splits while preserving the payment amount', async () => {
  const targets = Array.from({ length: 50 }, (_, i) => ({
    billId: 'b' + i,
    contractId: 'c' + i,
    expectedBillVersion: 1,
    expectedLeaseVersion: 0,
    amount: '1',
    deposit: '0',
  }));
  const payments = [
    {
      key: 'p',
      method: 'cash',
      amount: '50',
      reference: '',
      evidence: 'cash',
      splits: targets.map((r) => ({ contractId: r.contractId, amount: '1' })),
    },
  ];
  api.request.mockImplementation(async (r) =>
    r.path === 'cashierOrders/o1'
      ? {
          data: {
            id: 'o1',
            number: 'SY-CAP',
            version: 1,
            status: 'draft',
            payload: {
              input: {
                merchantId: 'm1',
                date: '2026-10-20',
                notes: '',
                targets,
                payments,
              },
            },
          },
        }
      : { data: [], meta: { page: 1, pageSize: 10, total: 0 } },
  );
  mount(<Checkout />, '/cashier/orders/o1/edit');
  const user = userEvent.setup();
  const source = await screen.findByRole('combobox', { name: '已选账单' });
  expect(source).toBeEnabled();
  expect(screen.getByLabelText('分合同金额 · c0 *')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '清空已选账单选择' }));
  expect(screen.queryByLabelText('分合同金额 · c0 *')).toBeNull();
  expect(screen.getByLabelText('金额 *')).toHaveValue('50');
  expect(source).toHaveFocus();
});

it('clears twenty refund receipt sources at the cap and keeps independent refund fields', async () => {
  const receipts = Array.from({ length: 20 }, (_, i) => ({
    id: 'r' + i,
    number: 'SK-' + i,
    allowedActions: [],
    merchantName: '商户甲',
    contractNumber: 'HT-' + i,
    contractTitle: '合同' + i,
    version: 1,
    status: 'active',
    unusedCents: '100',
    payload: { method: 'cash' },
    entries: [],
  }));
  api.request.mockImplementation(async (r) =>
    r.path === 'receipts'
      ? { data: receipts, meta: { page: 1, pageSize: 20, total: 20 } }
      : { data: receipts.find((row) => 'receipts/' + row.id === r.path) },
  );
  mount(<Refund />, '/cashier/refunds/new');
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('商户 *'), 'm1');
  await user.type(screen.getByLabelText('原因 *'), '演示退款');
  for (let i = 0; i < 20; i++) {
    const source = screen.getByRole('combobox', { name: '来源明细' });
    await user.click(source);
    await user.click(
      await screen.findByRole('option', {
        name: new RegExp('^SK-' + i + ' ·'),
      }),
    );
    await waitFor(() => expect(source).toBeEnabled());
  }
  const source = screen.getByRole('combobox', { name: '来源明细' });
  expect(source).toBeEnabled();
  await user.click(screen.getByRole('button', { name: '清空来源明细选择' }));
  expect(screen.queryByText('SK-0 · 现金')).toBeNull();
  expect(screen.getByLabelText('原因 *')).toHaveValue('演示退款');
  expect(source).toHaveFocus();
});
