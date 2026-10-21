import NewSplitOrder from '../../client/pages/profit-sharing/new-order.js';
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
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import zh from '../../client/locales/zh-CN.js';
import SplitRuleForm from '../../client/pages/profit-sharing/rule-form.js';
import SplitAction from '../../client/pages/profit-sharing/action.js';
import SplitSource from '../../client/pages/profit-sharing/source.js';
import SplitList from '../../client/pages/profit-sharing/list.js';
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

function mount(
  element: React.ReactNode,
  path = '/profit-sharing/orders/o1/execute',
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
            <Route path='/profit-sharing/orders/new' element={element} />
            <Route
              path='/profit-sharing/orders/:splitId/execute'
              element={element}
            />
            <Route
              path='/profit-sharing/orders/:splitId/review'
              element={element}
            />
            <Route
              path='/profit-sharing/orders/:splitId'
              element={<h1>源详情</h1>}
            />
            <Route
              path='/profit-sharing/rules/:ruleId/copy'
              element={element}
            />
            <Route path='*' element={element} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </TestI18nProvider>,
  );
}
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  api.request.mockReset();
  can.value = true;
  can.denied.clear();
  toaster.show.mockClear();
});
afterEach(cleanup);
it('denied execution makes no source request and cannot submit', async () => {
  can.value = false;
  mount(<SplitAction />);
  expect(await screen.findByText(zh.split.restricted)).toBeInTheDocument();
  expect(api.request).not.toHaveBeenCalled();
});
it('source changes block direct execution and require another review', async () => {
  api.request.mockResolvedValue({
    data: {
      id: 'o1',
      number: 'FZ-TEST',
      version: 1,
      status: 'adjustmentPending',
      sourceHash: 'new',
      closed: false,
      allowedActions: ['splitExecute'],
      payload: {
        reviewedHash: 'old',
        snapshot: { fundingGapCents: '0', lines: [] },
      },
    },
  });
  mount(<SplitAction />);
  expect(await screen.findByText(zh.split.stale)).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: zh.split.execute, exact: true }),
  ).toBeDisabled();
});
it('list failure offers retry and successful retry restores the empty state', async () => {
  api.request
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ data: [], meta: { total: 0, page: 1, pageSize: 20 } });
  mount(<SplitList />, '/profit-sharing/orders');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /重试/ }));
  expect(await screen.findByText(zh.split.empty)).toBeInTheDocument();
});

it('first validation error focuses the beneficiary control and preserves composed notes', async () => {
  api.request.mockResolvedValue({
    data: {
      id: 'o1',
      number: 'FZ-TEST',
      version: 1,
      status: 'ready',
      sourceHash: 'hash',
      closed: false,
      allowedActions: ['splitExecute'],
      payload: {
        reviewedHash: 'hash',
        snapshot: { fundingGapCents: '0', lines: [] },
      },
    },
  });
  mount(<SplitAction />);
  const user = userEvent.setup();
  await screen.findByRole('combobox', { name: zh.split.fields.recipientKey });
  await user.click(
    screen.getByRole('button', { name: zh.split.preview, exact: true }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('combobox', { name: zh.split.fields.recipientKey }),
    ).toHaveFocus(),
  );
  const notes = screen.getByLabelText(zh.split.fields.notes);
  fireEvent.compositionStart(notes);
  fireEvent.change(notes, { target: { value: 'ni' } });
  fireEvent.compositionUpdate(notes, { data: '拟' });
  fireEvent.change(notes, { target: { value: '模拟凭证' } });
  fireEvent.compositionEnd(notes, { data: '模拟凭证' });
  expect(notes).toHaveValue('模拟凭证');
  await user.click(notes);
  await user.keyboard('{Home}{ArrowRight}新增');
  expect(notes).toHaveValue('模新增拟凭证');
});

it('list next page changes the query and keeps access to records after the first twenty', async () => {
  api.request.mockResolvedValue({
    data: [
      {
        id: 'o1',
        number: 'FZ-1',
        sourceKind: 'bill',
        status: 'ready',
        updatedAt: '2026-10-18',
        payload: {
          snapshot: {
            sourceNumber: 'B',
            merchantName: 'M',
            contractNumber: 'C',
          },
        },
      },
    ],
    meta: { page: 1, pageSize: 20, total: 21 },
  });
  mount(<SplitList />, '/profit-sharing/orders');
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', {
      name: zh.hyl.actions.next,
      exact: true,
    }),
  );
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'splitOrders',
        query: expect.objectContaining({ page: 2 }),
      }),
    ),
  );
});

it('closing a source covering page restores the connected origin focus', async () => {
  const origin = document.createElement('button');
  origin.textContent = 'origin';
  document.body.append(origin);
  origin.focus();
  api.request.mockResolvedValue({
    data: { id: 'b', number: 'B', status: 'issued', payload: {} },
  });
  const view = mount(<SplitSource />, '/profit-sharing/orders/o1/bill/b');
  await screen.findByRole('heading', { name: 'B' });
  view.unmount();
  await waitFor(() => expect(origin).toHaveFocus());
  origin.remove();
});

