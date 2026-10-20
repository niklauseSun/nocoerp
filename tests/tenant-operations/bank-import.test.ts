// @vitest-environment node
import { expect, it } from 'vitest';
import {
  normalizeBankCsv,
  importCents,
  type BankMapping,
} from '../../server/tenant-operations/bank-import.js';
const mapping: BankMapping = {
  externalId: '流水',
  date: '日期',
  reference: '参考',
  income: '收入',
  expense: '支出',
  unit: 'yuan',
  defaultMethod: 'bank',
};
it('TEST normalizes mapped Chinese bank income/expense columns with exact cent arithmetic', () => {
  const result = normalizeBankCsv(
    '流水,日期,参考,收入,支出\r\nTEST-1,2026/10/20,TEST收款,"1,234.56",\r\nTEST-2,20261021,TEST退款,,0.01',
    mapping,
  );
  expect(result.issues).toEqual([]);
  expect(result.rows.map((x) => x.amountCents)).toEqual(['123456', '-1']);
  expect(result.rows[1].date).toBe('2026-10-21');
  expect(importCents('90071992547409.91', 'yuan')).toBe(9007199254740991n);
});
it('TEST blocks whole preview on ambiguous directions, invalid dates, duplicate ids or fractional cents', () => {
  for (const input of [
    'TEST,2026-10-20,X,1,1',
    'TEST,2026-02-30,X,1,',
    'TEST,2026-10-20,X,0.001,',
    'TEST,2026-10-20,X,1,\nTEST,2026-10-20,Y,1,',
  ]) {
    const r = normalizeBankCsv('流水,日期,参考,收入,支出\n' + input, mapping);
    expect(r.rows).toEqual([]);
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.issues[0].row).toBeGreaterThanOrEqual(2);
  }
  expect(() => importCents('1,23.00', 'yuan')).toThrow();
});
it('TEST supports a mapped platform signed-yuan export and rejects broken quoting or duplicate headers', () => {
  const m = {
    externalId: 'ID',
    date: 'Date',
    reference: 'Ref',
    amount: 'Net',
    unit: 'yuan',
    defaultMethod: 'other',
  } as BankMapping;
  expect(
    normalizeBankCsv(
      'ID,Date,Ref,Net\nTEST,2026-10-20,"TEST, quoted",-10.01',
      m,
    ).rows[0],
  ).toMatchObject({
    amountCents: '-1001',
    reference: 'TEST, quoted',
    method: 'other',
  });
  expect(() =>
    normalizeBankCsv('ID,Date,Ref,Net\nTEST,2026-10-20,"broken,-1', m),
  ).toThrow();
  expect(() =>
    normalizeBankCsv('ID,Date,Ref,Net,Net\nTEST,2026-10-20,X,1,2', m),
  ).toThrow();
});
