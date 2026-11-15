/* global require, wx, Page */
const copy = require('../../lib/copy');
const { createStore, yuan } = require('../../lib/store');
const store = createStore({
  get: (key) => wx.getStorageSync(key),
  set: (key, value) => wx.setStorageSync(key, value),
});
function reportForm() {
  return {
    id: '',
    version: 0,
    date: store.today(),
    amount: '',
    orders: '',
    note: '',
    photos: [],
  };
}
function repairForm() {
  return {
    title: '',
    description: '',
    phone: copy.demoPhone,
    category: 0,
    photos: [],
  };
}
Page({
  data: {
    copy,
    phone: copy.demoPhone,
    logged: false,
    busy: false,
    error: '',
    errorCode: '',
    tab: 0,
    merchants: [],
    merchantIndex: 0,
    view: null,
    report: reportForm(),
    repair: repairForm(),
    today: store.today(),
    dirty: false,
    pendingFiles: [],
    amountDue: '0.00',
    billCount: 0,
    submittedCount: 0,
  },
  onLoad() {
    this.pendingFiles = [];
    this.busy = false;
    this.disposed = false;
  },
  // Drafts are deliberately memory-only. User navigation inside this page confirms discard.
  onUnload() {
    this.disposed = true;
    this.cleanupPending();
  },
  error(error) {
    this.setData({
      error: copy.errors[error.code] || copy.storageError,
      errorCode: error.code || 'STORAGE',
    });
  },
  refresh() {
    let merchants = [];
    try {
      merchants = store.login(this.data.phone);
      const current = this.data.merchants[this.data.merchantIndex];
      const merchantId = current ? current.id : merchants[0].id;
      const view = store.view(this.data.phone, merchantId);
      view.reports = view.reports.map((r) => ({
        ...r,
        amountText: yuan(r.amount),
        statusText: r.status === 'draft' ? copy.draft : copy.submitted,
      }));
      view.bills = view.bills.map((b) => ({
        ...b,
        remaining: b.amount - b.paid,
        amountText: yuan(b.amount - b.paid),
      }));
      view.payments = view.payments.map((p) => ({
        ...p,
        amountText: yuan(p.amount),
        timeText: new Date(Date.parse(p.at) + 8 * 3600000)
          .toISOString()
          .replace('T', ' ')
          .slice(0, 16),
      }));
      this.setData({
        view,
        merchants,
        merchantIndex: merchants.findIndex((m) => m.id === merchantId),
        amountDue: yuan(view.bills.reduce((sum, b) => sum + b.remaining, 0)),
        billCount: view.bills.filter((b) => b.remaining > 0).length,
        submittedCount: view.reports.filter((r) => r.status === 'submitted')
          .length,
      });
    } catch (error) {
      this.setData({ view: null });
      if (['UNAUTHORIZED', 'UNKNOWN_PHONE'].includes(error.code)) {
        this.cleanupPending();
        this.setData({
          merchants,
          merchantIndex: 0,
          report: reportForm(),
          repair: repairForm(),
          dirty: false,
        });
      }
      this.error(error);
    }
  },
  phoneInput(e) {
    this.setData({ phone: e.detail.value, error: '', errorCode: '' });
  },
  login() {
    try {
      const merchants = store.login(this.data.phone);
      this.setData({
        merchants,
        merchantIndex: 0,
        logged: true,
        error: '',
        errorCode: '',
      });
      this.refresh();
    } catch (error) {
      this.error(error);
    }
  },
  async guard() {
    if (this.busy) return false;
    if (!this.data.dirty) return true;
    const result = await wx.showModal({
      title: copy.discardTitle,
      content: copy.discardHint,
      confirmText: copy.confirm,
      cancelText: copy.cancel,
    });
    if (!result.confirm) return false;
    this.cleanupPending();
    this.setData({
      report: reportForm(),
      repair: repairForm(),
      dirty: false,
      error: '',
      errorCode: '',
    });
    return true;
  },
  async switchMerchant(e) {
    if (!(await this.guard())) return;
    this.setData({
      merchantIndex: Number(e.detail.value),
      report: reportForm(),
      repair: repairForm(),
      error: '',
      errorCode: '',
    });
    this.refresh();
  },
  async tab(e) {
    const tab = Number(e.currentTarget.dataset.index);
    if (tab === this.data.tab || !(await this.guard())) return;
    this.setData({ tab, error: '', errorCode: '' });
    this.refresh();
  },
  field(e) {
    const { form, field } = e.currentTarget.dataset;
    if (
      !['report', 'repair'].includes(form) ||
      !Object.prototype.hasOwnProperty.call(this.data[form], field)
    )
      return;
    this.setData({
      [`${form}.${field}`]:
        field === 'category' ? Number(e.detail.value) : e.detail.value,
      dirty: true,
      error: '',
      errorCode: '',
    });
  },
  cleanupPending() {
    for (const filePath of this.pendingFiles || [])
      wx.removeSavedFile({ filePath, fail() {} });
    this.pendingFiles = [];
  },
  async image(e) {
    const form = e.currentTarget.dataset.form;
    if (
      this.busy ||
      !['report', 'repair'].includes(form) ||
      this.data[form].photos.length >= 3
    )
      return;
    this.busy = true;
    this.setData({ busy: true });
    try {
      const result = await wx.chooseMedia({
        count: 3 - this.data[form].photos.length,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
      });
      for (const file of result.tempFiles) {
        const saved = await wx.saveFile({ tempFilePath: file.tempFilePath });
        if (this.disposed) {
          wx.removeSavedFile({ filePath: saved.savedFilePath, fail() {} });
          return;
        }
        this.pendingFiles.push(saved.savedFilePath);
        this.setData({
          [`${form}.photos`]: [...this.data[form].photos, saved.savedFilePath],
          dirty: true,
        });
      }
    } catch (error) {
      if (!String(error.errMsg || '').includes('cancel')) this.error(error);
    } finally {
      this.busy = false;
      this.setData({ busy: false });
    }
  },
  removeImage(e) {
    if (this.busy) return;
    const { form, index } = e.currentTarget.dataset;
    const photos = [...this.data[form].photos];
    const removed = photos.splice(Number(index), 1)[0];
    if (this.pendingFiles.includes(removed)) {
      wx.removeSavedFile({ filePath: removed, fail() {} });
      this.pendingFiles = this.pendingFiles.filter((p) => p !== removed);
    }
    this.setData({ [`${form}.photos`]: photos, dirty: true });
  },
  previewImage(e) {
    wx.previewImage({
      current: e.currentTarget.dataset.src,
      urls: this.data[e.currentTarget.dataset.form].photos,
    });
  },
  saveReport(e) {
    if (this.busy || !this.data.view) return;
    this.busy = true;
    this.setData({ busy: true, error: '', errorCode: '' });
    try {
      const old = this.data.view.reports.find(
        (r) => r.id === this.data.report.id,
      );
      store.report(this.data.phone, this.data.view.merchant.id, {
        ...this.data.report,
        submit: e.currentTarget.dataset.submit === 'yes',
      });
      for (const path of old ? old.photos : [])
        if (!this.data.report.photos.includes(path))
          wx.removeSavedFile({ filePath: path, fail() {} });
      this.pendingFiles = [];
      this.setData({ report: reportForm(), dirty: false });
      this.refresh();
      wx.showToast({ title: copy.reportSuccess, icon: 'success' });
    } catch (error) {
      this.error(error);
    } finally {
      this.busy = false;
      this.setData({ busy: false });
    }
  },
  async editReport(e) {
    if (!(await this.guard())) return;
    const row = this.data.view.reports.find(
      (r) => r.id === e.currentTarget.dataset.id && r.status === 'draft',
    );
    if (row) {
      this.setData({
        report: {
          ...row,
          amount: yuan(row.amount),
          orders: String(row.orders),
        },
        dirty: false,
      });
      wx.pageScrollTo({ scrollTop: 0 });
    }
  },
  async cancelEdit() {
    if (await this.guard())
      this.setData({ report: reportForm(), dirty: false });
  },
  async pay(e) {
    if (this.busy || !this.data.view) return;
    const bill = this.data.view.bills.find(
      (b) => b.id === e.currentTarget.dataset.id,
    );
    if (!bill || bill.remaining <= 0) return;
    this.busy = true;
    this.setData({ busy: true, error: '', errorCode: '' });
    try {
      const result = await wx.showModal({
        title: copy.confirmPay,
        content: `${this.data.view.merchant.name}\n${bill.title}\n¥${bill.amountText}\n${copy.warning}`,
        confirmText: copy.confirm,
        cancelText: copy.cancel,
      });
      if (!result.confirm) return;
      store.pay(
        this.data.phone,
        this.data.view.merchant.id,
        bill.id,
        `preview-${bill.id}`,
      );
      this.refresh();
      wx.showToast({ title: copy.paySuccess, icon: 'success' });
    } catch (error) {
      this.error(error);
    } finally {
      this.busy = false;
      this.setData({ busy: false });
    }
  },
  saveRepair() {
    if (this.busy || !this.data.view) return;
    this.busy = true;
    this.setData({ busy: true, error: '', errorCode: '' });
    try {
      store.repair(
        this.data.phone,
        this.data.view.merchant.id,
        this.data.repair,
      );
      this.pendingFiles = [];
      this.setData({ repair: repairForm(), dirty: false });
      this.refresh();
      wx.showToast({ title: copy.repairSuccess, icon: 'success' });
    } catch (error) {
      this.error(error);
    } finally {
      this.busy = false;
      this.setData({ busy: false });
    }
  },
  async signout() {
    if (!(await this.guard())) return;
    this.setData({
      logged: false,
      view: null,
      merchants: [],
      merchantIndex: 0,
      tab: 0,
      report: reportForm(),
      repair: repairForm(),
      error: '',
      errorCode: '',
    });
  },
  async reset() {
    if (this.busy) return;
    const result = await wx.showModal({
      title: copy.resetTitle,
      content: copy.resetHint,
      confirmText: copy.confirm,
      cancelText: copy.cancel,
    });
    if (!result.confirm) return;
    this.busy = true;
    this.setData({ busy: true });
    try {
      const raw = wx.getStorageSync('nocoerp.merchant-preview.v1');
      const paths =
        raw && Array.isArray(raw.reports) && Array.isArray(raw.repairs)
          ? [...raw.reports, ...raw.repairs].flatMap((r) =>
              Array.isArray(r.photos) ? r.photos : [],
            )
          : [];
      store.reset();
      paths.forEach((filePath) => wx.removeSavedFile({ filePath, fail() {} }));
      this.cleanupPending();
      this.setData({
        phone: copy.demoPhone,
        merchants: [],
        merchantIndex: 0,
        report: reportForm(),
        repair: repairForm(),
        dirty: false,
        error: '',
        errorCode: '',
      });
      if (this.data.logged) this.refresh();
    } catch (error) {
      this.error(error);
    } finally {
      this.busy = false;
      this.setData({ busy: false });
    }
  },
});
