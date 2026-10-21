import { expect, it } from 'vitest';
import { sourceRecordLabel } from '../../client/pages/hyl/source-record-label.js';
it('uses only available source snapshots and authorized display metadata', () => {
  expect(
    sourceRecordLabel({
      id: 'a',
      number: 'ZD-A',
      merchantName: '商户',
      contractNumber: 'HT-A',
      contractTitle: '租约',
    }),
  ).toBe('ZD-A · 商户 · 租约 · HT-A');
  expect(
    sourceRecordLabel({
      id: 'b',
      number: 'JS-B',
      name: '结算商户',
      payload: { contract: { title: '历史租约', number: 'HT-B' } },
    }),
  ).toBe('JS-B · 结算商户 · 历史租约 · HT-B');
  expect(
    sourceRecordLabel({
      id: 'c',
      number: 'SK-C',
      merchantName: null,
      contractNumber: null,
    }),
  ).toBe('SK-C');
});

it('keeps a signed source title ahead of the renamed current contract', () => {
  expect(
    sourceRecordLabel({
      id: 'old',
      number: 'ZD-OLD',
      merchantName: '商户',
      contractTitle: '当前新名称',
      contractNumber: 'HT-1',
      payload: { contract: { title: '签约原名称', number: 'HT-1' } },
    }),
  ).toBe('ZD-OLD · 商户 · 签约原名称 · HT-1');
});
