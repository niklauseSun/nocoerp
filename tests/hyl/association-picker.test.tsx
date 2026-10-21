import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  TestI18nProvider,
  createTestI18nRuntime,
} from '@nocobase/i18n/testing';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { AssociationPicker } from '../../client/pages/hyl/association-picker.js';
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationRevision: () => 0,
  useCan: () => ({ can: true }),
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ session: { user: { id: 'admin' } } }),
}));
import zh from '../../client/locales/zh-CN.js';
const { api } = vi.hoisted(() => ({ api: { request: vi.fn() } }));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
}));
const runtime = await createTestI18nRuntime({
  locale: 'zh-CN',
  application: { namespace: 'nocoerp', resources: zh },
});
function mount(value = '', disabled = false, kind: 'asset' | 'user' = 'asset') {
  const changed = vi.fn();
  function Field() {
    const [selected, setSelected] = useState(value);
    return (
      <>
        <label htmlFor='merchant'>商户</label>
        <AssociationPicker
          kind={kind}
          id='merchant'
          value={selected}
          disabled={disabled}
          onChange={(id) => {
            changed(id);
            setSelected(id);
          }}
        />
      </>
    );
  }
  render(
    <MemoryRouter>
      <TestI18nProvider runtime={runtime}>
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <Field />
        </QueryClientProvider>
      </TestI18nProvider>
    </MemoryRouter>,
  );
  return changed;
}
beforeEach(() => {
  api.request.mockReset();
});
afterEach(cleanup);

it('selects only one unit and sends the leaf type and normal state to the scoped list', async () => {
  api.request.mockImplementation(({ path }) =>
    Promise.resolve(
      path === 'assets/a1'
        ? { data: { id: 'a1', name: '铺位A', number: 'ZC-A' } }
        : {
            data: [
              { id: 'a1', name: '铺位A', number: 'ZC-A' },
              { id: 'a2', name: '摊位B', number: 'ZC-B' },
            ],
            meta: { total: 2 },
          },
    ),
  );
  const changed = mount();
  await userEvent.type(screen.getByRole('combobox', { name: '铺位' }), '铺位');
  await userEvent.click(
    await screen.findByRole('option', { name: '铺位A · ZC-A' }),
  );
  expect(changed).toHaveBeenLastCalledWith('a1');
  expect(screen.getAllByRole('combobox')).toHaveLength(1);
  const clear = screen.getByRole('button', { name: '取消铺位选择' });
  expect(clear.closest('[data-slot="input-group"]')).not.toBeNull();
  expect(clear).toHaveTextContent('');
  await userEvent.click(clear);
  expect(changed).toHaveBeenLastCalledWith('');
  expect(screen.getByRole('combobox', { name: '铺位' })).toHaveValue('');
  expect(
    api.request.mock.calls.some(
      ([r]) => r.query?.type === 'leaf' && r.query?.state === 'normal',
    ),
  ).toBe(true);
  expect(
    api.request.mock.calls.every(([r]) => !r.method || r.method === 'GET'),
  ).toBe(true);
});
it('selects and unlinks an account without writing roles or project grants', async () => {
  api.request.mockResolvedValue({
    data: [{ id: 'u1', name: '测试账号', email: 'test@example.test' }],
    meta: { total: 1 },
  });
  const changed = mount('', false, 'user');
  await userEvent.type(
    screen.getByRole('combobox', { name: '绑定登录账号' }),
    '测试',
  );
  await userEvent.click(
    await screen.findByRole('option', { name: '测试账号 · test@example.test' }),
  );
  expect(changed).toHaveBeenLastCalledWith('u1');
  await userEvent.click(screen.getByRole('button', { name: '取消账号选择' }));
  expect(changed).toHaveBeenLastCalledWith('');
  expect(
    api.request.mock.calls.every(([r]) => r.path === 'users' && !r.method),
  ).toBe(true);
});
