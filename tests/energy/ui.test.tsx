import { Picker } from '../../client/pages/energy/common.js';
import { LegacyPicker } from '../../client/pages/energy/legacy-picker.js';
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

it('clears a legacy candidate and notifies the adopting form to reset derived values', async () => {
  const selected = vi.fn();
  api.request.mockResolvedValue({
    data: [
      {
        id: 'legacy-a',
        meterCode: 'W-DEMO',
        assetId: 'asset-a',
        assetName: '铺位甲',
        feeType: 'water',
        start: '2026-10-01',
        openingReading: '10',
        multiplier: '1',
        history: [],
        historyTotal: 0,
        draftCount: 0,
        lastBillNumber: '',
        lastBillEnd: '',
      },
    ],
    meta: { page: 1, pageSize: 20, total: 1 },
  });
  mount(
    <LegacyPicker
      contractId='contract-a'
      disabled={false}
      onSelect={selected}
    />,
    '/picker',
  );
  const user = userEvent.setup();
  await user.click(
    screen.getByRole('combobox', { name: zh.energy.legacyCandidates }),
  );
  await user.click(await screen.findByRole('option', { name: /W-DEMO/ }));
  expect(selected).toHaveBeenLastCalledWith(
    expect.objectContaining({ assetId: 'asset-a', meterCode: 'W-DEMO' }),
  );
  await user.click(
    screen.getByRole('button', {
      name: '清空' + zh.energy.legacyCandidates + '选择',
    }),
  );
  expect(selected).toHaveBeenLastCalledWith(undefined);
});

it('labels the optional contract assignment and explains common-area readings', async () => {
  mount(<EnergyForm />, '/energy/readings/new');
  expect(await screen.findByText('合同绑定（选填）')).toBeVisible();
  expect(
    screen.getByRole('combobox', { name: '合同绑定（选填）' }),
  ).toHaveAttribute('id', 'energy-reading-assignment');
  expect(
    screen.getByText('不选择合同绑定即为公区抄表，不生成合同账单。'),
  ).toBeVisible();
});

it('prompts to bind a contract only for an unfiltered empty meter assignment list', async () => {
  api.request.mockImplementation(async (r) => {
    if (r.path === 'energyMeters')
      return {
        data: [{ id: 'meter', number: 'W-01', name: '测试水表' }],
        meta: { page: 1, pageSize: 20, total: 1 },
      };
    if (r.path === 'energyMeters/meter')
      return {
        data: {
          id: 'meter',
          number: 'W-01',
          name: '测试水表',
          openingReading: '0',
          multiplier: '1',
          unit: 'm³',
        },
      };
    return { data: [], meta: { page: 1, pageSize: 20, total: 0 } };
  });
  mount(<EnergyForm />, '/energy/readings/new');
  const user = userEvent.setup(),
    hint = '该水电表暂无已绑定合同。如需生成合同账单，请先到水电表中绑定合同。';
  expect(screen.getByPlaceholderText('搜索已绑定的合同编号')).toBeVisible();
  expect(screen.queryByText(hint)).toBeNull();
  await user.click(screen.getByRole('combobox', { name: '水电表 *' }));
  await user.click(
    await screen.findByRole('option', { name: 'W-01 · 测试水表' }),
  );
  expect(await screen.findByText(hint)).toBeVisible();
  await user.type(
    screen.getByPlaceholderText('搜索已绑定的合同编号'),
    'HT-MISSING',
  );
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'energyAssignments',
        query: expect.objectContaining({ meterId: 'meter', q: 'HT-MISSING' }),
      }),
    ),
  );
  expect(screen.queryByText(hint)).toBeNull();
});

it('uses contract names and merchant fallback in energy contract selections', async () => {
  api.request.mockResolvedValue({
    data: [
      {
        id: 'c1',
        number: 'HT-1',
        name: '商户甲',
        payload: { title: '水电租赁合同' },
      },
      { id: 'c2', number: 'HT-2', name: '商户乙', payload: { title: '' } },
    ],
    meta: { page: 1, pageSize: 20, total: 2 },
  });
  mount(
    <Picker kind='contracts' name='contractId' value='' onChange={() => {}} />,
  );
  await userEvent
    .setup()
    .click(screen.getByRole('combobox', { name: '合同 *' }));
  expect(
    await screen.findByRole('option', { name: '水电租赁合同 · HT-1' }),
  ).toBeVisible();
  expect(screen.getByRole('option', { name: '商户乙 · HT-2' })).toBeVisible();
});

it('shows contract names with numbers and binding dates in reading assignment options', async () => {
  api.request.mockImplementation(async (r) => {
    if (r.path === 'energyMeters')
      return {
        data: [{ id: 'meter', number: 'W-01', name: '水表' }],
        meta: { page: 1, pageSize: 20, total: 1 },
      };
    if (r.path === 'energyMeters/meter')
      return {
        data: {
          id: 'meter',
          number: 'W-01',
          name: '水表',
          openingReading: '0',
          multiplier: '1',
        },
      };
    return {
      data: [
        {
          id: 'assignment',
          number: 'BIND-001',
          contractNumber: 'HT-001',
          contractTitle: '水表租赁合同',
          contractMerchantName: '商户甲',
          start: '2026-10-01',
          end: '2026-10-31',
          payload: { contractNumber: 'HT-001' },
        },
      ],
      meta: { page: 1, pageSize: 20, total: 1 },
    };
  });
  mount(<EnergyForm />, '/energy/readings/new');
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: '水电表 *' }));
  await user.click(await screen.findByRole('option', { name: 'W-01 · 水表' }));
  const assignment = screen.getByRole('combobox', { name: '合同绑定（选填）' });
  await user.click(assignment);
  await user.click(
    await screen.findByRole('option', {
      name: '水表租赁合同 · HT-001 · 2026-10-01 · 2026-10-31',
    }),
  );
  expect(assignment).toHaveValue(
    '水表租赁合同 · HT-001 · 2026-10-01 · 2026-10-31',
  );
});
