import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import {
  TestI18nProvider,
  createTestI18nRuntime,
} from '@nocobase/i18n/testing';
import zh from '../../client/locales/zh-CN.js';
import { useRecordSearchState } from '../../client/hooks/use-record-search.js';
import { RecordSearch } from '../../client/components/record-search.js';
const identity = vi.hoisted(() => ({ id: 'test', revision: 0 }));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ session: { user: { id: identity.id } } }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationRevision: () => identity.revision,
}));
const runtime = await createTestI18nRuntime({
  locale: 'zh-CN',
  application: { namespace: 'nocoerp', resources: zh },
});
afterEach(() => {
  cleanup();
  identity.id = 'test';
  identity.revision = 0;
});
const options = [
  { value: 'a', label: '合同甲 · HT-A' },
  { value: 'b', label: '合同乙 · HT-B' },
];
it('searches in one field, picks a record and clears with inline X and restored focus', async () => {
  const changed = vi.fn(),
    searched = vi.fn();
  function Example() {
    const [value, setValue] = useState('');
    return (
      <RecordSearch
        id='contract'
        label='合同'
        value={value}
        options={options}
        onSearch={searched}
        scopeKey='contracts'
        onChange={(v) => {
          setValue(v);
          changed(v);
        }}
      />
    );
  }
  render(
    <TestI18nProvider runtime={runtime}>
      <Example />
    </TestI18nProvider>,
  );
  const user = userEvent.setup(),
    input = screen.getByRole('combobox', { name: '合同' });
  expect(screen.queryByRole('textbox')).toBeNull();
  await user.type(input, '甲');
  expect(searched).toHaveBeenLastCalledWith('甲');
  await user.click(
    await screen.findByRole('option', { name: '合同甲 · HT-A' }),
  );
  expect(changed).toHaveBeenLastCalledWith('a');
  const clear = screen.getByRole('button', { name: '清空合同选择' });
  expect(clear.closest('[data-slot="input-group"]')).not.toBeNull();
  await user.click(clear);
  expect(changed).toHaveBeenLastCalledWith('');
  expect(input).toHaveValue('');
  expect(input).toHaveFocus();
});
it('preserves off-page caption and disabled state without a clear action', () => {
  render(
    <TestI18nProvider runtime={runtime}>
      <RecordSearch
        id='supplier'
        label='供应商'
        value='offpage'
        caption='历史供应商'
        options={[]}
        disabled
        onSearch={() => {}}
        onChange={() => {}}
        scopeKey='project-a'
      />
    </TestI18nProvider>,
  );
  expect(screen.getByRole('combobox', { name: '供应商' })).toHaveValue(
    '历史供应商',
  );
  expect(screen.getByRole('combobox', { name: '供应商' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: '清空供应商选择' })).toBeNull();
});
it('does not search unfinished Chinese composition or offer stale loading options', async () => {
  const search = vi.fn();
  render(
    <TestI18nProvider runtime={runtime}>
      <RecordSearch
        id='asset'
        label='资产'
        value=''
        options={options}
        loading
        onSearch={search}
        onChange={() => {}}
        scopeKey='assets'
      />
    </TestI18nProvider>,
  );
  const input = screen.getByRole('combobox', { name: '资产' });
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: 'qing' } });
  expect(search).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input, { target: { value: '清洁' } });
  expect(search).toHaveBeenLastCalledWith('清洁');
  expect(screen.queryByRole('option', { name: '合同甲 · HT-A' })).toBeNull();
});

it('keeps a search failure visible outside the popup and retries into fresh options', async () => {
  function Example() {
    const [failed, setFailed] = useState(true);
    return (
      <RecordSearch
        id='retry'
        label='资产'
        value=''
        scopeKey='asset'
        options={options}
        onSearch={() => {}}
        onChange={() => {}}
        status={
          failed ? (
            <div role='alert'>
              查询失败<button onClick={() => setFailed(false)}>重试</button>
            </div>
          ) : undefined
        }
      />
    );
  }
  render(
    <TestI18nProvider runtime={runtime}>
      <Example />
    </TestI18nProvider>,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('查询失败');
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: '资产' }));
  expect(screen.queryByRole('option', { name: '合同甲 · HT-A' })).toBeNull();
  await user.click(screen.getByRole('button', { name: '重试' }));
  await user.click(screen.getByRole('combobox', { name: '资产' }));
  expect(
    await screen.findByRole('option', { name: '合同甲 · HT-A' }),
  ).toBeVisible();
});

