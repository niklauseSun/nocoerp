import { ApiClientError } from '@nocobase/app-client';
import SourceList from '../../client/pages/energy/source-list.js';
import EnergyDetail from '../../client/pages/energy/detail.js';
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
import en from '../../client/locales/en-US.js';
import EnergyForm from '../../client/pages/energy/form.js';
import EnergyList from '../../client/pages/energy/list.js';
import { kindFrom } from '../../client/pages/energy/helpers.js';
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
  useCan: () => ({ can: can.value }),
}));
const runtime = await createTestI18nRuntime({
  locale: 'zh-CN',
  application: { namespace: 'nocoerp', resources: zh },
});
function mount(element: React.ReactNode, path = '/energy/meters/new') {
  return render(
    <TestI18nProvider runtime={runtime}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path='/energy/readings/:energyReadingId' element={element} />
            <Route path='*' element={element} />
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
  api.request.mockReset();
  api.request.mockResolvedValue({
    data: [],
    meta: { page: 1, pageSize: 20, total: 0 },
  });
});
it('validates meter fields before mutation and keeps Chinese typing intact', async () => {
  const user = userEvent.setup();
  mount(<EnergyForm />);
  await user.click(screen.getByRole('button', { name: '新增水电表' }));
  expect(await screen.findAllByText('请填写此项。')).not.toHaveLength(0);
  expect(api.request.mock.calls.every(([r]) => r.method !== 'POST')).toBe(true);
  const name = screen.getByLabelText(/^名称/);
  await user.type(name, 'ABC');
  expect(name).toHaveValue('ABC');
  await user.clear(name);
  await user.type(name, '演示水表');
  expect(name).toHaveValue('演示水表');
});
it('offers one create action on an empty list and hides writes without permission', async () => {
  mount(<EnergyList />, '/energy/meters');
  expect(await screen.findByText('暂无记录')).toBeVisible();
  expect(screen.getAllByRole('button', { name: '新增水电表' })).toHaveLength(1);
  cleanup();
  can.value = false;
  mount(<EnergyList />, '/energy/meters');
  expect(screen.queryByRole('button', { name: '新增水电表' })).toBeNull();
  expect(screen.getByText('暂无访问权限，请联系管理员。')).toBeVisible();
});
it('has matching bilingual copy and resolves local detail paths by their final energy segment', () => {
  function keys(o: Record<string, unknown>, p = ''): string[] {
    return Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === 'object'
        ? keys(v as Record<string, unknown>, p + k + '.')
        : [p + k],
    );
  }
  expect(keys(zh.energy).sort()).toEqual(keys(en.energy).sort());
  expect(kindFrom('/contracts/c/energyMeters/m/reading/r')).toBe('readings');
  expect(kindFrom('/billing/bills/b/energyReadings/r')).toBe('readings');
  expect(kindFrom('/energy/readings/r/meter/m')).toBe('meters');
});

it('keeps bill-scoped sources read only even when write capability is granted', async () => {
  mount(<SourceList />, '/cashier/orders/o/bill/b/energyReadings');
  await screen.findByText('暂无记录');
  expect(screen.queryByRole('button', { name: '新增抄表' })).toBeNull();
});
it('retains a failed approval dialog and replays the same unknown request', async () => {
  const empty = { data: [], meta: { page: 1, pageSize: 20, total: 0 } },
    detail = {
      id: 'r1',
      number: 'CB-TEST',
      meterId: 'm1',
      assetId: 'a1',
      contractId: 'c1',
      status: 'submitted',
      version: 1,
      meterVersion: 1,
      start: '2026-10-01',
      end: '2026-10-31',
      previous: '100',
      current: '130',
      usage: '30',
      multiplier: '1',
      unit: 'm³',
      billingStatus: 'unbilled',
      allowedActions: ['readingReview'],
      payload: {},
      assignments: empty,
      readings: empty,
      bills: empty,
      audit: empty,
    };
  let attempts = 0;
  api.request.mockImplementation(async ({ method }: { method?: string }) => {
    if (method === 'POST') {
      attempts++;
      if (attempts === 1)
        throw new ApiClientError('Unknown', {
          status: 500,
          method: 'POST',
          url: '/energyReadings/r1/approve',
        });
      detail.status = 'approved';
      return { data: detail };
    }
    return { data: detail };
  });
  const user = userEvent.setup();
  mount(<EnergyDetail />, '/energy/readings/r1');
  await user.click(
    await screen.findByRole('button', { name: '审核通过', exact: true }),
  );
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog).toHaveTextContent('CB-TEST');
  await user.click(
    within(dialog).getByRole('button', { name: '审核通过', exact: true }),
  );
  await waitFor(() => expect(within(dialog).getByRole('alert')).toBeVisible());
  expect(screen.getByRole('alertdialog')).toBeVisible();
  await user.click(
    within(dialog).getByRole('button', { name: '审核通过', exact: true }),
  );
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  const writes = api.request.mock.calls.filter(([r]) => r.method === 'POST');
  expect(writes).toHaveLength(2);
  expect(writes[0][0].json.requestId).toBe(writes[1][0].json.requestId);
});

vi.mock('@nocobase/app-plugin-authentication/client', async (original) => ({
  ...(await original<
    typeof import('@nocobase/app-plugin-authentication/client')
  >()),
  useAuthentication: () => ({ session: { user: { id: 'business-test' } } }),
}));
