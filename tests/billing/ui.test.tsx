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
import { useState } from 'react';
import zh from '../../client/locales/zh-CN.js';
import BillingForm from '../../client/pages/billing/form.js';
import BillingAction from '../../client/pages/billing/action.js';
import BillingDetail from '../../client/pages/billing/detail.js';
import { BillingContractCard } from '../../client/pages/billing/contract-card.js';
import { Search } from '../../client/pages/billing/common.js';
const { api, can, toaster } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  can: { value: true },
  toaster: { show: vi.fn() },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => toaster,
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationRevision: () => 0,
  useCan: () => ({ can: can.value }),
}));
const runtime = await createTestI18nRuntime({
  locale: 'zh-CN',
  application: { namespace: 'nocoerp', resources: zh },
});
const receipt = {
  id: 'r1',
  number: 'SK-TEST',
  contractId: 'c1',
  version: 0,
  status: 'received',
  unusedCents: '100000',
  lease: { version: 0, status: 'active' },
  entries: [],
};
function mount(element: React.ReactNode, path = '/billing/receipts/new') {
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
              path='/billing/receipts'
              element={
                <>
                  <p>收款列表</p>
                  <Outlet />
                </>
              }
            >
              <Route path='new' element={element} />
              <Route path=':receiptId/allocate' element={element} />
            </Route>
            <Route path='/billing/bills/new' element={element} />
            <Route path='/billing/bills/:billId' element={<BillingDetail />}>
              <Route
                path='receiptDetail/:receiptId'
                element={<BillingDetail />}
              />
            </Route>
            <Route path='*' element={element} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </TestI18nProvider>,
  );
}
beforeEach(() => {
  can.value = true;
  api.request.mockReset();
  toaster.show.mockReset();
  api.request.mockImplementation(
    async ({ path, method }: { path: string; method?: string }) => {
      if (method === 'POST') return { data: { id: 'r-new', number: 'SK-NEW' } };
      if (path === 'receipts/r1') return { data: receipt };
      if (path === 'bills')
        return {
          data: [
            {
              id: 'b1',
              number: 'ZD-TEST',
              version: 3,
              remainingCents: '120000',
              start: '2026-08-17',
              end: '2026-08-31',
            },
          ],
          meta: { total: 1, page: 1, pageSize: 20 },
        };
      if (path === 'contracts/c1')
        return {
          data: {
            id: 'c1',
            number: 'HT-TEST',
            lease: { version: 0, status: 'active' },
          },
        };
      return { data: [], meta: { total: 0, page: 1, pageSize: 20 } };
    },
  );
});
afterEach(cleanup);
it('validates receipt registration and retries uncertain failures using the same request id', async () => {
  mount(<BillingAction />, '/billing/receipts/new?contractId=c1');
  const user = userEvent.setup();
  await screen.findByLabelText('金额 *');
  await user.click(screen.getByRole('button', { name: '登记收款' }));
  expect(
    api.request.mock.calls.filter(([r]) => r.method === 'POST'),
  ).toHaveLength(0);
  await user.type(screen.getByLabelText('金额 *'), '800');
  await user.type(screen.getByLabelText('支付流水号 *'), 'DEMO-R');
  await user.type(screen.getByLabelText('凭证 *'), '线下演示凭证');
  const failure = new ApiClientError('Failed', {
    status: 500,
    method: 'POST',
    url: '/receipts',
  });
  api.request.mockRejectedValueOnce(failure);
  await user.click(screen.getByRole('button', { name: '登记收款' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('支付流水号 *')).toHaveValue('DEMO-R');
  await user.click(screen.getByRole('button', { name: '登记收款' }));
  await waitFor(() =>
    expect(
      api.request.mock.calls.filter(([r]) => r.method === 'POST'),
    ).toHaveLength(2),
  );
  const writes = api.request.mock.calls.filter(([r]) => r.method === 'POST');
  expect(writes[1][0].json.requestId).toBe(writes[0][0].json.requestId);
  expect(writes[1][0].json.expectedLeaseVersion).toBe(0);
});
it('retains an allocation after cancelling confirmation and submits explicit amount/version', async () => {
  mount(<BillingAction />, '/billing/receipts/r1/allocate');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('combobox', { name: '来源单据' }));
  await user.click(await screen.findByRole('option', { name: /ZD-TEST/ }));
  const amount = await screen.findByLabelText('ZD-TEST · 金额 *');
  await user.clear(amount);
  await user.type(amount, '600');
  await user.click(screen.getByRole('button', { name: '核销', exact: true }));
  let confirm = await screen.findByRole('alertdialog');
  expect(within(confirm).getByText('核销收款“SK-TEST”？')).toBeInTheDocument();
  await user.click(within(confirm).getByRole('button', { name: '取消' }));
  expect(amount).toHaveValue('600');
  expect(
    api.request.mock.calls.filter(([r]) => r.method === 'POST'),
  ).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: '核销', exact: true }));
  confirm = await screen.findByRole('alertdialog');
  await user.click(
    within(confirm).getByRole('button', { name: '核销', exact: true }),
  );
  await waitFor(() =>
    expect(
      api.request.mock.calls.filter(([r]) => r.method === 'POST'),
    ).toHaveLength(1),
  );
  const write = api.request.mock.calls.find(([r]) => r.method === 'POST')![0];
  expect(write.json.allocations).toEqual([
    { billId: 'b1', expectedBillVersion: 3, amount: '600' },
  ]);
});
it('does not request restricted billing summary data', async () => {
  can.value = false;
  mount(<BillingContractCard id='c1' />, '/contracts/c1');
  await screen.findByText('无权查看此项财务数据。');
  expect(api.request).not.toHaveBeenCalled();
});
it('places server field violations beneath their inputs and focuses the invalid field', async () => {
  mount(<BillingAction />, '/billing/receipts/new?contractId=c1');
  const user = userEvent.setup();
  await screen.findByLabelText('金额 *');
  await user.type(screen.getByLabelText('金额 *'), '1');
  await user.type(screen.getByLabelText('支付流水号 *'), 'INVALID-REFERENCE');
  await user.type(screen.getByLabelText('凭证 *'), '模拟凭证');
  api.request.mockRejectedValueOnce(
    new ApiClientError('Validation', {
      status: 400,
      method: 'POST',
      url: '/receipts',
      payload: {
        error: {
          fieldViolations: [
            { field: 'reference', description: 'Reference invalid' },
          ],
        },
      },
    }),
  );
  await user.click(screen.getByRole('button', { name: '登记收款' }));
  expect(
    await screen.findByText('请检查此项的格式或长度。'),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByLabelText('支付流水号 *')).toHaveFocus(),
  );
  expect(screen.getByLabelText('支付流水号 *')).toHaveValue(
    'INVALID-REFERENCE',
  );
});
it('keeps per-character and middle text edits while debouncing URL-style updates', async () => {
  function Example() {
    const [value, setValue] = useState('');
    return (
      <>
        <Search value={value} onChange={setValue} placeholder='搜索账单' />
        <output>{value}</output>
        <button onClick={() => setValue('')}>清空搜索</button>
      </>
    );
  }
  mount(<Example />, '/search');
  const user = userEvent.setup(),
    input = screen.getByPlaceholderText('搜索账单');
  await user.type(input, 'ZHONG');
  await user.keyboard('{ArrowLeft}{ArrowLeft}文');
  expect(input).toHaveValue('ZHO文NG');
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('ZHO文NG'),
  );
  await user.click(screen.getByRole('button', { name: '清空搜索' }));
  await waitFor(() => expect(input).toHaveValue(''));
});
it('keeps a bill as the parent when a receipt detail is opened over it', async () => {
  const fullBill = {
    id: 'b1',
    number: 'ZD-NESTED',
    contractId: 'c1',
    version: 1,
    status: 'issued',
    displayStatus: 'unpaid',
    start: '2026-08-17',
    end: '2026-08-31',
    date: '2026-08-17',
    dueDate: '2026-08-31',
    amountCents: '10000',
    remainingCents: '10000',
    allocatedCents: '0',
    depositCents: '0',
    allowedActions: ['receiptRead'],
    lease: { version: 0, status: 'active' },
    payload: {
      contract: { number: 'HT-NESTED' },
      config: { rentChannel: 'bill' },
      actor: 'Test',
      notes: '',
    },
    lines: [],
    linesMeta: { total: 0, page: 1, pageSize: 20 },
    ledger: [],
    ledgerMeta: { total: 0, page: 1, pageSize: 20 },
  };
  const fullReceipt = {
    ...receipt,
    displayStatus: 'unallocated',
    amountCents: '100000',
    allocatedCents: '100000',
    unusedCents: '0',
    refundedCents: '0',
    reference: 'R-NESTED',
    entries: [
      {
        id: 'a1',
        kind: 'allocate',
        billId: 'b1',
        sourceNumber: 'ZD-NESTED',
        amountCents: '100',
        payload: {},
        createdAt: '2026-08-31',
      },
    ],
    allowedActions: ['billingRead', 'receiptAllocate', 'receiptRefund'],
    date: '2026-08-31',
    payload: { method: 'bank', evidence: 'Test', notes: '', actor: 'Test' },
    entriesMeta: { total: 0, page: 1, pageSize: 20 },
  };
  api.request.mockImplementation(async ({ path }: { path: string }) => ({
    data:
      path === 'energyReadings' ||
      path === 'invoiceSources' ||
      path === 'invoices'
        ? []
        : path === 'bills/b1'
          ? fullBill
          : path === 'receipts'
            ? []
            : fullReceipt,
    ...(['receipts', 'energyReadings', 'invoiceSources', 'invoices'].includes(
      path,
    )
      ? { meta: { total: 0, page: 1, pageSize: 5 } }
      : {}),
  }));
  mount(<BillingDetail />, '/billing/bills/b1/receiptDetail/r1');
  expect(
    await screen.findByRole('heading', { name: '收款“SK-TEST”' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { name: '账单“ZD-NESTED”', hidden: true }),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'ZD-NESTED' })).toHaveAttribute(
    'href',
    '/billing/bills/b1',
  );
  expect(api.request.mock.calls.some(([r]) => r.path === 'bills/b1')).toBe(
    true,
  );
  expect(api.request.mock.calls.some(([r]) => r.path === 'receipts/r1')).toBe(
    true,
  );
  expect(
    screen.getByText(
      '未核销余额为零，无法继续核销或退款；如需更正，请先冲销对应流水。',
    ),
  ).toBeInTheDocument();
  const before = api.request.mock.calls.filter(
    ([r]) => r.path === 'receipts',
  ).length;
  await userEvent
    .setup()
    .click(screen.getAllByRole('button', { name: '刷新' }).at(-1)!);
  await waitFor(() =>
    expect(
      api.request.mock.calls.filter(([r]) => r.path === 'receipts').length,
    ).toBeGreaterThan(before),
  );
});