it('resets search and paging when source constraints or authorization change', async () => {
  function Probe({ source }: { source: string }) {
    const state = useRecordSearchState(source);
    return (
      <>
        <output data-testid='state'>
          {state.q}:{state.page}
        </output>
        <button
          onClick={() => {
            state.setQ('old');
            state.setPage(3);
          }}
        >
          旧查询
        </button>
      </>
    );
  }
  const view = render(<Probe source='project-a' />),
    user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '旧查询' }));
  expect(screen.getByTestId('state')).toHaveTextContent('old:3');
  view.rerender(<Probe source='project-b' />);
  expect(screen.getByTestId('state')).toHaveTextContent(':1');
  view.rerender(<Probe source='project-a' />);
  expect(screen.getByTestId('state')).toHaveTextContent(':1');
  await user.click(screen.getByRole('button', { name: '旧查询' }));
  identity.revision++;
  view.rerender(<Probe source='project-a' />);
  expect(screen.getByTestId('state')).toHaveTextContent(':1');
});

it('preserves replacement typing and IME commit while invalidating the selected ID', async () => {
  const changed = vi.fn(),
    searched = vi.fn();
  function Example() {
    const [value, setValue] = useState('a');
    return (
      <RecordSearch
        label='合同'
        value={value}
        options={options}
        scopeKey='contracts'
        onSearch={searched}
        onChange={(id) => {
          setValue(id);
          changed(id);
        }}
      />
    );
  }
  render(
    <TestI18nProvider runtime={runtime}>
      <Example />
    </TestI18nProvider>,
  );
  const user = userEvent.setup(),
    input = screen.getByRole('combobox', { name: '合同' }) as HTMLInputElement;
  await user.click(input);
  input.setSelectionRange(0, input.value.length);
  await user.type(input, '新', { skipClick: true });
  expect(input).toHaveValue('新');
  expect(changed).toHaveBeenLastCalledWith('');
  expect(searched).toHaveBeenLastCalledWith('新');
  await user.click(
    await screen.findByRole('option', { name: '合同甲 · HT-A' }),
  );
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: 'qing' } });
  expect(input).toHaveValue('qing');
  fireEvent.compositionEnd(input, { target: { value: '清洁' } });
  expect(input).toHaveValue('清洁');
  expect(changed).toHaveBeenLastCalledWith('');
  expect(searched).toHaveBeenLastCalledWith('清洁');
});

it('resets displayed text when the source, session or authorization scope changes', async () => {
  function Example({ source }: { source: string }) {
    const { setQ } = useRecordSearchState(source);
    return (
      <RecordSearch
        label='资产'
        value=''
        options={options}
        scopeKey={source}
        onSearch={setQ}
        onChange={() => {}}
      />
    );
  }
  const renderExample = (source: string) => (
    <TestI18nProvider runtime={runtime}>
      <Example source={source} />
    </TestI18nProvider>
  );
  const view = render(renderExample('a')),
    user = userEvent.setup();
  await user.type(screen.getByRole('combobox', { name: '资产' }), '旧搜索');
  view.rerender(renderExample('b'));
  expect(screen.getByRole('combobox', { name: '资产' })).toHaveValue('');
  view.rerender(renderExample('a'));
  expect(screen.getByRole('combobox', { name: '资产' })).toHaveValue('');
  await user.type(screen.getByRole('combobox', { name: '资产' }), '旧搜索');
  identity.revision++;
  view.rerender(renderExample('a'));
  expect(screen.getByRole('combobox', { name: '资产' })).toHaveValue('');
  await user.type(screen.getByRole('combobox', { name: '资产' }), '旧搜索');
  identity.id = 'another';
  view.rerender(renderExample('a'));
  expect(screen.getByRole('combobox', { name: '资产' })).toHaveValue('');
});
