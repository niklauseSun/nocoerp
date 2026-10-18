// @vitest-environment node
import { expect, it } from 'vitest';
import {
  calculateUsage,
  usageSortKey,
} from '../../server/energy/calculation.js';
it('keeps eight-decimal usage, rounds only final cents and sorts exact large values', () => {
  expect(calculateUsage('100', '130', '1', '5')).toMatchObject({
    usage: '30',
    amountCents: '15000',
  });
  expect(calculateUsage('1000', '1120', '2', '0.8')).toMatchObject({
    usage: '240',
    amountCents: '19200',
  });
  expect(calculateUsage('0', '0.0001', '0.0001', '1')).toMatchObject({
    usage: '0.00000001',
    amountCents: '0',
  });
  expect(
    usageSortKey('999999999999.0001') < usageSortKey('999999999999.0002'),
  ).toBe(true);
  expect(() => calculateUsage('2', '1', '1', '1')).toThrow();
});