it('keeps invalid amount feedback while editing and puts dialog actions outside the form', async () => {
  mount(<BillingAction />, '/billing/receipts/new?contractId=c1');
  const user = userEvent.setup();
  const amount = await screen.findByLabelText('金额 *');
  const submit = screen.getByRole('button', { name: '登记收款' });
  expect(submit.closest('form')).toBeNull();
  expect(submit).toHaveAttribute('form', amount.closest('form')!.id);
  await user.click(submit);
  await user.type(amount, 'abc');
  expect(amount).toHaveAttribute('aria-invalid', 'true');
  await user.clear(amount);
  await user.type(amount, '1');
  expect(amount).not.toHaveAttribute('aria-invalid', 'true');
});
it('renders and focuses indexed allocation errors and revalidates their row', async () => {
  mount(<BillingAction />, '/billing/receipts/r1/allocate');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('combobox', { name: '来源单据' }));
  await user.click(await screen.findByRole('option', { name: /ZD-TEST/ }));
  const amount = await screen.findByLabelText('ZD-TEST · 金额 *');
  await user.clear(amount);
  await user.type(amount, '600');
  await user.click(screen.getByRole('button', { name: '核销', exact: true }));
  const confirm = await screen.findByRole('alertdialog');
  api.request.mockRejectedValueOnce(
    new ApiClientError('Validation', {
      status: 400,
      method: 'POST',
      url: '/receipts/r1/allocate',
      payload: {
        error: { fieldViolations: [{ field: 'allocations.0.amount' }] },
      },
    }),
  );
  await user.click(
    within(confirm).getByRole('button', { name: '核销', exact: true }),
  );
  await screen.findByText('请检查此项的格式或长度。');
  await waitFor(() => expect(amount).toHaveFocus());
  await user.clear(amount);
  await user.type(amount, 'abc');
  expect(amount).toHaveAttribute('aria-invalid', 'true');
  await user.clear(amount);
  await user.type(amount, '20');
  expect(amount).toHaveAttribute('aria-invalid', 'false');
});

