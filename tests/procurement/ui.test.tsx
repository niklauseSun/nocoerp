import { useState } from 'react';
import { Picker } from '../../client/pages/procurement/common.js';
import Detail from '../../client/pages/procurement/detail.js';
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
import List from '../../client/pages/procurement/list.js';
import Form from '../../client/pages/procurement/form.js';
const { api, permissions } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  permissions: { can: true, finance: false },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useNavigationGuard: vi.fn(),
  useApiClient: () => api,
  useToaster: () => ({ show: vi.fn() }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationRevision: () => 0,
  useCan: ({ action }: { action: string }) => ({
    can: action === 'financeRead' ? permissions.finance : permissions.can,
    isPending: false,
  }),
}));
const runtime = await createTestI18nRuntime({
  locale: 'zh-CN',
  application: { namespace: 'nocoerp', resources: zh },
});
function mount(
  element: React.ReactNode,
  path = '/procurement/requests',
  route = path,
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
            <Route path={route} element={element} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </TestI18nProvider>,
  );
}
beforeEach(() => {
  permissions.can = true;
  permissions.finance = false;
  api.request.mockReset();
  api.request.mockResolvedValue({
    data: [],
    meta: { page: 1, pageSize: 20, total: 0 },
  });
});
afterEach(cleanup);
it('empty requests offer one create action and hide financial tabs', async () => {
  mount(<List kind='requests' />);
  await screen.findByText('暂无采购申请');
  expect(screen.getAllByRole('button', { name: '新增采购申请' })).toHaveLength(
    1,
  );
  expect(screen.queryByRole('button', { name: '付款登记' })).toBeNull();
});
it('denied finance does not request its ledger', async () => {
  mount(<List kind='ledger' />, '/procurement/ledger');
  await screen.findByText('暂无此项权限，请联系管理员分配采购或财务权限。');
  expect(api.request).not.toHaveBeenCalled();
});
it('Chinese composition search waits until composition ends', async () => {
  mount(<List kind='requests' />);
  const input =
    await screen.findByPlaceholderText('搜索编号、名称、供应商或资产');
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: 'deng' } });
  expect(api.request.mock.calls.some(([v]) => v.query?.q === 'deng')).toBe(
    false,
  );
  fireEvent.compositionEnd(input, { data: '灯具' });
  fireEvent.change(input, { target: { value: '灯具' } });
  await waitFor(() =>
    expect(api.request.mock.calls.some(([v]) => v.query?.q === '灯具')).toBe(
      true,
    ),
  );
});
it('invalid supplier submit focuses the first field without a mutation', async () => {
  mount(<Form kind='suppliers' />, '/procurement/suppliers/new');
  const submit = await screen.findByRole('button', {
    name: '新增',
    exact: true,
  });
  await waitFor(() =>
    expect((submit as HTMLButtonElement).disabled).toBe(false),
  );
  await userEvent.click(submit);
  await screen.findAllByText('请检查必填项、格式及数量金额。');
  expect(api.request.mock.calls.every(([v]) => v.method !== 'POST')).toBe(true);
  await waitFor(() =>
    expect(document.activeElement?.id).toBe('cashier-projectId'),
  );
});

it('unknown payment response freezes inputs and retries the identical operation', async () => {
  const record = {
    id: '10101010-1010-4010-8010-101010101010',
    number: 'CGDD-TEST',
    title: 'Repair materials',
    status: 'issued',
    version: 3,
    allowedActions: ['pay'],
    blockedActions: {},
    outstandingCents: '10000',
    payload: {},
  };
  let attempt = 0;
  api.request.mockImplementation(async (v: { method?: string }) => {
    if (v.method === 'POST') {
      attempt++;
      if (attempt === 1) throw Error('lost response');
      return { data: record };
    }
    return { data: record };
  });
  mount(
    <Form kind='orders' />,
    '/procurement/orders/' + record.id + '/pay',
    '/procurement/orders/:purchaseordersId/:purchaseAction',
  );
  const amount = await screen.findByLabelText('付款金额（元） *');
  await waitFor(() =>
    expect((amount as HTMLInputElement).disabled).toBe(false),
  );
  await userEvent.type(amount, '10');
  await userEvent.type(screen.getByLabelText('模拟付款凭证号 *'), 'SIM-RETRY');
  await userEvent.type(screen.getByLabelText('凭证 / 验收依据 *'), 'Demo');
  await userEvent.click(
    screen.getByRole('button', { name: '登记模拟付款', exact: true }),
  );
  await userEvent.click(
    screen.getByRole('alertdialog').querySelector('button:last-child')!,
  );
  await waitFor(() => expect(attempt).toBe(1));
  await waitFor(() => expect(amount.closest('fieldset')?.disabled).toBe(true));
  const again = screen.getByRole('button', {
    name: '登记模拟付款',
    exact: true,
  });
  expect((again as HTMLButtonElement).disabled).toBe(false);
  await userEvent.click(again);
  await userEvent.click(
    screen.getByRole('alertdialog').querySelector('button:last-child')!,
  );
  await waitFor(() => expect(attempt).toBe(2));
  const writes = api.request.mock.calls
    .map(([v]) => v)
    .filter((v) => v.method === 'POST');
  expect(writes[1].json).toEqual(writes[0].json);
});

