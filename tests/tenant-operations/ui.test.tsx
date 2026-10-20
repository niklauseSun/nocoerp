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
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import zh from '../../client/locales/zh-CN.js';
import en from '../../client/locales/en-US.js';
import Operations from '../../client/pages/tenant-operations/index.js';
vi.stubGlobal(
  'matchMedia',
  vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
);
const { api } = vi.hoisted(() => ({ api: { request: vi.fn() } }));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useNavigationGuard: vi.fn(),
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ session: { user: { id: 'TEST-tenant' } } }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useCan: () => ({ can: false }),
  useAuthorizationRevision: () => 0,
}));
const runtime = await createTestI18nRuntime({
    locale: 'zh-CN',
    application: { namespace: 'nocoerp', resources: zh },
  }),
  english = await createTestI18nRuntime({
    locale: 'en-US',
    application: { namespace: 'nocoerp', resources: en },
  });
const data = {
  data: {
    month: '2026-10',
    today: '2026-10-20',
    generatedAt: '2026-10-20T01:00:00Z',
    summary: { expected: '2', missing: '1' },
    items: [
      {
        id: 'TEST-1',
        name: 'TEST未报商户',
        date: '2026-10-19',
        status: 'missing',
        amountCents: '0',
        detail: '0',
        path: '/revenueReports',
        kind: '',
        sourceId: '',
      },
      {
        id: 'TEST-2',
        name: 'TEST零收入商户',
        date: '2026-10-20',
        status: 'approved',
        amountCents: '0',
        detail: '1',
        path: '/revenueReports',
        kind: '',
        sourceId: '',
      },
    ],
  },
  meta: { page: 1, pageSize: 20, total: 2 },
};
function Probe() {
  const l = useLocation();
  return <output data-testid='ops-url'>{l.pathname + l.search}</output>;
}
function mount(lang = runtime, entry = '/tenantOperations?month=2026-10') {
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
            <Route path='/tenantOperations' element={<Operations />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </TestI18nProvider>,
  );
}
beforeEach(() => {
  api.request.mockReset();
  api.request.mockResolvedValue(structuredClone(data));
});
it('TEST displays cash collection separately from deposit-inclusive application and keeps zero denominator empty', async () => {
  const result = structuredClone(data);
  result.data.summary = {
    assessedCents: '10000',
    appliedCents: '6000',
    cashAppliedCents: '4000',
  } as unknown as typeof result.data.summary;
  api.request.mockResolvedValue(result);
  mount(runtime, '/tenantOperations?view=arrears&month=2026-10');
  expect(await screen.findByText(/当前现金收缴率/)).toHaveTextContent('40%');
  expect(screen.getByText(/当前应收台账核销率/)).toHaveTextContent('60%');
  expect(screen.getByText('已收款核销金额（不含押金抵扣）')).toBeVisible();
  cleanup();
  result.data.summary = {
    assessedCents: '0',
    appliedCents: '0',
    cashAppliedCents: '0',
  } as unknown as typeof result.data.summary;
  api.request.mockResolvedValue(result);
  mount(english, '/tenantOperations?view=arrears');
  expect(
    await screen.findByText(/Current cash collection rate/),
  ).toHaveTextContent('—');
});
afterEach(cleanup);
it('TEST distinguishes missing from zero and preserves month while sorting and searching Chinese text', async () => {
  const user = userEvent.setup();
  mount();
  const missing = await screen.findByText('TEST未报商户');
  expect(within(missing.closest('tr')!).getByText('—')).toBeVisible();
  expect(
    within(screen.getByText('TEST零收入商户').closest('tr')!).getByText(
      '¥0.00',
    ),
  ).toBeVisible();
  await user.click(
    screen.getByRole('button', { name: '金额（元）', exact: true }),
  );
  expect(screen.getByTestId('ops-url').textContent).toContain(
    'order=amountCents',
  );
  await user.type(
    screen.getByPlaceholderText('搜索名称、编号、渠道或日期'),
    '测试租户',
  );
  await waitFor(() =>
    expect(screen.getByTestId('ops-url').textContent).toContain('q='),
  );
  expect(
    screen.queryByRole('button', { name: '导入账单' }),
  ).not.toBeInTheDocument();
});
it('TEST permission denial has no retry and English page is localized', async () => {
  api.request.mockRejectedValue(
    new ApiClientError('Denied', { status: 403, reason: 'ACCESS_DENIED' }),
  );
  mount();
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: '重试' }),
  ).not.toBeInTheDocument();
  cleanup();
  api.request.mockResolvedValue(structuredClone(data));
  mount(english);
  expect(
    await screen.findByRole('heading', { name: 'Tenant operations' }),
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Reporting completeness' }),
  ).toBeVisible();
});
