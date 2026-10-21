import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  TestI18nProvider,
  createTestI18nRuntime,
} from '@nocobase/i18n/testing';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ClientFileRepository } from '@nocobase/app-plugin-file/client';
import type { FileRecord } from '../../client/extensions/nocobase-file-component-ui/index.js';
import AssetFileForm from '../../client/pages/assets/files.js';
import BindingForm from '../../client/pages/assets/bindings.js';
import { bindingDrafts, fileDrafts } from '../../client/pages/assets/drafts.js';
import zh from '../../client/locales/zh-CN.js';
const { api, toaster } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  toaster: { show: vi.fn() },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useService: () => ({ repository: () => ({}) }),
  useToaster: () => toaster,
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ session: { user: { id: 'flow-test' } } }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationRevision: () => 0,
  useCan: () => ({ can: true }),
}));
vi.mock('../../client/extensions/nocobase-file-component-ui/index.js', () => ({
  FileUploadField: ({
    repository,
    onChange,
    onError,
    value,
  }: {
    repository: ClientFileRepository;
    onChange: (files: FileRecord[]) => void;
    onError: (error: unknown) => void;
    value: FileRecord[];
  }) => (
    <div>
      <span>{value[0]?.filename}</span>
      {['A', 'B'].map((name) => (
        <button
          key={name}
          type='button'
          onClick={() => {
            void repository
              .uploadOne({
                file: new File(['test'], `${name}.pdf`, {
                  type: 'application/pdf',
                }),
              })
              .then((result) => onChange([result.record]))
              .catch(onError);
          }}
        >
          上传{name}
        </button>
      ))}
    </div>
  ),
}));
vi.mock('../../client/pages/hyl/common.js', async (original) => ({
  ...(await original<typeof import('../../client/pages/hyl/common.js')>()),
  DateField: ({
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
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
const runtime = await createTestI18nRuntime({
  locale: 'zh-CN',
  application: { namespace: 'nocoerp', resources: zh },
});
function mount(element: React.ReactNode, path: string) {
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
              path='/assets/:id'
              element={
                <>
                  <p>资产详情</p>
                  <Outlet />
                </>
              }
            >
              <Route path='files/new' element={element} />
            </Route>
            <Route
              path='/merchants/:id'
              element={
                <>
                  <p>商户详情</p>
                  <Outlet />
                </>
              }
            >
              <Route path='assets/new' element={element} />
              <Route path='assets/:bindingId/close' element={element} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </TestI18nProvider>,
  );
}
beforeEach(() => {
  api.request.mockReset();
  toaster.show.mockReset();
  bindingDrafts.clear();
  fileDrafts.clear();
});
afterEach(cleanup);
it('links selected drawing B and cleans unused upload A on successful save', async () => {
  const pending: FileRecord[] = [];
  api.request.mockImplementation(
    ({
      path,
      body,
      json,
    }: {
      path: string;
      body?: FormData;
      json?: { fileId?: string; filter?: { id: string } };
    }) => {
      if (path === 'assetFiles/uploadOne') {
        const file = body?.get('file') as File;
        const record = { id: file.name, filename: file.name } as FileRecord;
        pending.push(record);
        return Promise.resolve({ data: { record, createdTargets: [] } });
      }
      if (path === 'assets/a1/files') {
        pending.splice(
          pending.findIndex((f) => f.id === json?.fileId),
          1,
        );
        return Promise.resolve({ data: { id: json?.fileId } });
      }
      if (path === 'assetFiles/deleteOne') {
        pending.splice(
          pending.findIndex((f) => f.id === json?.filter?.id),
          1,
        );
        return Promise.resolve({ data: { deletedCount: 1 } });
      }
      return Promise.resolve({ data: { files: [...pending], cleanupIds: [] } });
    },
  );
  mount(<AssetFileForm />, '/assets/a1/files/new?state=normal');
  await userEvent.type(await screen.findByLabelText('附件标题 *'), '图纸标题');
  await userEvent.click(screen.getByRole('button', { name: '上传A' }));
  await screen.findByText('A.pdf');
  await userEvent.click(screen.getByRole('button', { name: '上传B' }));
  await screen.findByText('B.pdf');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'assetFiles/deleteOne',
        json: { filter: { id: 'A.pdf' } },
      }),
    ),
  );
  expect(
    api.request.mock.calls
      .filter(([args]) => args.path === 'assetFiles/deleteOne')
      .some(([args]) => args.json.filter.id === 'B.pdf'),
  ).toBe(false);
});
it('retains recovered upload and title after linking fails, then retries successfully', async () => {
  let attempts = 0;
  let pending = true;
  api.request.mockImplementation(({ path }: { path: string }) =>
    path === 'assets/a1/files'
      ? ++attempts === 1
        ? Promise.reject(new Error('offline'))
        : ((pending = false), Promise.resolve({ data: { id: 'recovered' } }))
      : Promise.resolve({
          data: {
            files: pending
              ? [{ id: 'recovered', filename: '恢复图纸.pdf' }]
              : [],
            cleanupIds: [],
          },
        }),
  );
  mount(<AssetFileForm />, '/assets/a1/files/new');
  await userEvent.click(
    await screen.findByRole('button', { name: '恢复未完成的上传' }),
  );
  await userEvent.type(screen.getByLabelText('附件标题 *'), '保留图纸');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.getByLabelText('附件标题 *')).toHaveValue('保留图纸');
  expect(screen.getByText('恢复图纸.pdf')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(attempts).toBe(2));
});
it('validates closing period and asks for destructive confirmation before saving', async () => {
  api.request.mockImplementation(({ method }: { method?: string }) =>
    Promise.resolve(
      method === 'POST'
        ? { data: { id: 'b1' } }
        : {
            data: [
              {
                id: 'b1',
                assetId: 'a1',
                start: '2026-01-01',
                end: '2026-12-31',
                version: 2,
                asset: { name: '一号铺位' },
              },
            ],
          },
    ),
  );
  mount(<BindingForm />, '/merchants/m1/assets/b1/close?contactPage=2');
  await userEvent.type(
    await screen.findByLabelText('使用截止日期 *'),
    '2026-06-30',
  );
  await userEvent.type(screen.getByLabelText('变更原因 *'), '结束使用');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  expect(api.request.mock.calls.some(([args]) => args.method === 'POST')).toBe(
    false,
  );
  await userEvent.click(screen.getByRole('button', { name: '结束绑定' }));
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'merchants/m1/assets/b1/close',
        json: { end: '2026-06-30', reason: '结束使用', expectedVersion: 2 },
      }),
    ),
  );
});