vi.mock('@nocobase/app-plugin-authentication/client', async (original) => ({
  ...(await original<
    typeof import('@nocobase/app-plugin-authentication/client')
  >()),
  useAuthentication: () => ({ session: { user: { id: 'business-test' } } }),
}));

it('makes the payment reference optional for cash and required again for bank transfers', async () => {
  mount(<BillingAction />, '/billing/receipts/new?contractId=c1');
  const user = userEvent.setup();
  await screen.findByLabelText('支付流水号 *');
  await user.click(screen.getByRole('combobox', { name: '方式 *' }));
  await user.click(await screen.findByRole('option', { name: '现金' }));
  expect(screen.getByLabelText('支付流水号')).toBeInTheDocument();
  await user.type(screen.getByLabelText('金额 *'), '100');
  await user.type(screen.getByLabelText('凭证 *'), '现金收讫');
  await user.click(screen.getByRole('button', { name: '登记收款' }));
  await waitFor(() =>
    expect(api.request.mock.calls.some(([r]) => r.method === 'POST')).toBe(
      true,
    ),
  );
});

it('previews manual fees without a source document and labels their charge basis', async () => {
  api.request.mockImplementation(async ({ path }) => {
    if (path === 'contracts/c1/billingConfig')
      return {
        data: {
          contract: {
            id: 'c1',
            number: 'HT-TEST',
            version: 0,
            start: '2026-08-01',
            end: '2026-08-31',
            cycle: 'month',
            rent: '0',
          },
          lease: { status: 'active', version: 0 },
          version: 1,
          assets: [],
          history: [
            {
              version: 1,
              effectiveFrom: '2026-08-01',
              payload: {
                effectiveFrom: '2026-08-01',
                rentChannel: 'settlement',
                property: { enabled: false, method: 'fixed', price: '0' },
                utilities: {},
                meters: [],
              },
            },
          ],
        },
      };
    if (path.endsWith('/previewBill'))
      return {
        data: { lines: [], warnings: [], total: '100', config: { version: 1 } },
      };
    return { data: [], meta: { total: 0, page: 1, pageSize: 20 } };
  });
  mount(<BillingForm />, '/billing/bills/new?contractId=c1');
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: '添加 · 其他费用' }),
  );
  expect(
    screen.getByLabelText('来源单号（选填，留空自动生成费用编号）'),
  ).toHaveValue('');
  await user.type(screen.getByLabelText('费用名称 *'), '维修费');
  await user.type(screen.getByLabelText('金额 *'), '100');
  await user.type(screen.getByLabelText('原因 *'), '维修');
  await user.type(screen.getByLabelText('收费依据 *'), '维修确认单');
  await user.click(screen.getByRole('button', { name: '预览' }));
  await waitFor(() =>
    expect(
      api.request.mock.calls.some(([r]) => r.path.endsWith('/previewBill')),
    ).toBe(true),
  );
});

it('clears allocation sources from the inline X while keeping the receipt form open', async () => {
  mount(<BillingAction />, '/billing/receipts/r1/allocate');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('combobox', { name: '来源单据' }));
  await user.click(await screen.findByRole('option', { name: /ZD-TEST/ }));
  expect(await screen.findByLabelText('ZD-TEST · 金额 *')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '清空来源单据选择' }));
  expect(screen.queryByLabelText('ZD-TEST · 金额 *')).toBeNull();
  expect(screen.getByRole('combobox', { name: '来源单据' })).toHaveFocus();
});