it('unknown write outcome retries the same request, then success focuses the returned source', async () => {
  const writes: unknown[] = [];
  let attempts = 0;
  api.request.mockImplementation(
    async (input: { method?: string; json?: unknown }) => {
      if (input.method === 'POST') {
        writes.push(input.json);
        if (!attempts++) throw Error('unknown');
        return { data: { number: 'FZ-TEST' } };
      }
      return {
        data: {
          id: 'o1',
          number: 'FZ-TEST',
          version: 1,
          status: 'pendingReview',
          sourceHash: 'hash',
          sourceFundsCents: '10000',
          netPaidCents: '0',
          remainingCents: '2000',
          recoveryCents: '0',
          activeRevision: 1,
          closed: false,
          allowedActions: ['splitReview'],
          payload: {
            reviewedHash: '',
            snapshot: {
              sourceNumber: 'B',
              fundingGapCents: '0',
              lines: [{ key: 'p', name: 'P', targetCents: '8000' }],
            },
          },
          revisions: { data: [] },
        },
      };
    },
  );
  mount(<SplitAction />, '/profit-sharing/orders/o1/review');
  const user = userEvent.setup();
  const evidence = await screen.findByLabelText(
    zh.split.fields.evidence + ' *',
  );
  await user.type(evidence, '模拟复核依据');
  for (let i = 0; i < 2; i++) {
    await user.click(
      screen.getByRole('button', { name: zh.split.review, exact: true }),
    );
    const dialog = await screen.findByRole('alertdialog');
    await user.click(
      within(dialog).getByRole('button', {
        name: zh.split.review,
        exact: true,
      }),
    );
    if (!i) {
      await waitFor(() => expect(writes).toHaveLength(1));
      await waitFor(() =>
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
      );
      expect(evidence).toHaveValue('模拟复核依据');
    }
  }
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: '源详情' })).toHaveFocus(),
  );
  expect(writes[0]).toEqual(writes[1]);
});

vi.mock('@nocobase/app-plugin-authentication/client', async (original) => ({
  ...(await original<
    typeof import('@nocobase/app-plugin-authentication/client')
  >()),
  useAuthentication: () => ({ session: { user: { id: 'business-test' } } }),
}));

it('clears the renewal contract and its derived effective date from the same input', async () => {
  api.request.mockImplementation(async ({ path }) =>
    path === 'splitRules/source-rule'
      ? {
          data: {
            id: 'source-rule',
            contractId: 'original',
            merchantId: 'm',
            version: 1,
            effectiveFrom: '2026-10-01',
            enabled: true,
            payload: {
              enabled: true,
              effectiveFrom: '2026-10-01',
              billFeeTypes: ['rent'],
              recipients: [
                {
                  key: 'p',
                  kind: 'project',
                  name: '项目',
                  accountLabel: '台账',
                  rate: '100',
                },
              ],
              notes: '',
            },
          },
        }
      : {
          data: [
            {
              id: 'renewal',
              number: 'HT-NEW',
              name: '续租商户',
              payload: { start: '2026-11-01', title: '续租合同名称' },
            },
          ],
          meta: { page: 1, pageSize: 20, total: 1 },
        },
  );
  mount(<SplitRuleForm />, '/profit-sharing/rules/source-rule/copy');
  const user = userEvent.setup(),
    input = await screen.findByRole('combobox', { name: '合同', exact: true });
  await user.click(input);
  await user.click(
    await screen.findByRole('option', { name: '续租合同名称 · HT-NEW' }),
  );
  expect(screen.getByLabelText('生效日期 *')).toHaveTextContent(
    '2026年11月1日',
  );
  await user.click(screen.getByRole('button', { name: '清空合同选择' }));
  expect(input).toHaveValue('');
  expect(screen.getByLabelText('生效日期 *')).not.toHaveTextContent('2026');
});

it('searches a split source with merchant and contract labels and invalidates its preview on clear or kind change', async () => {
  const doc = {
    id: 'source',
    number: 'ZD-1',
    merchantName: '商户甲',
    contractNumber: 'HT-1',
    contractTitle: '租约甲',
  };
  api.request.mockImplementation(async (r) =>
    r.path === 'splitOrders/preview'
      ? {
          data: {
            sourceNumber: 'ZD-1',
            sourceHash: 'hash',
            sourceFundsCents: '100',
            shareBaseCents: '100',
            remainingCents: '100',
            recoveryCents: '0',
            lines: [],
          },
        }
      : { data: [doc], meta: { page: 1, pageSize: 10, total: 1 } },
  );
  mount(<NewSplitOrder />, '/profit-sharing/orders/new');
  const user = userEvent.setup();
  const source = screen.getByRole('combobox', { name: '来源单据 *' });
  await user.type(source, '商户甲');
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'bills',
        query: expect.objectContaining({ q: '商户甲' }),
      }),
    ),
  );
  await user.click(
    await screen.findByRole('option', {
      name: 'ZD-1 · 商户甲 · 租约甲 · HT-1',
    }),
  );
  await user.click(screen.getByRole('button', { name: '预览', exact: true }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: '创建', exact: true }),
    ).toBeEnabled(),
  );
  await user.click(screen.getByRole('button', { name: '清空来源单据选择' }));
  expect(source).toHaveValue('');
  expect(
    screen.getByRole('button', { name: '创建', exact: true }),
  ).toBeDisabled();
  await user.click(source);
  await user.click(await screen.findByRole('option', { name: /ZD-1/ }));
  await user.click(screen.getByRole('combobox', { name: '来源类型' }));
  await user.click(await screen.findByRole('option', { name: '经营结算' }));
  expect(screen.getByRole('combobox', { name: '来源单据 *' })).toHaveValue('');
  expect(
    screen.getByRole('button', { name: '创建', exact: true }),
  ).toBeDisabled();
});
