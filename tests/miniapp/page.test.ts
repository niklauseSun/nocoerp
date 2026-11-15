// @vitest-environment node
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
const filename = new URL('../../miniapp/pages/home/index.js', import.meta.url);
const require = createRequire(filename);
function pageFixture() {
  const memory = new Map();
  const wx = {
    getStorageSync: (k: string) => memory.get(k),
    setStorageSync: (k: string, v: unknown) =>
      memory.set(k, structuredClone(v)),
    showModal: vi.fn().mockResolvedValue({ confirm: true }),
    showToast: vi.fn(),
    removeSavedFile: vi.fn(),
    pageScrollTo: vi.fn(),
    chooseMedia: vi.fn(),
    saveFile: vi.fn(),
    previewImage: vi.fn(),
  };
  let page: any;
  runInNewContext(readFileSync(filename, 'utf8'), {
    require,
    wx,
    Page: (definition: unknown) => {
      page = definition;
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
  page.onLoad();
  page.login();
  return { page, wx, memory };
}
it('guards dirty merchant switches and clears only discarded drafts', async () => {
  const { page, wx } = pageFixture();
  page.field({
    currentTarget: { dataset: { form: 'report', field: 'amount' } },
    detail: { value: '20' },
  });
  wx.showModal.mockResolvedValueOnce({ confirm: false });
  await page.switchMerchant({ detail: { value: '1' } });
  expect(page.data.view.merchant.id).toBe('demo-tea');
  expect(page.data.report.amount).toBe('20');
  page.pendingFiles = ['new-image'];
  await page.switchMerchant({ detail: { value: '1' } });
  expect(page.data.view.merchant.id).toBe('demo-gift');
  expect(page.data.report.amount).toBe('');
  expect(wx.removeSavedFile).toHaveBeenCalledWith(
    expect.objectContaining({ filePath: 'new-image' }),
  );
});
it('preserves form on validation failure and clears after success', () => {
  const { page } = pageFixture();
  page.setData({ 'report.amount': 'wrong', 'report.orders': '2', dirty: true });
  page.saveReport({ currentTarget: { dataset: { submit: 'yes' } } });
  expect(page.data.error).toContain('营业额');
  expect(page.data.report.amount).toBe('wrong');
  expect(page.data.dirty).toBe(true);
  page.setData({ 'report.amount': '0', 'report.orders': '0' });
  page.saveReport({ currentTarget: { dataset: { submit: 'yes' } } });
  expect(page.data.view.reports).toHaveLength(1);
  expect(page.data.report.amount).toBe('');
  expect(page.data.dirty).toBe(false);
});
it('never pays when confirmation is cancelled and prevents reentry while pending', async () => {
  const { page, wx } = pageFixture();
  let confirm: (value: unknown) => void = () => {};
  wx.showModal.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        confirm = resolve;
      }),
  );
  const event = { currentTarget: { dataset: { id: 'bill-tea-1' } } };
  const pending = page.pay(event);
  await page.pay(event);
  expect(wx.showModal).toHaveBeenCalledTimes(1);
  confirm({ confirm: false });
  await pending;
  expect(page.data.view.payments).toHaveLength(0);
  await page.pay(event);
  expect(page.data.view.payments).toHaveLength(1);
  await page.pay(event);
  expect(page.data.view.payments).toHaveLength(1);
});
it('cleans up image saved after page unload without attaching to another merchant', async () => {
  const { page, wx } = pageFixture();
  wx.chooseMedia.mockResolvedValue({ tempFiles: [{ tempFilePath: 'temp' }] });
  let saved: (value: unknown) => void = () => {};
  wx.saveFile.mockImplementation(
    () =>
      new Promise((resolve) => {
        saved = resolve;
      }),
  );
  const pending = page.image({
    currentTarget: { dataset: { form: 'report' } },
  });
  await vi.waitFor(() => expect(wx.saveFile).toHaveBeenCalledTimes(1));
  page.onUnload();
  saved({ savedFilePath: 'late-image' });
  await pending;
  expect(page.data.report.photos).toEqual([]);
  expect(wx.removeSavedFile).toHaveBeenCalledWith(
    expect.objectContaining({ filePath: 'late-image' }),
  );
});
it('removes cached view after revocation and does not leak stale merchant data', () => {
  const { page, memory } = pageFixture();
  const { KEY } = require('../../lib/store');
  page.saveReport({ currentTarget: { dataset: { submit: 'no' } } });
  const store = require('../../lib/store').createStore({
    get: (k: string) => memory.get(k),
    set: (k: string, v: unknown) => memory.set(k, v),
  });
  store.reset();
  memory.get(KEY).grants[0].active = false;
  page.refresh();
  expect(page.data.view).toBe(null);
  expect(page.data.merchants.map((m: { id: string }) => m.id)).toEqual([
    'demo-gift',
  ]);
  expect(page.data.report.amount).toBe('');
  expect(page.data.error).toBeTruthy();
});
