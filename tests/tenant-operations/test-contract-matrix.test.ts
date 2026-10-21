// @vitest-environment node
import { expect, it } from 'vitest';
import {
  calculateSettlement,
  type FeeContract,
} from '../../server/hyl/calculation.js';
const contract: FeeContract = {
  method: 'commission',
  basis: 'receipts',
  rate: '10',
  fixedFee: '0',
  minimum: '0',
  rent: '0',
  includeActivity: true,
  includeCash: true,
  includeHospitality: true,
};
const reports = [
  {
    receipts: '1000',
    refunds: '100',
    activity: '50',
    cash: '25',
    hospitality: '20',
    collected: '600',
  },
];
const costs = [
  { amount: '10', responsibility: 'company' },
  { amount: '20', responsibility: 'merchant' },
];
it.each([
  [
    'TEST实收净额抽成',
    { basis: 'receipts' },
    '2026-10-01',
    '2026-10-31',
    '900.00',
    '90.00',
    '0.00',
    '500.00',
  ],
  [
    'TEST营业净额含券招待',
    { basis: 'turnover' },
    '2026-10-01',
    '2026-10-31',
    '995.00',
    '99.50',
    '0.00',
    '490.50',
  ],
  [
    'TEST营业净额不含券招待',
    {
      basis: 'turnover',
      includeActivity: false,
      includeCash: false,
      includeHospitality: false,
    },
    '2026-10-01',
    '2026-10-31',
    '900.00',
    '90.00',
    '0.00',
    '500.00',
  ],
  [
    'TEST保底取高',
    { method: 'minimum', minimum: '1000' },
    '2026-10-01',
    '2026-10-31',
    '900.00',
    '1000.00',
    '0.00',
    '-410.00',
  ],
  [
    'TEST上半月固定费及租金',
    { method: 'fixed', fixedFee: '3100', rent: '310' },
    '2026-10-01',
    '2026-10-15',
    '900.00',
    '1500.00',
    '150.00',
    '-1060.00',
  ],
  [
    'TEST下半月固定费及租金',
    { method: 'fixed', fixedFee: '3100', rent: '310' },
    '2026-10-16',
    '2026-10-31',
    '900.00',
    '1600.00',
    '160.00',
    '-1170.00',
  ],
  [
    'TEST首尾一期单日',
    { method: 'fixed', fixedFee: '3100', rent: '310' },
    '2026-10-31',
    '2026-10-31',
    '900.00',
    '100.00',
    '10.00',
    '480.00',
  ],
  [
    'TEST闰年二月部分期',
    { method: 'fixed', fixedFee: '2900', rent: '290' },
    '2024-02-10',
    '2024-02-29',
    '900.00',
    '2000.00',
    '200.00',
    '-1610.00',
  ],
] as const)(
  '%s（合成合同，不是真实逐户验收）',
  (_name, change, start, end, feeBasis, fee, rent, payable) => {
    expect(
      calculateSettlement(
        { ...contract, ...change },
        reports,
        costs,
        start,
        end,
      ),
    ).toMatchObject({
      feeBasis,
      fee,
      rent,
      payable,
      deductions: '10.00',
      ownCost: '20.00',
      turnover: '995.00',
    });
  },
);
