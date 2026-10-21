import { expect, it } from 'vitest';
import {
  contractLabel,
  assignedContractLabel,
} from '../../client/pages/hyl/contract-label.js';
it('formats current contract records and authorized energy assignment projections consistently', () => {
  expect(
    contractLabel({
      number: 'HT-1',
      name: '商户甲',
      payload: { title: ' 合同甲 ' },
    }),
  ).toBe('合同甲 · HT-1');
  expect(
    contractLabel({
      number: 'HT-2',
      name: ' 商户乙 ',
      payload: { title: ' ' },
    }),
  ).toBe('商户乙 · HT-2');
  expect(contractLabel({ number: 'HT-OLD' })).toBe('HT-OLD');
  expect(
    assignedContractLabel({
      contractNumber: 'HT-1',
      contractTitle: '合同甲',
      contractMerchantName: '商户甲',
    }),
  ).toBe('合同甲 · HT-1');
  expect(
    assignedContractLabel({
      payload: { contractNumber: 'HT-OLD' },
      contractMerchantName: '历史商户',
    }),
  ).toBe('历史商户 · HT-OLD');
});
