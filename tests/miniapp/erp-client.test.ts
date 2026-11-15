// @vitest-environment node
import { createRequire } from 'node:module';
import { expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { createErpClient } = require('../../miniapp/lib/erp-client.js');
it('exchanges native codes, uses only in-memory credentials for API requests and upload, then clears them at sign-out', async () => {
  const native = {
    login: vi.fn((o) => o.success({ code: 'native-login' })),
    request: vi.fn((o) =>
      o.success({
        statusCode: 200,
        data: {
          data: o.url.endsWith('/signIn') ? { token: 'erp-session' } : [],
        },
      }),
    ),
    downloadFile: vi.fn((o) =>
      o.success({ statusCode: 200, tempFilePath: 'temp-preview.png' }),
    ),
    uploadFile: vi.fn((o) =>
      o.success({
        statusCode: 201,
        data: JSON.stringify({ data: { record: { id: 'image' } } }),
      }),
    ),
  };
  const app = createErpClient('https://erp.example.test/main', native);
  await app.login('native-phone');
  expect(native.request).toHaveBeenCalledWith(
    expect.objectContaining({
      url: 'https://erp.example.test/main/api/merchantMiniapp/signIn',
      data: { loginCode: 'native-login', phoneCode: 'native-phone' },
      header: {},
    }),
  );
  await app.request('/merchantMiniapp/merchants');
  expect(native.request).toHaveBeenLastCalledWith(
    expect.objectContaining({
      header: { Authorization: 'Bearer erp-session' },
    }),
  );
  await app.upload('draft-id', 'temp.jpg');
  expect(native.uploadFile).toHaveBeenCalledWith(
    expect.objectContaining({
      url: 'https://erp.example.test/main/api/reportingFiles/uploadOne?kind=revenueReports&recordId=draft-id',
      header: { Authorization: 'Bearer erp-session' },
      name: 'file',
    }),
  );
  await expect(
    app.downloadEvidence('12345678-1234-1234-1234-123456789012', 'png'),
  ).resolves.toBe('temp-preview.png');
  expect(native.downloadFile).toHaveBeenLastCalledWith(
    expect.objectContaining({
      url: 'https://erp.example.test/main/uploads/reportingEvidence/12345678-1234-1234-1234-123456789012.png',
      header: { Authorization: 'Bearer erp-session' },
    }),
  );
  await expect(app.downloadEvidence('../foreign', 'png')).rejects.toMatchObject(
    { code: 'PROFILE_FILE_TYPE' },
  );
  await app.signout();
  await app.request('/merchantMiniapp/merchants');
  expect(native.request).toHaveBeenLastCalledWith(
    expect.objectContaining({ header: {} }),
  );
});
it('rejects unconfigured or non-HTTPS origins and does not fall back to demo data', async () => {
  const native = { request: vi.fn(), login: vi.fn() };
  for (const base of [
    '',
    'http://erp.example.test',
    'https://erp.example.test@elsewhere.test',
  ]) {
    const client = createErpClient(base, native);
    expect(client.configured).toBe(false);
    await expect(client.login('proof')).rejects.toMatchObject({
      code: 'CONFIG_MISSING',
    });
  }
  expect(native.request).not.toHaveBeenCalled();
  expect(native.login).not.toHaveBeenCalled();
});
