// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  prorated,
  utilityAmount,
  fixedDecimal,
} from '../../server/billing/calculation.js';

describe('billing fixed decimal calculations', () => {
  it('prorates actual inclusive days, including half cycles and leap years', () => {
    expect(prorated('3100', '2026-10-17', '2026-10-31')).toBe('1500.00');
    expect(prorated('310', '2026-10-17', '2026-10-31')).toBe('150.00');
    expect(prorated('2900', '2024-02-17', '2024-02-29')).toBe('1300.00');
    expect(prorated('2800', '2026-02-01', '2026-02-15')).toBe('1500.00');
    expect(prorated('3.50', '2026-10-17', '2026-10-31', '12.3456')).toBe(
      '20.91',
    );
  });
  it('charges measured consumption once, supports zero use and 4 decimal prices', () => {
    expect(utilityAmount('100', '112', '1', '3.50')).toEqual({
      usage: '12',
      amount: '42.00',
    });
    expect(utilityAmount('200', '230', '1', '.8')).toEqual({
      usage: '30',
      amount: '24.00',
    });
    expect(utilityAmount('10', '10', '1', '2')).toEqual({
      usage: '0',
      amount: '0.00',
    });
    expect(utilityAmount('0', '0.1', '1.5', '0.3333').amount).toBe('0.05');
    expect(() => utilityAmount('12', '11', '1', '2')).toThrow();
    for (const value of ['-1', '1e3', 'NaN', '1.12345'])
      expect(() => fixedDecimal(value)).toThrow();
  });
});