it('cleans a response-lost upload by its session uploadId and keeps the dialog open if cleanup fails', async () => {
  let pending: { id: string; filename: string; uploadId: string } | undefined;
  let cleanupAttempts = 0;
  api.request.mockImplementation(
    ({ path, query }: { path: string; query?: { uploadId: string } }) => {
      if (path === 'assetFiles/uploadOne') {
        pending = { id: 'lost', filename: 'A.pdf', uploadId: query!.uploadId };
        return Promise.reject(new Error('response lost'));
      }
      if (path === 'assetFiles/deleteOne') {
        if (++cleanupAttempts === 1)
          return Promise.reject(new Error('disk unavailable'));
        pending = undefined;
        return Promise.resolve({ data: { deletedCount: 1 } });
      }
      return Promise.resolve({
        data: { files: pending ? [pending] : [], cleanupIds: [] },
      });
    },
  );
  mount(<AssetFileForm />, '/assets/a1/files/new');
  await userEvent.click(await screen.findByRole('button', { name: '上传A' }));
  await screen.findByRole('alert');
  await userEvent.click(screen.getByRole('button', { name: '取消' }));
  await userEvent.click(
    await screen.findByRole('button', { name: '放弃修改' }),
  );
  await waitFor(() => expect(cleanupAttempts).toBe(1));
  expect(screen.getByRole('dialog', { name: '新增附件' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '取消' }));
  await userEvent.click(
    await screen.findByRole('button', { name: '放弃修改' }),
  );
  await waitFor(() => expect(cleanupAttempts).toBe(2));
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'assetFiles/deleteOne',
      json: { filter: { id: 'lost' } },
    }),
  );
});
