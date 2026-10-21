import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, it, expect, vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  TestI18nProvider,
  createTestI18nRuntime,
} from '@nocobase/i18n/testing';
import zh from '../../client/locales/zh-CN.js';
import EnergyList from '../../client/pages/energy/list.js';
const { api } = vi.hoisted(() => ({ api: { request: vi.fn() } }));
vi.mock('../../client/hooks/use-mobile.js', () => ({
  useIsMobile: () => true,
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ session: { user: { id: 'a' } } }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useCan: () => ({ can: true }),
  useAuthorizationRevision: () => 0,
}));
const runtime = await createTestI18nRuntime({
  locale: 'zh-CN',
  application: { namespace: 'nocoerp', resources: zh },
});
afterEach(cleanup);
it('keeps eligible energy selection, exact decimal values and generation route in phone cards', async () => {
  const user = userEvent.setup(),
    base = {
      meterCode: 'W001',
      assetName: '演示铺位',
      contractId: 'c',
      contractNumber: 'HT001',
      start: '2026-10-01',
      end: '2026-10-20',
      previous: '100',
      current: '101.2345',
      usage: '1.2345',
      amountCents: '432',
      type: 'water',
      status: 'approved',
      allowedActions: [],
      updatedAt: '2026-10-20T00:00:00Z',
    };
  api.request.mockResolvedValue({
    data: [
      { ...base, id: 'one', number: 'CB001', billingStatus: 'unbilled' },
      { ...base, id: 'two', number: 'CB002', billingStatus: 'reserved' },
    ],
    meta: { total: 2, page: 1, pageSize: 20 },
  });
  render(
    <TestI18nProvider runtime={runtime}>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/energy/billing?retained=1']}>
          <Routes>
            <Route path='/energy/billing' element={<EnergyList />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </TestI18nProvider>,
  );
  expect(await screen.findByRole('heading', { name: 'CB001' })).toBeVisible();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'CB002' })).toBeVisible();
  const checks = screen.getAllByRole('checkbox');
  expect(checks).toHaveLength(2);
  expect(checks[1]).toHaveAttribute('aria-disabled', 'true');
  await user.click(checks[0]);
  const generate = screen.getByRole('button', { name: /生成账单.*1/ });
  expect(generate).toHaveAttribute(
    'href',
    expect.stringContaining('energyReadingIds=one'),
  );
  expect(generate).toHaveAttribute(
    'href',
    expect.stringContaining('retained=1'),
  );
  expect(screen.getAllByText('1.2345')).toHaveLength(2);
  expect(
    within(screen.getByRole('heading', { name: 'CB001' })).getByRole('link'),
  ).toHaveAttribute('href', '/energy/billing/one?retained=1');
});
