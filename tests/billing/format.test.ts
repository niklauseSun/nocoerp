import { expect, it } from 'vitest';
import { formatMoney } from '../../client/pages/billing/format.js';
it('preserves the last cent in aggregate amounts beyond floating point precision', () => {
  expect(formatMoney('9999999999990001', 'zh-CN', true)).toContain(
    '99,999,999,999,900.01',
  );
  expect(formatMoney('1826.00', 'zh-CN')).toContain('1,826.00');
  expect(formatMoney('-1', 'en-US', true)).toContain('0.01');
  expect(formatMoney('-1', 'en-US', true)).toContain('-');
});
