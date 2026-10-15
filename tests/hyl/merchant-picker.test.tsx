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
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { MerchantPicker } from '../../client/pages/hyl/merchant-picker.js';
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
const merchant = { id: 'm1', name: '星河餐饮', number: 'SH100' };
function mount(value = '', disabled = false) {
  const changed = vi.fn();
  function Field() {
    const [selected, setSelected] = useState(value);
    return (
      <>
        <label htmlFor='merchant'>商户</label>
        <MerchantPicker
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
it('searches by name or number in a single combobox and selects then clears the merchant', async () => {
  api.request.mockImplementation(({ path }: { path: string }) =>
    Promise.resolve(
      path === 'merchants/m1'
        ? { data: merchant }
        : { data: [merchant], meta: { total: 1 } },
    ),
  );
  const changed = mount();
  const input = screen.getByRole('combobox', { name: '商户' });
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  await userEvent.type(input, '星河');
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ q: '星河' }),
      }),
    ),
  );
  await userEvent.click(
    await screen.findByRole('option', { name: '星河餐饮 · SH100' }),
  );
  expect(changed).toHaveBeenLastCalledWith('m1');
  await waitFor(() => expect(input).toHaveValue('星河餐饮 · SH100'));
  await userEvent.clear(input);
  expect(changed).toHaveBeenLastCalledWith('');
  await userEvent.type(input, 'SH100');
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ q: 'SH100' }),
      }),
    ),
  );
  await userEvent.keyboard('{ArrowDown}{Enter}');
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith('m1'));
});
it('shows a selected merchant outside the current page and preserves the disabled edit state', async () => {
  api.request.mockImplementation(({ path }: { path: string }) =>
    Promise.resolve(
      path === 'merchants/m1'
        ? { data: merchant }
        : { data: [], meta: { total: 30 } },
    ),
  );
  const changed = mount('m1', true);
  const input = screen.getByRole('combobox', { name: '商户' });
  await waitFor(() => expect(input).toHaveValue('星河餐饮 · SH100'));
  expect(input).toBeDisabled();
  expect(screen.getByRole('button', { name: '选择商户' })).toBeDisabled();
  expect(changed).not.toHaveBeenCalled();
});
it('loads the next page and resets paging for a new search', async () => {
  api.request.mockImplementation(({ query }: { query?: { page?: number } }) =>
    Promise.resolve({
      data: [
        query?.page === 2
          ? { ...merchant, id: 'm2', name: '第二页商户' }
          : merchant,
      ],
      meta: { total: 21 },
    }),
  );
  mount();
  await userEvent.click(screen.getByRole('button', { name: '选择商户' }));
  await userEvent.click(await screen.findByRole('button', { name: '下一页' }));
  expect(
    await screen.findByRole('option', { name: '第二页商户 · SH100' }),
  ).toBeInTheDocument();
  await userEvent.type(screen.getByRole('combobox', { name: '商户' }), '新');
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ q: '新', page: 1 }),
      }),
    ),
  );
});
it('shows no results and supports Chinese composition without querying unfinished text', async () => {
  api.request.mockResolvedValue({ data: [], meta: { total: 0 } });
  mount();
  const input = screen.getByRole('combobox', { name: '商户' });
  await userEvent.click(input);
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: '星河' } });
  expect(
    api.request.mock.calls.some(([args]) => args.query?.q === '星河'),
  ).toBe(false);
  fireEvent.compositionEnd(input, { data: '星河' });
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ q: '星河' }),
      }),
    ),
  );
  expect(await screen.findByText('没有符合条件的记录')).toBeInTheDocument();
});
it('recovers from a failed merchant search without losing the single search control', async () => {
  api.request
    .mockRejectedValueOnce(new Error('Network failed'))
    .mockResolvedValue({ data: [merchant], meta: { total: 1 } });
  mount();
  await userEvent.click(screen.getByRole('button', { name: '选择商户' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(
    await screen.findByRole('option', { name: '星河餐饮 · SH100' }),
  ).toBeInTheDocument();
  expect(screen.getAllByRole('combobox')).toHaveLength(1);
});
