// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
const require = createRequire(import.meta.url);
const {
  createStore,
  money,
  yuan,
  dateToday,
  KEY,
} = require('../../miniapp/lib/store.js');
function fixture() {
  const memory = new Map();
  const store = createStore(
    {
      get: (k: string) => memory.get(k),
      set: (k: string, v: unknown) => memory.set(k, structuredClone(v)),
    },
    () => Date.parse('2026-11-13T08:00:00Z'),
  );
  return { store, memory };
}
const phone = '13800000001';
const report = {
  date: '2026-11-13',
  amount: '123.45',
  orders: '10',
  note: 'demo',
  photos: [],
  submit: false,
};
describe('merchant mini program isolated preview', () => {
  it('matches an explicitly authorized phone to multiple merchants, rejects unknown phone', () => {
    const { store } = fixture();
    expect(store.login(phone)).toHaveLength(2);
    expect(() => store.login('123')).toThrow('PHONE');
    expect(() => store.login('13900000000')).toThrow('UNKNOWN_PHONE');
    expect(() => store.view('13900000000', 'demo-tea')).toThrow('UNAUTHORIZED');
  });
  it('scopes every list and validates authorization again after revocation', () => {
    const { store, memory } = fixture();
    store.reset();
    expect(store.view(phone, 'demo-tea').bills).toHaveLength(2);
    expect(store.view(phone, 'demo-gift').bills).toHaveLength(1);
    const data = memory.get(KEY);
    data.grants[0].active = false;
    expect(() => store.view(phone, 'demo-tea')).toThrow('UNAUTHORIZED');
    expect(() => store.report(phone, 'demo-tea', report)).toThrow(
      'UNAUTHORIZED',
    );
    expect(() =>
      store.pay(phone, 'demo-tea', 'bill-tea-1', 'request-0001'),
    ).toThrow('UNAUTHORIZED');
    expect(() => store.repair(phone, 'demo-tea', {})).toThrow('UNAUTHORIZED');
    expect(store.login(phone)).toHaveLength(1);
  });
  it('supports zero reports, draft revisions and immutable submissions', () => {
    const { store } = fixture();
    const a = store.report(phone, 'demo-tea', {
      ...report,
      amount: '0',
      orders: '0',
    });
    expect(a.amount).toBe(0);
    const b = store.report(phone, 'demo-tea', {
      ...report,
      id: a.id,
      version: a.version,
      submit: true,
    });
    expect(b.status).toBe('submitted');
    expect(b.version).toBe(2);
    expect(() =>
      store.report(phone, 'demo-tea', { ...report, id: a.id, version: 1 }),
    ).toThrow('STALE');
    expect(() =>
      store.report(phone, 'demo-tea', { ...report, id: a.id, version: 2 }),
    ).toThrow('IMMUTABLE');
    expect(() => store.report(phone, 'demo-tea', report)).toThrow('DUPLICATE');
    expect(store.report(phone, 'demo-gift', report).merchantId).toBe(
      'demo-gift',
    );
    expect(() =>
      store.report(phone, 'demo-gift', { ...report, id: a.id, version: 2 }),
    ).toThrow('NOT_FOUND');
  });
  it('rejects invalid dates, money, counts, notes and attachments without saving', () => {
    const { store } = fixture();
    for (const date of ['2026-02-30', '2026-11-14', 'no'])
      expect(() =>
        store.report(phone, 'demo-tea', { ...report, date }),
      ).toThrow('DATE');
    for (const amount of ['-1', '1.001', '1e3', '1000000000'])
      expect(() =>
        store.report(phone, 'demo-tea', { ...report, amount }),
      ).toThrow('AMOUNT');
    for (const orders of ['', '-1', '1.5', '100000000'])
      expect(() =>
        store.report(phone, 'demo-tea', { ...report, orders }),
      ).toThrow('ORDERS');
    expect(() =>
      store.report(phone, 'demo-tea', { ...report, note: 'a'.repeat(501) }),
    ).toThrow('NOTE');
    expect(() =>
      store.report(phone, 'demo-tea', {
        ...report,
        photos: ['a', 'b', 'c', 'd'],
      }),
    ).toThrow('ATTACHMENTS');
    expect(store.view(phone, 'demo-tea').reports).toEqual([]);
  });
  it('uses cents and stable idempotency without double payment or cross-merchant access', () => {
    const { store } = fixture();
    expect(money('0.29')).toBe(29);
    expect(yuan(29)).toBe('0.29');
    expect(() =>
      store.pay(phone, 'demo-gift', 'bill-tea-1', 'request-0001'),
    ).toThrow('NOT_FOUND');
    const first = store.pay(phone, 'demo-tea', 'bill-tea-1', 'request-0001');
    expect(store.pay(phone, 'demo-tea', 'bill-tea-1', 'request-0001')).toEqual(
      first,
    );
    expect(() =>
      store.pay(phone, 'demo-tea', 'bill-tea-2', 'request-0001'),
    ).toThrow('PAYMENT_CONFLICT');
    expect(() =>
      store.pay(phone, 'demo-tea', 'bill-tea-1', 'request-0002'),
    ).toThrow('PAID');
    const view = store.view(phone, 'demo-tea');
    expect(view.payments).toHaveLength(1);
    expect(view.bills[0].paid).toBe(128000);
    expect(view.payments[0].simulated).toBe(true);
    expect(store.view(phone, 'demo-gift').payments).toEqual([]);
  });
  it('preserves prior data if storage writes fail', () => {
    const { store, memory } = fixture();
    store.reset();
    const failing = createStore(
      {
        get: (k: string) => memory.get(k),
        set: () => {
          throw Error('quota');
        },
      },
      () => Date.parse('2026-11-13T08:00:00Z'),
    );
    expect(() =>
      failing.pay(phone, 'demo-tea', 'bill-tea-1', 'request-0001'),
    ).toThrow('STORAGE');
    expect(() => failing.report(phone, 'demo-tea', report)).toThrow('STORAGE');
    expect(store.view(phone, 'demo-tea').payments).toEqual([]);
    expect(store.view(phone, 'demo-tea').bills[0].paid).toBe(0);
  });
  it('validates repairs and isolates history, reset restores demo balances', () => {
    const { store } = fixture();
    expect(() => store.repair(phone, 'demo-tea', {})).toThrow('REPAIR');
    store.repair(phone, 'demo-tea', {
      title: '漏水',
      description: '演示问题',
      phone,
      category: 0,
      photos: [],
    });
    expect(store.view(phone, 'demo-tea').repairs).toHaveLength(1);
    expect(store.view(phone, 'demo-gift').repairs).toEqual([]);
    store.pay(phone, 'demo-tea', 'bill-tea-1', 'request-0001');
    store.reset();
    expect(store.view(phone, 'demo-tea').repairs).toEqual([]);
    expect(store.view(phone, 'demo-tea').bills[0].paid).toBe(0);
  });
  it('computes reporting business day in Shanghai and rejects corrupted storage', () => {
    expect(dateToday(Date.parse('2026-11-13T16:01:00Z'))).toBe('2026-11-14');
    const { store, memory } = fixture();
    memory.set(KEY, { version: 99 });
    expect(() => store.login(phone)).toThrow('CORRUPT');
    store.reset();
    expect(store.login(phone)).toHaveLength(2);
  });
});
