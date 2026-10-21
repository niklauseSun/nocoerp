import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  TestI18nProvider,
  createTestI18nRuntime,
} from '@nocobase/i18n/testing';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import zh from '../../client/locales/zh-CN.js';
import filePlugin from '@nocobase/app-plugin-file/client';
import { ApiClientError } from '@nocobase/app-client';
import BusinessForm from '../../client/pages/hyl/form.js';
import MerchantRecordForm from '../../client/pages/hyl/merchant-profile/form.js';
import { MerchantRecords } from '../../client/pages/hyl/merchant-profile/records.js';
const { api, permission, toaster } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  permission: { can: true },
  toaster: { show: vi.fn() },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => ({
    request: (args: { path: string }) =>
      args.path === 'users'
        ? Promise.resolve({ data: [], meta: { total: 0 } })
        : args.path === 'assets'
          ? Promise.resolve({
              data: [{ id: 'asset1', name: 'A1', number: 'ZC001' }],
              meta: { total: 1 },
            })
          : args.path === 'assets/asset1'
            ? Promise.resolve({
                data: { id: 'asset1', name: 'A1', number: 'ZC001' },
              })
            : api.request(args),
  }),
  useNavigationGuard: vi.fn(),
  useService: () => ({ repository: () => ({}) }),
  useToaster: () => toaster,
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ session: { user: { id: 'ui-test' } } }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationRevision: () => 0,
  useCan: () => permission,
}));
const runtime = await createTestI18nRuntime({
  locale: 'zh-CN',
  namespaces: { '@nocobase/app-plugin-file': filePlugin().locales ?? {} },
  application: { namespace: 'nocoerp', resources: zh },
});
function mount(
  element: React.ReactNode,
  path = '/merchants/ui-test/contacts/new',
  cached?: unknown,
  detail?: React.ReactNode,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (cached)
    client.setQueryData(['hyl', 'merchants/stale-test', undefined], cached);
  const view = render(
    <TestI18nProvider runtime={runtime}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path='/contracts'
              element={<Outlet context={{ kind: 'contracts' }} />}
            >
              <Route path='new' element={element} />
            </Route>
            <Route
              path='/merchants'
              element={<Outlet context={{ kind: 'merchants' }} />}
            >
              <Route path='new' element={element} />
            </Route>
            <Route
              path='/merchants/:id'
              element={
                <>
                  <p>商户详情测试</p>
                  {detail}
                  <Outlet
                    context={{ kind: 'merchants', row: { name: '测试商户' } }}
                  />
                </>
              }
            >
              <Route path='contacts/new' element={element} />
              <Route path='edit' element={element} />
              <Route path='licenses/new' element={element} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </TestI18nProvider>,
  );
  return { ...view, client };
}
beforeEach(() => {
  api.request.mockReset();
  permission.can = true;
  toaster.show.mockReset();
});
afterEach(cleanup);
it('renders the contact form under the application’s non-data router and validates before saving', async () => {
  api.request.mockResolvedValue({ data: { id: 'ui-test', name: '测试商户' } });
  mount(<MerchantRecordForm />);
  expect(
    await screen.findByRole('dialog', { name: '新增联系记录' }),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '创建' })).toBeEnabled(),
  );
  await userEvent.click(screen.getByRole('button', { name: '创建' }));
  expect(await screen.findAllByText('请填写此项。')).not.toHaveLength(0);
  expect(
    api.request.mock.calls.filter(([args]) => args.method === 'POST'),
  ).toHaveLength(0);
  await waitFor(() =>
    expect(screen.getByLabelText('发生日期 *')).toHaveFocus(),
  );
  const person = screen.getByLabelText('对接人 *');
  await userEvent.type(person, '张三');
  expect(person).toHaveValue('张三');
  await userEvent.type(screen.getByLabelText('联系方式或沟通渠道 *'), '电话');
  await userEvent.type(
    screen.getByLabelText('内容 *'),
    '已联系商户补齐营业执照',
  );
  expect(screen.getByLabelText('内容 *')).toHaveValue('已联系商户补齐营业执照');
});
it('shows an empty record section and hides creation for read-only users', async () => {
  permission.can = false;
  api.request.mockResolvedValue({
    data: [],
    meta: { total: 0, page: 1, pageSize: 20 },
  });
  mount(<MerchantRecords id='ui-test' type='visit' />);
  expect(await screen.findByText('尚无走访记录')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: '新增走访记录' }),
  ).not.toBeInTheDocument();
});
it('keeps follow-up content and displays every historical record separately', async () => {
  api.request.mockResolvedValue({
    data: ['第一次走访', '第二次走访'].map((content, i) => ({
      id: String(i),
      date: '2026-10-14',
      actor: 'manager',
      createdAt: '2026-10-14T00:00:00Z',
      payload: {
        date: '2026-10-14',
        person: '张三',
        content,
        nextDate: '2026-10-20',
      },
    })),
    meta: { total: 2, page: 1, pageSize: 20 },
  });
  mount(<MerchantRecords id='ui-test' type='visit' />);
  expect(await screen.findByText('第一次走访')).toBeInTheDocument();
  expect(screen.getByText('第二次走访')).toBeInTheDocument();
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'merchants/ui-test/interactions',
        query: { page: 1, pageSize: 20, type: 'visit' },
      }),
    ),
  );
});
async function fillContact() {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '创建' })).toBeEnabled(),
  );
  await userEvent.click(screen.getByLabelText('发生日期 *'));
  const now = new Date();
  const day = new RegExp(
    `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`,
  );
  await userEvent.click(screen.getByRole('button', { name: day }));
  await userEvent.type(screen.getByLabelText('对接人 *'), '李四');
  await userEvent.type(screen.getByLabelText('联系方式或沟通渠道 *'), '电话');
  await userEvent.type(screen.getByLabelText('内容 *'), '确认下周走访时间');
}
it('saves a contact and returns to the same merchant detail', async () => {
  api.request.mockImplementation(
    (args: { method?: string; json?: Record<string, string> }) =>
      Promise.resolve(
        args.method === 'POST'
          ? {
              data: {
                id: 'saved-record',
                merchantId: 'save-test',
                type: 'contact',
                date: args.json?.date,
                actor: 'ui-test',
                createdAt: '2026-10-15T00:00:00Z',
                payload: args.json,
              },
            }
          : { data: { id: 'save-test', name: '测试商户' } },
      ),
  );
  mount(<MerchantRecordForm />, '/merchants/save-test/contacts/new?q=keep');
  await fillContact();
  await userEvent.click(screen.getByRole('button', { name: '创建' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: '新增联系记录' }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByText('商户详情测试')).toBeInTheDocument();
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'merchants/save-test/interactions',
      method: 'POST',
      json: expect.objectContaining({
        type: 'contact',
        person: '李四',
        content: '确认下周走访时间',
        requestId: expect.any(String),
      }),
    }),
  );
});
it('retains entered text and request identity on a failed save and retry', async () => {
  api.request.mockImplementation((args: { method?: string }) =>
    args.method === 'POST'
      ? Promise.reject(new Error('Network test'))
      : Promise.resolve({ data: { id: 'retry-test', name: '测试商户' } }),
  );
  mount(<MerchantRecordForm />, '/merchants/retry-test/contacts/new');
  await fillContact();
  await userEvent.click(screen.getByRole('button', { name: '创建' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.getByLabelText('内容 *')).toHaveValue('确认下周走访时间');
  await userEvent.click(screen.getByRole('button', { name: '创建' }));
  await waitFor(() =>
    expect(
      api.request.mock.calls.filter(([args]) => args.method === 'POST'),
    ).toHaveLength(2),
  );
  const calls = api.request.mock.calls.filter(
    ([args]) => args.method === 'POST',
  );
  expect(calls[0][0].json.requestId).toBe(calls[1][0].json.requestId);
});
it.each([401, 403, 404])(
  'prevents repeat submission after terminal POST %s',
  async (status) => {
    api.request.mockImplementation((args: { method?: string }) =>
      args.method === 'POST'
        ? Promise.reject(
            new ApiClientError('Terminal test', {
              status,
              method: 'POST',
              url: '/contacts',
            }),
          )
        : Promise.resolve({
            data: { id: `terminal-${status}`, name: '测试商户' },
          }),
    );
    mount(<MerchantRecordForm />, `/merchants/terminal-${status}/contacts/new`);
    await fillContact();
    await userEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled();
  },
);
it('waits for a fresh edit response instead of prefilling a cached merchant', async () => {
  const payload = {
    code: 'm1',
    category: '旧经营品类',
    name: '旧名称',
    unit: 'A1',
    contact: '张三',
    phone: '123',
    accountName: '张三',
    bank: '银行',
    account: '123',
    active: true,
  };
  let finish!: (value: unknown) => void;
  api.request.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  mount(<BusinessForm />, '/merchants/stale-test/edit', {
    data: { id: 'stale-test', number: 'm1', version: 0, payload },
  });
  expect(screen.queryByDisplayValue('旧名称')).not.toBeInTheDocument();
  finish({
    data: {
      id: 'stale-test',
      number: 'm1',
      version: 2,
      payload: { ...payload, name: '最新名称' },
    },
  });
  expect(await screen.findByDisplayValue('最新名称')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: '经营品类' })).toHaveTextContent(
    '旧经营品类',
  );
});
it('keeps the saved response visible if the subsequent list refresh fails', async () => {
  let saved = false;
  api.request.mockImplementation(
    (args: {
      method?: string;
      path: string;
      json?: Record<string, string>;
    }) => {
      if (args.method === 'POST') {
        saved = true;
        return Promise.resolve({
          data: {
            id: 'cached-record',
            merchantId: 'cache-test',
            type: 'contact',
            date: args.json?.date,
            actor: 'ui-test',
            createdAt: '2026-10-15T00:00:00Z',
            payload: args.json,
          },
        });
      }
      if (args.path.endsWith('/interactions'))
        return saved
          ? Promise.reject(new Error('Refresh failed'))
          : Promise.resolve({
              data: [],
              meta: { total: 0, page: 1, pageSize: 20 },
            });
      return Promise.resolve({ data: { id: 'cache-test', name: '测试商户' } });
    },
  );
  mount(
    <MerchantRecordForm />,
    '/merchants/cache-test/contacts/new',
    undefined,
    <MerchantRecords id='cache-test' type='contact' />,
  );
  await fillContact();
  await userEvent.click(screen.getByRole('button', { name: '创建' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: '新增联系记录' }),
    ).not.toBeInTheDocument(),
  );
  expect(await screen.findByText('确认下周走访时间')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toBeInTheDocument();
});
it('focuses the upload control when a license is missing its required file', async () => {
  api.request.mockImplementation((args: { path: string }) =>
    Promise.resolve(
      args.path.endsWith('/licenseUploads')
        ? { data: { files: [], cleanupIds: [] } }
        : { data: { id: 'license-focus', name: '测试商户' } },
    ),
  );
  mount(<MerchantRecordForm />, '/merchants/license-focus/licenses/new');
  await userEvent.type(await screen.findByLabelText('证照名称 *'), '营业执照');
  await userEvent.type(screen.getByLabelText('证照类型 *'), '营业执照');
  await userEvent.click(screen.getByRole('button', { name: '创建' }));
  expect(await screen.findByText('请填写此项。')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '选择文件' })).toHaveFocus();
});
it('preserves an upload result after the widget unmounts during its request', async () => {
  let finish!: (value: unknown) => void;
  api.request.mockImplementation((args: { path: string }) =>
    args.path.endsWith('/uploadOne')
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(
          args.path.endsWith('/licenseUploads')
            ? { data: { files: [], cleanupIds: [] } }
            : { data: { id: 'upload-leave', name: '测试商户' } },
        ),
  );
  const view = mount(
    <MerchantRecordForm />,
    '/merchants/upload-leave/licenses/new',
  );
  const input = await screen.findByLabelText('选择文件', { selector: 'input' });
  await userEvent.upload(
    input,
    new File(['%PDF-1.4'], 'pending.pdf', { type: 'application/pdf' }),
  );
  await waitFor(() =>
    expect(
      api.request.mock.calls.some(([args]) => args.path.endsWith('/uploadOne')),
    ).toBe(true),
  );
  const call = api.request.mock.calls.find(([args]) =>
    args.path.endsWith('/uploadOne'),
  )![0];
  expect(call.query.uploadId).toEqual(expect.any(String));
  expect(call.signal).toBeUndefined();
  view.unmount();
  finish({
    data: {
      record: {
        id: 'file-pending',
        disk: 'local',
        key: 'objects/test.pdf',
        filename: 'pending.pdf',
        ext: 'pdf',
        mimeType: 'application/pdf',
        size: 8,
        createdAt: '2026-10-15T00:00:00Z',
        updatedAt: '2026-10-15T00:00:00Z',
        contentUrl: '/main/uploads/merchantLicenses/test.pdf',
      },
      createdTargets: [],
    },
  });
  await waitFor(() =>
    expect(
      api.request.mock.calls.filter(([args]) =>
        args.path.endsWith('/uploadOne'),
      ),
    ).toHaveLength(1),
  );
  mount(<MerchantRecordForm />, '/merchants/upload-leave/licenses/new');
  expect(await screen.findByText('pending.pdf')).toBeInTheDocument();
});

