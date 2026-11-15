/* global require, wx, Page */
const copy = require('../../lib/erp-copy');
const config = require('../../lib/erp-config');
const { createErpClient } = require('../../lib/erp-client');
const api = createErpClient(config.baseUrl, wx);
const endpoint = '/merchantMiniapp';
const categories = [
  'plumbing',
  'electrical',
  'airConditioning',
  'facility',
  'other',
];
const day = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const blankReport = () => ({
  date: day(),
  amount: '',
  orders: '',
  note: '',
  photos: [],
  uploaded: 0,
});
const blankRepair = () => ({
  asset: 0,
  title: '',
  description: '',
  category: 0,
});
const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) =>
    (c === 'x'
      ? (Math.random() * 16) | 0
      : (Math.random() * 4 + 8) | 0
    ).toString(16),
  );
function money(value) {
  const cents = String(value).padStart(3, '0');
  return cents.slice(0, -2) + '.' + cents.slice(-2);
}
function present(row) {
  const entry = { ...row, statusText: copy.statuses[row.status] || row.status };
  if (row.amountCents !== undefined) {
    entry.totalText = money(row.amountCents);
    entry.balanceText = money(row.remainingCents);
  }
  return entry;
}
Page({
  data: {
    copy,
    configured: api.configured,
    logged: false,
    merchants: [],
    index: 0,
    tab: 0,
    rows: [],
    assets: [],
    page: 1,
    more: false,
    busy: false,
    dirty: false,
    error: '',
    repair: blankRepair(),
    report: blankReport(),
    progress: null,
    evidence: null,
    today: day(),
  },
  onShow() {
    if (this.data.logged && !this.data.busy) void this.refresh();
  },
  onUnload() {
    api.clear();
    this.disposed = true;
  },
  path(index = this.data.index) {
    const shop = this.data.merchants[index];
    if (!shop)
      throw Object.assign(new Error('MINIAPP_NO_GRANT'), {
        code: 'MINIAPP_NO_GRANT',
      });
    return endpoint + '/merchants/' + encodeURIComponent(shop.id);
  },
  update(values) {
    if (!this.disposed) this.setData(values);
  },
  async error(e) {
    if (this.data.logged && e.code === 'MINIAPP_NO_GRANT') {
      // Removing one shop must not discard access to other shops.
      this.update({
        rows: [],
        assets: [],
        progress: null,
        evidence: null,
        report: blankReport(),
        repair: blankRepair(),
        dirty: false,
      });
      this.repairKey = '';
      try {
        const merchants = (await api.request(endpoint + '/merchants')).data;
        if (merchants.length) {
          const current = this.data.merchants[this.data.index]?.id;
          this.update({
            merchants,
            index: Math.max(
              0,
              merchants.findIndex((shop) => shop.id === current),
            ),
          });
          try {
            await this.load();
          } catch {
            /* The next refresh can recover remaining records. */
          }
          this.update({ error: copy.errors.MINIAPP_NO_GRANT });
          return;
        }
      } catch {
        /* Fail closed if the remaining grants cannot be verified. */
      }
    }
    if (e.status === 401 || e.code === 'MINIAPP_NO_GRANT') {
      api.clear();
      this.update({
        logged: false,
        merchants: [],
        rows: [],
        assets: [],
        progress: null,
        evidence: null,
        report: blankReport(),
        repair: blankRepair(),
        dirty: false,
      });
    }
    this.update({ error: copy.errors[e.code] || copy.errors.REQUEST_FAILED });
  },
  async run(fn) {
    if (this.busy) return;
    this.busy = true;
    this.update({ busy: true, error: '' });
    try {
      await fn();
    } catch (e) {
      await this.error(e);
    } finally {
      this.busy = false;
      this.update({ busy: false });
    }
  },
  async login(e) {
    const code = e.detail?.code;
    if (!code) {
      this.update({ error: copy.phoneDenied });
      return;
    }
    await this.run(async () => {
      await api.login(code);
      const merchants = (await api.request(endpoint + '/merchants')).data;
      this.update({
        logged: true,
        merchants,
        index: 0,
        tab: 0,
        rows: [],
        report: blankReport(),
        repair: blankRepair(),
        dirty: false,
      });
      await this.load();
    });
  },
  async guard() {
    if (!this.data.dirty) return true;
    return new Promise((resolve) =>
      wx.showModal({
        content: copy.discard,
        success: (r) => resolve(r.confirm),
        fail: () => resolve(false),
      }),
    );
  },
  async refresh() {
    await this.run(async () => {
      const selected = this.data.merchants[this.data.index]?.id;
      const merchants = (await api.request(endpoint + '/merchants')).data;
      const idx = merchants.findIndex((shop) => shop.id === selected);
      if (idx < 0) {
        this.repairKey = '';
        this.update({
          rows: [],
          assets: [],
          progress: null,
          evidence: null,
          report: blankReport(),
          repair: blankRepair(),
          dirty: false,
        });
      }
      this.update({ merchants, index: Math.max(0, idx) });
      // Preserve a form's existing asset picker values while the user is editing.
      if (idx < 0 || !this.data.dirty) await this.load();
    });
  },
  async changeMerchant(e) {
    if (this.busy || !(await this.guard())) return;
    await this.run(async () => {
      this.update({
        index: Number(e.detail.value),
        rows: [],
        assets: [],
        progress: null,
        evidence: null,
        report: blankReport(),
        repair: blankRepair(),
        dirty: false,
      });
      this.repairKey = '';
      await this.load();
    });
  },
  async changeTab(e) {
    if (this.busy || !(await this.guard())) return;
    await this.run(async () => {
      this.update({
        tab: Number(e.currentTarget.dataset.index),
        rows: [],
        assets: [],
        progress: null,
        evidence: null,
        report: blankReport(),
        repair: blankRepair(),
        dirty: false,
      });
      this.repairKey = '';
      await this.load();
    });
  },
  async load(page = 1) {
    const path = this.path(),
      tab = this.data.tab;
    const [result, assets] = await Promise.all([
      api.request(
        path + '/' + ['reports', 'bills', 'repairs'][tab] + '?page=' + page,
      ),
      tab === 2 && page === 1
        ? api.request(path + '/assets')
        : Promise.resolve(null),
    ]);
    this.update({
      rows: [...(page > 1 ? this.data.rows : []), ...result.data.map(present)],
      ...(assets ? { assets: assets.data } : {}),
      page,
      more: result.meta.total > page * result.meta.pageSize,
    });
  },
  async next() {
    await this.run(() => this.load(this.data.page + 1));
  },
  field(e) {
    if (this.busy) return;
    const { form, key } = e.currentTarget.dataset;
    this.update({
      [form + '.' + key]: ['category', 'asset'].includes(key)
        ? Number(e.detail.value)
        : e.detail.value,
      dirty: true,
    });
    if (form === 'repair') this.repairKey = '';
  },
  async image() {
    await this.run(async () => {
      const result = await new Promise((resolve, reject) =>
        wx.chooseMedia({
          count: 3 - this.data.report.photos.length,
          mediaType: ['image'],
          success: resolve,
          fail: (e) =>
            String(e.errMsg).includes('cancel') ? resolve(null) : reject(e),
        }),
      );
      if (result)
        this.update({
          'report.photos': [
            ...this.data.report.photos,
            ...result.tempFiles.map((f) => f.tempFilePath),
          ],
          dirty: true,
        });
    });
  },
  remove(e) {
    if (this.busy) return;
    this.update({
      'report.photos': this.data.report.photos.filter(
        (_, i) => i !== Number(e.currentTarget.dataset.index),
      ),
      dirty: true,
    });
  },
  async evidenceList(e) {
    await this.run(async () => {
      const id = e.currentTarget.dataset.id;
      const { data } = await api.request(
        '/reportingEvidence/revenueReports/' + encodeURIComponent(id),
      );
      this.update({
        evidence: data.filter((f) =>
          ['image/png', 'image/jpeg'].includes(f.mimeType),
        ),
      });
    });
  },
  async preview(e) {
    await this.run(async () => {
      const file = this.data.evidence?.find(
        (f) => f.id === e.currentTarget.dataset.id,
      );
      if (!file) return;
      const local = await api.downloadEvidence(file.id, file.ext);
      if (!this.disposed) wx.previewImage({ current: local, urls: [local] });
    });
  },
  closeEvidence() {
    this.update({ evidence: null });
  },
  async edit(e) {
    if (this.busy || !(await this.guard())) return;
    const row = this.data.rows.find((v) => v.id === e.currentTarget.dataset.id);
    if (!row?.editable) return;
    await this.run(async () => {
      const files = await api.request(
        '/reportingEvidence/revenueReports/' + encodeURIComponent(row.id),
      );
      this.update({
        report: {
          ...row,
          orders: row.orders === null ? '' : String(row.orders),
          photos: [],
          uploaded: files.data.length,
        },
        dirty: false,
      });
    });
  },
  async newReport() {
    if (!this.busy && (await this.guard()))
      this.update({ report: blankReport(), dirty: false });
  },
  async save(e) {
    const submit = e.currentTarget.dataset.submit === 'yes';
    await this.run(async () => {
      let f = { ...this.data.report };
      if (
        !/^\d{1,12}(\.\d{1,2})?$/.test(f.amount) ||
        !/^\d{1,9}$/.test(f.orders)
      )
        throw Object.assign(new Error('INVALID_FIELDS'), {
          code: 'INVALID_FIELDS',
        });
      const path = this.path() + '/reports';
      if (!f.id || this.data.dirty) {
        const result = await api.request(path, 'POST', {
          date: f.date,
          amount: f.amount,
          orders: Number(f.orders),
          note: f.note,
          ...(f.id ? { id: f.id, version: f.version } : {}),
        });
        f = { ...f, ...result.data, orders: String(result.data.orders) };
        this.update({ report: f, dirty: false });
      }
      for (const photo of [...f.photos]) {
        await api.upload(f.id, photo);
        f.photos = f.photos.slice(1);
        f.uploaded++;
        this.update({ report: { ...f } });
      }
      if (submit) {
        await api.request(
          path + '/' + encodeURIComponent(f.id) + '/submit',
          'POST',
          { version: f.version },
        );
        this.update({ report: blankReport(), dirty: false });
      }
      wx.showToast({
        title: submit ? copy.submitted : copy.saved,
        icon: 'none',
      });
      await this.load();
    });
  },
  async saveRepair() {
    await this.run(async () => {
      const f = this.data.repair,
        asset = this.data.assets[f.asset];
      if (!asset || !f.title.trim() || !f.description.trim())
        throw Object.assign(new Error('INVALID_FIELDS'), {
          code: 'INVALID_FIELDS',
        });
      this.repairKey ||= uuid();
      await api.request(this.path() + '/repairs', 'POST', {
        assetId: asset.id,
        title: f.title,
        description: f.description,
        category: categories[f.category],
        requestId: this.repairKey,
      });
      this.repairKey = '';
      this.update({ repair: blankRepair(), dirty: false });
      wx.showToast({ title: copy.repairSent, icon: 'none' });
      await this.load();
    });
  },
  async progress(e) {
    await this.run(async () => {
      const { data } = await api.request(
        this.path() +
          '/repairs/' +
          encodeURIComponent(e.currentTarget.dataset.id),
      );
      this.update({
        progress: { ...present(data), events: data.events.map(present) },
      });
    });
  },
  closeProgress() {
    this.update({ progress: null });
  },
  async logout() {
    if (this.busy || !(await this.guard())) return;
    await this.run(async () => {
      await api.signout();
      this.repairKey = '';
      this.update({
        logged: false,
        merchants: [],
        rows: [],
        assets: [],
        progress: null,
        evidence: null,
        report: blankReport(),
        repair: blankRepair(),
        dirty: false,
      });
    });
  },
});
