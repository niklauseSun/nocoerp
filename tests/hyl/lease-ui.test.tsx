import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  TestI18nProvider,
  createTestI18nRuntime,
} from '@nocobase/i18n/testing';
import { ApiClientError } from '@nocobase/app-client';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import zh from '../../client/locales/zh-CN.js';
import LeaseAction from '../../client/pages/hyl/lease/action.js';
import { LeasePanel } from '../../client/pages/hyl/lease/panel.js';
import type { BusinessRow } from '../../client/pages/hyl/model.js';
const { api, financial, toaster } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  financial: { can: true },
  toaster: { show: vi.fn() },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => toaster,
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationRevision: () => 0,
  useCan: (input: { action: string }) => ({
    can: input.action === 'depositRead' ? financial.can : true,
  }),
}));
const runtime = await createTestI18nRuntime({
  locale: 'zh-CN',
  application: { namespace: 'nocoerp', resources: zh },
});
const row: BusinessRow = {
  id: 'contract',
  number: 'HT-TEST',
  name: '测试商户',
  merchantId: 'merchant',
  status: 'active',
  date: '2026-10-01',
  updatedAt: '2026-10-17T00:00:00Z',
  amountCents: '0',
  version: 0,
  settlementId: null,
  payload: { start: '2026-10-01', end: '2026-10-31' },
  lease: { status: 'active', version: 0, payload: {} },
};
function mount(
  element: React.ReactNode,
  path = '/contracts/contract/lease/receive',
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
              path='/contracts/:id'
              element={
                <>
                  <p>合同详情</p>
                  <Outlet context={{ row }} />
                </>
              }
            >
              <Route path='lease/:action' element={element} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </TestI18nProvider>,
  );
}
beforeEach(() => {
  financial.can = true;
  api.request.mockReset();
  toaster.show.mockReset();
  api.request.mockImplementation(
    async ({ path, method }: { path: string; method?: string }) => {
      if (method === 'POST') return { data: {} };
      return {
        data: path.endsWith('leaseSummary')
          ? {
              version: 0,
              status: 'active',
              balance: '1000.00',
              depositTarget: '1000',
              entries: [],
              charges: [],
              settlements: [],
              payload: {},
            }
          : row,
      };
    },
  );
});
afterEach(cleanup);
it('validates, confirms once, preserves input after failed write, and returns to the contract after retry', async () => {
  mount(<LeaseAction />);
  const user = userEvent.setup();
  await screen.findByLabelText('参考号 *');
  await user.click(screen.getByRole('button', { name: '登记押金收取' }));
  expect(
    api.request.mock.calls.filter(([i]) => i.method === 'POST'),
  ).toHaveLength(0);
  await user.clear(screen.getByLabelText('金额 *'));
  await user.type(screen.getByLabelText('金额 *'), '250');
  await user.type(screen.getByLabelText('参考号 *'), 'DEMO-RECEIVE');
  await user.type(screen.getByLabelText('凭证说明 *'), '模拟凭证');
  await user.click(screen.getByRole('button', { name: '登记押金收取' }));
  await screen.findByRole('alertdialog');
  const failure = new ApiClientError('Failed', {
    status: 500,
    method: 'POST',
    url: '/lease',
  });
  api.request.mockRejectedValueOnce(failure);
  await user.click(screen.getByRole('button', { name: '确认并登记' }));
  await screen.findByText('操作失败，请检查输入或稍后重试。');
  expect(screen.getByLabelText('参考号 *')).toHaveValue('DEMO-RECEIVE');
  const first = api.request.mock.calls.find(([i]) => i.method === 'POST')?.[0];
  await user.click(screen.getByRole('button', { name: '登记押金收取' }));
  await user.click(screen.getByRole('button', { name: '确认并登记' }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  const writes = api.request.mock.calls.filter(([i]) => i.method === 'POST');
  expect(writes).toHaveLength(2);
  expect(writes[1]?.[0].json.requestId).toBe(first.json.requestId);
  expect(toaster.show).toHaveBeenCalled();
});
it('does not fetch financial data without deposit read access', async () => {
  financial.can = false;
  mount(<LeasePanel row={row} />);
  expect(await screen.findByText('暂无财务台账查看权限。')).toBeInTheDocument();
  expect(api.request).not.toHaveBeenCalled();
  expect(screen.queryByText('可用押金')).not.toBeInTheDocument();
});
it('refreshes a stale version while preserving entered values and requires confirmation again', async () => {
  mount(<LeaseAction />);
  const user = userEvent.setup();
  await screen.findByLabelText('参考号 *');
  await user.clear(screen.getByLabelText('金额 *'));
  await user.type(screen.getByLabelText('金额 *'), '250');
  await user.type(screen.getByLabelText('参考号 *'), 'STALE-RECEIVE');
  await user.type(screen.getByLabelText('凭证说明 *'), '凭证');
  await user.click(screen.getByRole('button', { name: '登记押金收取' }));
  api.request.mockRejectedValueOnce(
    new ApiClientError('Stale', {
      status: 409,
      method: 'POST',
      url: '/lease',
      reason: 'VERSION_CONFLICT',
    }),
  );
  await user.click(screen.getByRole('button', { name: '确认并登记' }));
  const button = await screen.findByRole('button', {
    name: '刷新并核对最新账目（保留输入）',
  });
  api.request
    .mockResolvedValueOnce({ data: { ...row, lease: { version: 4 } } })
    .mockResolvedValueOnce({
      data: {
        version: 4,
        balance: '400.00',
        entries: [],
        charges: [],
        settlements: [],
        payload: {},
        status: 'active',
      },
    });
  await user.click(button);
  await waitFor(() => expect(button).not.toBeInTheDocument());
  expect(screen.getByLabelText('参考号 *')).toHaveValue('STALE-RECEIVE');
  expect(screen.getByLabelText('金额 *')).toHaveValue('250');
  await user.click(screen.getByRole('button', { name: '登记押金收取' }));
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '确认并登记' }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  const writes = api.request.mock.calls.filter(([i]) => i.method === 'POST');
  expect(writes[1]?.[0].json.expectedVersion).toBe(4);
  expect(writes[1]?.[0].json.requestId).not.toBe(writes[0]?.[0].json.requestId);
});
it('shows a read-only original reversal entry, evidence/date and blocking dependencies before confirmation', async () => {
  api.request.mockImplementation(async ({ path }: { path: string }) => ({
    data: path.endsWith('leaseSummary')
      ? {
          version: 0,
          status: 'active',
          balance: '0',
          entries: [
            {
              id: 'original',
              kind: 'receive',
              amountCents: '10000',
              createdAt: '2026-10-17',
              reference: 'ORIGINAL',
              payload: {},
              reversalBlockers: [
                {
                  reason: 'consumed',
                  contractId: 'contract',
                  entries: ['later-entry'],
                },
              ],
            },
          ],
          charges: [],
          settlements: [],
          payload: {},
        }
      : row,
  }));
  mount(<LeaseAction />, '/contracts/contract/lease/reverse?sourceId=original');
  expect(await screen.findByText(/ORIGINAL/)).toBeInTheDocument();
  expect(
    screen.queryByRole('combobox', { name: '关联款项' }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText('凭证说明 *')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '冲正押金流水' })).toBeDisabled();
  expect(
    api.request.mock.calls.filter(([i]) => i.method === 'POST'),
  ).toHaveLength(0);
});

vi.mock('@nocobase/app-plugin-authentication/client', async (original) => ({
  ...(await original<
    typeof import('@nocobase/app-plugin-authentication/client')
  >()),
  useAuthentication: () => ({ session: { user: { id: 'business-test' } } }),
}));
