// @vitest-environment node
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

const file = new URL('../../miniapp/pages/erp/index.js', import.meta.url);
const require = createRequire(file);
function fixture() {
  const shops = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
  ];
  const grants = { shops };
  const wx = {
    login: vi.fn((o) => o.success({ code: 'native-code' })),
    request: vi.fn((o) => {
      const path = new URL(o.url).pathname;
      const respond = (data: unknown) =>
        o.success({
          statusCode: 200,
          data: {
            data,
            meta: {
              page: 1,
              pageSize: 20,
              total: Array.isArray(data) ? data.length : 0,
            },
          },
        });
      if (path.endsWith('/signIn')) return respond({ token: 'session' });
      if (path.endsWith('/merchants')) return respond(grants.shops);
      if (
        !grants.shops.some((shop) =>
          path.includes('/merchants/' + shop.id + '/'),
        )
      )
        return o.success({
          statusCode: 403,
          data: { error: { reason: 'MINIAPP_NO_GRANT' } },
        });
      if (path.endsWith('/submit')) return respond({ status: 'pending' });
      if (o.method === 'POST')
        return respond({ id: 'draft', version: 0, status: 'draft', ...o.data });
      return respond([]);
    }),
    uploadFile: vi.fn((o) =>
      o.success({
        statusCode: 201,
        data: JSON.stringify({ data: { record: { id: 'uploaded' } } }),
      }),
    ),
    showToast: vi.fn(),
  };
  let page: any;
  runInNewContext(readFileSync(file, 'utf8'), {
    require: (name: string) =>
      name.endsWith('erp-config')
        ? { baseUrl: 'https://erp.example.test/main' }
        : require(name),
    wx,
    Page: (value: unknown) => {
      page = value;
    },
  });
  page.data = structuredClone(page.data);
  page.setData = (values: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(values)) {
      const path = key.split('.');
      let target = page.data;
      for (const part of path.slice(0, -1)) target = target[part];
      target[path.at(-1)!] = value;
    }
  };
  return { page, grants, wx };
}
it('uploads after saving the ERP draft and submits only after upload resolves', async () => {
  const { page, wx } = fixture();
  await page.login({ detail: { code: 'native-phone-code' } });
  page.setData({
    'report.amount': '0',
    'report.orders': '0',
    'report.photos': ['image.png'],
    dirty: true,
  });
  wx.uploadFile.mockImplementationOnce((o) => o.fail());
  const submit = { currentTarget: { dataset: { submit: 'yes' } } };
  await page.save(submit);
  expect(page.data.report).toMatchObject({
    id: 'draft',
    photos: ['image.png'],
  });
  expect(wx.request.mock.calls.some(([o]) => o.url.endsWith('/submit'))).toBe(
    false,
  );
  await page.save(submit);
  expect(wx.uploadFile).toHaveBeenLastCalledWith(
    expect.objectContaining({
      filePath: 'image.png',
      header: { Authorization: 'Bearer session' },
    }),
  );
  const req = wx.request.mock.calls.find(([o]) => o.url.endsWith('/submit'));
  expect(req?.[0]).toMatchObject({ data: { version: 0 } });
  expect(page.data.report.id).toBeUndefined();
});
it('reconciles partial revoke without discarding the still authorized session', async () => {
  const { page, grants, wx } = fixture();
  await page.login({ detail: { code: 'native-phone-code' } });
  grants.shops = grants.shops.filter((shop) => shop.id === 'b');
  await page.changeTab({ currentTarget: { dataset: { index: 1 } } });
  expect(page.data.logged).toBe(true);
  expect(page.data.merchants).toEqual([{ id: 'b', name: 'B' }]);
  expect(wx.request).toHaveBeenLastCalledWith(
    expect.objectContaining({
      url: 'https://erp.example.test/main/api/merchantMiniapp/merchants/b/bills?page=1',
      header: { Authorization: 'Bearer session' },
    }),
  );
});
