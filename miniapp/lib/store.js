/* global module */
// Development-only model. No API client, production identity or financial side effects.
const KEY = 'nocoerp.merchant-preview.v1';
function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
function dateToday(now) {
  // Business date is Asia/Shanghai, independent of the simulator/device timezone.
  return new Date(now + 8 * 3600000).toISOString().slice(0, 10);
}
function money(value) {
  const s = String(value);
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) fail('AMOUNT');
  const [whole, fraction = ''] = s.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
function yuan(cents) {
  return (cents / 100).toFixed(2);
}
function fresh() {
  return {
    version: 1,
    sequence: 0,
    merchants: [
      {
        id: 'demo-tea',
        name: '海源茶舍（测试）',
        unit: '海源街 A-101',
        active: true,
      },
      {
        id: 'demo-gift',
        name: '海源文创（测试）',
        unit: '海源街 B-203',
        active: true,
      },
    ],
    grants: [
      { phone: '13800000001', merchantId: 'demo-tea', active: true },
      { phone: '13800000001', merchantId: 'demo-gift', active: true },
    ],
    bills: [
      {
        id: 'bill-tea-1',
        merchantId: 'demo-tea',
        title: '物业服务费 · 演示账单',
        amount: 128000,
        paid: 0,
      },
      {
        id: 'bill-tea-2',
        merchantId: 'demo-tea',
        title: '水电费 · 演示账单',
        amount: 23650,
        paid: 0,
      },
      {
        id: 'bill-gift-1',
        merchantId: 'demo-gift',
        title: '物业服务费 · 演示账单',
        amount: 98000,
        paid: 0,
      },
    ],
    reports: [],
    payments: [],
    repairs: [],
  };
}
function createStore(storage, now = () => Date.now()) {
  function read() {
    let value;
    try {
      value = storage.get(KEY);
    } catch {
      fail('STORAGE');
    }
    if (!value) return fresh();
    if (
      value.version !== 1 ||
      !['merchants', 'grants', 'bills', 'reports', 'payments', 'repairs'].every(
        (k) => Array.isArray(value[k]),
      )
    )
      fail('CORRUPT');
    return JSON.parse(JSON.stringify(value));
  }
  function save(data) {
    try {
      storage.set(KEY, data);
    } catch {
      fail('STORAGE');
    }
  }
  function authorize(data, phone, merchantId) {
    if (
      !data.grants.some(
        (g) => g.phone === phone && g.merchantId === merchantId && g.active,
      ) ||
      !data.merchants.some((m) => m.id === merchantId && m.active)
    )
      fail('UNAUTHORIZED');
  }
  function id(data) {
    data.sequence += 1;
    return 'demo-' + data.sequence;
  }
  function photos(input) {
    if (
      !Array.isArray(input) ||
      input.length > 3 ||
      input.some((x) => typeof x !== 'string' || !x)
    )
      fail('ATTACHMENTS');
    return [...input];
  }
  return {
    today: () => dateToday(now()),
    login(phone) {
      if (!/^1\d{10}$/.test(phone)) fail('PHONE');
      const d = read();
      const merchants = d.merchants.filter(
        (m) =>
          m.active &&
          d.grants.some(
            (g) => g.phone === phone && g.merchantId === m.id && g.active,
          ),
      );
      if (!merchants.length) fail('UNKNOWN_PHONE');
      return merchants;
    },
    view(phone, merchantId) {
      const d = read();
      authorize(d, phone, merchantId);
      const owned = (name) =>
        d[name].filter((r) => r.merchantId === merchantId);
      return {
        merchant: d.merchants.find((m) => m.id === merchantId),
        reports: owned('reports').sort((a, b) => b.date.localeCompare(a.date)),
        bills: owned('bills'),
        payments: owned('payments').reverse(),
        repairs: owned('repairs').reverse(),
      };
    },
    report(phone, merchantId, input) {
      const d = read();
      authorize(d, phone, merchantId);
      const date = String(input.date || '');
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date ||
        date > dateToday(now())
      )
        fail('DATE');
      const amount = money(input.amount);
      if (!/^\d{1,8}$/.test(String(input.orders))) fail('ORDERS');
      if (typeof input.note !== 'string' || input.note.length > 500)
        fail('NOTE');
      const evidence = photos(input.photos);
      const old = input.id
        ? d.reports.find(
            (r) => r.id === input.id && r.merchantId === merchantId,
          )
        : null;
      if (input.id && !old) fail('NOT_FOUND');
      if (old && old.version !== input.version) fail('STALE');
      if (old && old.status !== 'draft') fail('IMMUTABLE');
      if (
        d.reports.some(
          (r) =>
            r.merchantId === merchantId && r.date === date && r.id !== input.id,
        )
      )
        fail('DUPLICATE');
      const row = {
        id: old ? old.id : id(d),
        merchantId,
        date,
        amount,
        orders: Number(input.orders),
        note: input.note.trim(),
        photos: evidence,
        status: input.submit ? 'submitted' : 'draft',
        version: old ? old.version + 1 : 1,
      };
      if (old) d.reports[d.reports.indexOf(old)] = row;
      else d.reports.push(row);
      save(d);
      return row;
    },
    pay(phone, merchantId, billId, requestId) {
      const d = read();
      authorize(d, phone, merchantId);
      if (
        typeof requestId !== 'string' ||
        requestId.length < 8 ||
        requestId.length > 100
      )
        fail('PAYMENT_CONFLICT');
      const previous = d.payments.find((p) => p.requestId === requestId);
      if (previous) {
        if (
          previous.merchantId !== merchantId ||
          previous.billId !== billId ||
          previous.phone !== phone
        )
          fail('PAYMENT_CONFLICT');
        return previous;
      }
      const bill = d.bills.find(
        (b) => b.id === billId && b.merchantId === merchantId,
      );
      if (!bill) fail('NOT_FOUND');
      const amount = bill.amount - bill.paid;
      if (amount <= 0) fail('PAID');
      const row = {
        id: id(d),
        requestId,
        merchantId,
        billId,
        phone,
        amount,
        title: bill.title,
        at: new Date(now()).toISOString(),
        simulated: true,
      };
      bill.paid += amount;
      d.payments.push(row);
      save(d);
      return row;
    },
    repair(phone, merchantId, input) {
      const d = read();
      authorize(d, phone, merchantId);
      if (
        typeof input.title !== 'string' ||
        !input.title.trim() ||
        input.title.length > 80 ||
        typeof input.description !== 'string' ||
        !input.description.trim() ||
        input.description.length > 1000 ||
        !/^1\d{10}$/.test(input.phone) ||
        !Number.isInteger(input.category) ||
        input.category < 0 ||
        input.category > 3
      )
        fail('REPAIR');
      const row = {
        id: id(d),
        merchantId,
        title: input.title.trim(),
        description: input.description.trim(),
        phone: input.phone,
        category: input.category,
        photos: photos(input.photos),
        status: 'submitted',
        at: new Date(now()).toISOString(),
      };
      d.repairs.push(row);
      save(d);
      return row;
    },
    reset() {
      save(fresh());
    },
  };
}
module.exports = { createStore, money, yuan, dateToday, KEY };