it('creates a merchant without asking for or submitting a merchant number', async () => {
  api.request.mockImplementation(async ({ path, method }) =>
    method === 'POST'
      ? { data: { id: 'generated', number: 'SH123' } }
      : path === 'assets/asset1'
        ? { data: { id: 'asset1', name: 'A1', number: 'ZC001' } }
        : path === 'assets'
          ? {
              data: [{ id: 'asset1', name: 'A1', number: 'ZC001' }],
              meta: { total: 1 },
            }
          : { data: [], meta: { total: 0 } },
  );
  mount(<BusinessForm />, '/merchants/new');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '创建' })).toBeEnabled(),
  );
  expect(screen.queryByLabelText(/商户编号/)).not.toBeInTheDocument();
  expect(screen.getByText('商户编号将在保存时自动生成。')).toBeInTheDocument();
  for (const [label, value] of [
    ['商户名称', '自动编号商户'],
    ['联系人', '张三'],
    ['联系电话', '123'],
    ['收款户名', '张三'],
    ['开户行', '银行'],
    ['收款账号', '123'],
  ])
    await userEvent.type(screen.getByLabelText(`${label} *`), value);
  await userEvent.type(screen.getByRole('combobox', { name: '铺位' }), 'A1');
  await userEvent.click(
    await screen.findByRole('option', { name: 'A1 · ZC001' }),
  );
  await userEvent.click(screen.getByRole('button', { name: '创建' }));
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'merchants',
        method: 'POST',
        json: expect.objectContaining({ name: '自动编号商户' }),
      }),
    ),
  );
  const submitted = api.request.mock.calls.find(
    ([args]) => args.method === 'POST',
  )?.[0].json;
  expect(submitted).not.toHaveProperty('code');
});
it('offers business categories and requires a name only when other is selected', async () => {
  api.request.mockResolvedValue({
    data: { id: 'category-test', number: 'SH123' },
  });
  mount(<BusinessForm />, '/merchants/new');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '创建' })).toBeEnabled(),
  );
  expect(screen.queryByLabelText(/经营品类或费用类别/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText('其他品类名称 *')).not.toBeInTheDocument();
  screen.getByRole('combobox', { name: '经营品类' }).focus();
  await userEvent.keyboard('{ArrowDown}');
  for (const name of ['餐饮', '零售', '文创', '休闲娱乐', '生活服务', '其他'])
    expect(
      await screen.findByRole('option', { name, exact: true }),
    ).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('option', { name: '其他', exact: true }),
  );
  await userEvent.click(screen.getByRole('button', { name: '创建' }));
  expect(screen.getByLabelText('其他品类名称 *')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await userEvent.type(screen.getByLabelText('其他品类名称 *'), '民宿');
  screen.getByRole('combobox', { name: '经营品类' }).focus();
  await userEvent.keyboard('{ArrowDown}');
  await userEvent.click(
    screen.getByRole('option', { name: '零售', exact: true }),
  );
  expect(screen.queryByLabelText('其他品类名称 *')).not.toBeInTheDocument();
  for (const [label, value] of [
    ['商户名称', '品类测试'],
    ['联系人', '张三'],
    ['联系电话', '123'],
    ['收款户名', '张三'],
    ['开户行', '银行'],
    ['收款账号', '123'],
  ])
    await userEvent.type(screen.getByLabelText(`${label} *`), value);
  await userEvent.type(screen.getByRole('combobox', { name: '铺位' }), 'A1');
  await userEvent.click(
    await screen.findByRole('option', { name: 'A1 · ZC001' }),
  );
  await userEvent.click(screen.getByRole('button', { name: '创建' }));
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        json: expect.objectContaining({
          category: 'merchantRetail',
          categoryName: '',
        }),
      }),
    ),
  );
});
it('uploads a business license before atomically submitting it and safely retries an uncertain save', async () => {
  let finishUpload!: (value: unknown) => void;
  let failSave!: (cause: Error) => void;
  const submissions: unknown[] = [];
  api.request.mockImplementation(
    (args: {
      path: string;
      method?: string;
      json?: Record<string, unknown>;
    }) => {
      if (args.path === 'merchantLicenseFiles/uploadOne')
        return new Promise((resolve) => {
          finishUpload = resolve;
        });
      if (args.method === 'POST' && args.path === 'merchants') {
        submissions.push(args.json);
        return submissions.length === 1
          ? new Promise((_resolve, reject) => {
              failSave = reject;
            })
          : Promise.resolve({
              data: { id: args.json?.creationId, number: 'SH-SAVED' },
            });
      }
      return Promise.resolve({ data: { files: [], cleanupIds: [] } });
    },
  );
  const view = mount(<BusinessForm />, '/merchants/new');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '创建' })).toBeEnabled(),
  );
  for (const [label, value] of [
    ['商户名称', '上传测试'],
    ['联系人', '张三'],
    ['联系电话', '123'],
    ['收款户名', '张三'],
    ['开户行', '银行'],
    ['收款账号', '123'],
  ])
    await userEvent.type(screen.getByLabelText(`${label} *`), value);
  await userEvent.type(screen.getByRole('combobox', { name: '铺位' }), 'A1');
  await userEvent.click(
    await screen.findByRole('option', { name: 'A1 · ZC001' }),
  );
  const input =
    view.container.querySelector<HTMLInputElement>('input[type=file]')!;
  await userEvent.upload(
    input,
    new File(['scan'], 'license.png', { type: 'image/png' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /正在保存/ })).toBeDisabled(),
  );
  expect(submissions).toHaveLength(0);
  finishUpload({
    data: {
      record: {
        id: 'uploaded-license',
        filename: 'license.png',
        ext: 'png',
        mimeType: 'image/png',
        size: 4,
        contentUrl: '/watermarked',
      },
      createdTargets: [],
    },
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '创建' })).toBeEnabled(),
  );
  expect(screen.getByText('license.png')).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '创建' })).toBeEnabled(),
  );
  await userEvent.click(screen.getByRole('button', { name: '创建' }));
  await waitFor(() => expect(submissions).toHaveLength(1));
  expect(input).toBeDisabled();
  expect(
    view.container.querySelector('button[aria-label$="license.png"]'),
  ).toBeDisabled();
  failSave(new Error('Response lost'));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.getByLabelText('商户名称 *')).toBeDisabled();
  expect(screen.getByText(/保存结果尚未确认/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '创建' }));
  await waitFor(() => expect(submissions).toHaveLength(2));
  expect(submissions[0]).toEqual(submissions[1]);
  expect(submissions[0]).toMatchObject({
    name: '上传测试',
    licenseFileId: 'uploaded-license',
    creationId: expect.any(String),
  });
});
it('recovers an unfinished license and retains it when cancellation cleanup fails', async () => {
  let deletes = 0;
  api.request.mockImplementation((args: { path: string }) => {
    if (args.path === 'merchantLicenseFiles/deleteOne') {
      deletes++;
      return deletes === 1
        ? Promise.reject(new Error('Cleanup test failure'))
        : Promise.resolve({ data: { deletedCount: 1 } });
    }
    return Promise.resolve({
      data: {
        files: [
          {
            id: 'recover-license',
            filename: 'unfinished.pdf',
            ext: 'pdf',
            mimeType: 'application/pdf',
            size: 10,
            contentUrl: '/watermarked',
          },
        ],
        cleanupIds: [],
      },
    });
  });
  mount(<BusinessForm />, '/merchants/new');
  await userEvent.click(
    await screen.findByRole('button', { name: /恢复未完成的上传/ }),
  );
  expect(screen.getByText('unfinished.pdf')).toBeInTheDocument();
  const cancel = () =>
    userEvent.click(screen.getAllByRole('button', { name: '取消' }).at(-1)!);
  await cancel();
  await userEvent.click(screen.getByRole('button', { name: '放弃修改' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.getByText('unfinished.pdf')).toBeInTheDocument();
  await cancel();
  await userEvent.click(screen.getByRole('button', { name: '放弃修改' }));
  await waitFor(() => expect(deletes).toBe(2));
});

it('omits the contract number input and preserves the contract period group', () => {
  api.request.mockResolvedValue({ data: [], meta: { total: 0 } });
  mount(<BusinessForm />, '/contracts/new');
  expect(screen.queryByLabelText(/合同编号/)).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: '商户' })).toHaveAttribute(
    'placeholder',
    '输入商户名称或编号搜索',
  );
  expect(
    screen.queryByPlaceholderText('搜索名称、编号或参考号'),
  ).not.toBeInTheDocument();
  expect(screen.getByText('合同编号将在保存时自动生成。')).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { name: '合同与周期' }),
  ).toBeInTheDocument();
});
