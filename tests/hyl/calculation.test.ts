import { describe, expect, it } from 'vitest';
import {
  calculateSettlement,
  cents,
  periodFor,
} from '../../server/hyl/calculation.js';

const contract = {
  method: 'commission',
  basis: 'receipts',
  rate: '10',
  fixedFee: '0',
  minimum: '0',
  rent: '1000',
  includeActivity: true,
  includeCash: true,
  includeHospitality: false,
};
const revenue = [
  {
    receipts: '10000',
    refunds: '500',
    activity: '500',
    cash: '0',
    hospitality: '0',
    collected: '9500',
  },
];
const expenses = [
  { amount: '500', responsibility: 'company' },
  { amount: '200', responsibility: 'merchant' },
];
describe('settlement calculation', () => {
  it('separates turnover, cash, merchant costs and deductions', () => {
    expect(
      calculateSettlement(
        contract,
        revenue,
        expenses,
        '2026-10-01',
        '2026-10-31',
      ),
    ).toMatchObject({
      turnover: '10000.00',
      feeBasis: '9500.00',
      fee: '950.00',
      payable: '7050.00',
      ownCost: '200.00',
    });
    expect(
      calculateSettlement(
        { ...contract, basis: 'turnover' },
        revenue,
        expenses,
        '2026-10-01',
        '2026-10-31',
      ).payable,
    ).toBe('7000.00');
  });
  it('prorates calendar days and rounds half up to cents', () => {
    expect(
      calculateSettlement(
        { ...contract, method: 'fixed', fixedFee: '1000', rent: '0' },
        [],
        [],
        '2026-10-01',
        '2026-10-15',
      ).fee,
    ).toBe('483.87');
    expect(
      calculateSettlement(
        { ...contract, method: 'fixed', fixedFee: '1000', rent: '0' },
        [],
        [],
        '2026-10-16',
        '2026-10-31',
      ).fee,
    ).toBe('516.13');
    expect(
      calculateSettlement(
        { ...contract, rent: '0' },
        [
          {
            ...revenue[0]!,
            receipts: '0.05',
            refunds: '0',
            activity: '0',
            collected: '0.05',
          },
        ],
        [],
        '2026-10-01',
        '2026-10-31',
      ).fee,
    ).toBe('0.01');
  });
  it('takes the higher of minimum and commission and retains a negative balance', () => {
    expect(
      calculateSettlement(
        { ...contract, method: 'minimum', minimum: '1200' },
        revenue,
        expenses,
        '2026-10-01',
        '2026-10-31',
      ).fee,
    ).toBe('1200.00');
    expect(
      calculateSettlement(
        { ...contract, method: 'fixed', fixedFee: '100', rent: '0' },
        [],
        [],
        '2026-10-01',
        '2026-10-31',
      ).payable,
    ).toBe('-100.00');
  });
  it('rejects malformed money and identifies leap-year half-months', () => {
    expect(() => cents('1.001')).toThrow();
    expect(() => cents('-1')).toThrow();
    expect(periodFor('2028-02', 'second')).toEqual([
      '2028-02-16',
      '2028-02-29',
    ]);
    expect(() => periodFor('2026-13', 'month')).toThrow();
  });
});