it('refresh reloads the financial summary as well as the journal', async () => {
  permissions.finance = true;
  api.request.mockImplementation(async (v: { path: string }) =>
    v.path === 'procurementSummary'
      ? {
          data: {
            acceptedCents: '10000',
            paidCents: '4000',
            outstandingCents: '6000',
          },
        }
      : { data: [], meta: { page: 1, pageSize: 20, total: 0 } },
  );
  mount(<List kind='ledger' />, '/procurement/ledger');
  await screen.findByText('剩余应付');
  const before = api.request.mock.calls.filter(
    ([v]) => v.path === 'procurementSummary',
  ).length;
  await userEvent.click(screen.getByRole('button', { name: '刷新' }));
  await waitFor(() =>
    expect(
      api.request.mock.calls.filter(([v]) => v.path === 'procurementSummary')
        .length,
    ).toBe(before + 1),
  );
});

it('repair source failure shows a retry and successfully recovers', async () => {
  let failed = true;
  api.request.mockImplementation(async (v: { path: string }) => {
    if (v.path === 'repairOrders/source') {
      if (failed) throw Error('temporary source failure');
      return {
        data: {
          assetId: '10101010-1010-4010-8010-101010101010',
          payload: { assetName: 'Demo asset' },
        },
      };
    }
    return { data: [], meta: { page: 1, pageSize: 20, total: 0 } };
  });
  mount(
    <Form kind='requests' />,
    '/repairs/source/procurement/new',
    '/repairs/:repairId/procurement/new',
  );
  const retry = await screen.findByRole('button', { name: '重试' });
  expect(screen.queryByLabelText('名称 / 主题 *')).toBeNull();
  failed = false;
  await userEvent.click(retry);
  await screen.findByLabelText('名称 / 主题 *');
});

it('order detail chooses receipt as next step and refreshes related receipts', async () => {
  const id = '10101010-1010-4010-8010-101010101010';
  const record = {
    id,
    number: 'CGDD-TEST',
    title: 'Parts',
    status: 'issued',
    version: 0,
    allowedActions: ['cancel', 'pay', 'newReceipt'],
    blockedActions: {},
    amountCents: '10000',
    acceptedCents: '5000',
    paidCents: '0',
    outstandingCents: '5000',
    day: '2026-10-19',
    payload: {},
    events: { data: [], meta: { page: 1, pageSize: 20, total: 0 } },
  };
  api.request.mockImplementation(async (v: { path: string }) =>
    v.path === 'purchaseOrders/' + id
      ? { data: record }
      : { data: [], meta: { page: 1, pageSize: 20, total: 0 } },
  );
  mount(
    <Detail kind='orders' />,
    '/procurement/requests/r/related/' + id,
    '/procurement/requests/r/related/:purchaseordersId',
  );
  const next = await screen.findByRole('button', { name: '登记收货' });
  expect(next.className.split(' ')).toContain('bg-primary');
  expect(
    screen.getByRole('button', { name: '取消记录' }).className.split(' '),
  ).toContain('bg-background');
  expect(screen.getByRole('link', { name: '返回' }).getAttribute('href')).toBe(
    '/procurement/requests/r',
  );
  await waitFor(() =>
    expect(
      api.request.mock.calls.some(([v]) => v.path === 'purchaseReceipts'),
    ).toBe(true),
  );
  const before = api.request.mock.calls.filter(
    ([v]) => v.path === 'purchaseReceipts',
  ).length;
  await userEvent.click(screen.getByRole('button', { name: '刷新' }));
  await waitFor(() =>
    expect(
      api.request.mock.calls.filter(([v]) => v.path === 'purchaseReceipts')
        .length,
    ).toBe(before + 1),
  );
});

vi.mock('@nocobase/app-plugin-authentication/client', async (original) => ({
  ...(await original<
    typeof import('@nocobase/app-plugin-authentication/client')
  >()),
  useAuthentication: () => ({ session: { user: { id: 'business-test' } } }),
}));

it('searches suppliers in one scoped input and clears both ID and caption', async () => {
  api.request.mockResolvedValue({
    data: [{ id: 'supplier-a', title: '演示维修供应商', number: 'GYS-A' }],
    meta: { page: 1, pageSize: 20, total: 1 },
  });
  function Example() {
    const [value, setValue] = useState(''),
      [caption, setCaption] = useState('');
    return (
      <>
        <Picker
          name='supplierId'
          path='purchaseSuppliers'
          query={{ projectId: 'project-a' }}
          value={value}
          caption={caption}
          onChange={(id, label) => {
            setValue(id);
            setCaption(label);
          }}
        />
        <output data-testid='supplier'>
          {value}:{caption}
        </output>
      </>
    );
  }
  mount(<Example />, '/picker');
  const user = userEvent.setup(),
    input = screen.getByRole('combobox', { name: '供应商 *' });
  await user.type(input, '维修');
  expect(
    api.request.mock.calls.some(
      ([r]) => r.query?.projectId === 'project-a' && r.query?.q === '维修',
    ),
  ).toBe(true);
  await user.click(
    await screen.findByRole('option', { name: 'GYS-A · 演示维修供应商' }),
  );
  expect(screen.getByTestId('supplier')).toHaveTextContent(
    'supplier-a:GYS-A · 演示维修供应商',
  );
  await user.click(screen.getByRole('button', { name: '清空供应商选择' }));
  expect(screen.getByTestId('supplier')).toHaveTextContent(':');
  expect(input).toHaveValue('');
});
