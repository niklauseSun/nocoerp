import { expect, it } from 'vitest';
import { isDue, dispatchWindow } from '../../server/inspections/calendar.js';
it('anchors daily/weekly/once and clamps month-end including leap years', () => {
  expect(isDue('2026-01-31', '2026-12-31', 'monthly', '2026-02-28')).toBe(true);
  expect(isDue('2024-01-31', '2024-12-31', 'monthly', '2024-02-29')).toBe(true);
  expect(isDue('2026-01-31', '2026-12-31', 'monthly', '2026-03-30')).toBe(
    false,
  );
  expect(isDue('2026-10-17', '2026-10-31', 'weekly', '2026-10-24')).toBe(true);
  expect(isDue('2026-10-17', '2026-10-31', 'once', '2026-10-18')).toBe(false);
  expect(isDue('2026-10-17', '2026-10-31', 'daily', '2026-10-16')).toBe(false);
  expect(
    dispatchWindow('2026-10-17', '2026-10-01', '2026-12-31', '2026-12-31'),
  ).toHaveLength(31);
  expect(dispatchWindow('', '2026-10-17', '2026-10-31', '2026-10-18')).toEqual([
    '2026-10-17',
    '2026-10-18',
  ]);
});
