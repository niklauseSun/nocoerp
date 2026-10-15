import { assetBusinessDay } from '../../server/assets/dates.js';
// @vitest-environment node
import { expect, it } from 'vitest';
import { assetSchema } from '../../server/assets/schema.js';
import en from '../../client/locales/assets/en-US.js';
import zh from '../../client/locales/assets/zh-CN.js';
it('returns validation errors without throwing for malformed areas', () => {
  for (const area of ['x', '-1', '1.001', '', '999999999999999']) {
    expect(() =>
      assetSchema.safeParse({ name: 'Test', type: 'project', area }),
    ).not.toThrow();
    expect(
      assetSchema.safeParse({ name: 'Test', type: 'project', area }).success,
    ).toBe(false);
  }
});
it('provides the same nonempty copy keys in both languages', () => {
  const keys = (value: Record<string, unknown>, prefix = ''): string[] =>
    Object.entries(value).flatMap(([key, entry]) =>
      typeof entry === 'object' && entry
        ? keys(entry as Record<string, unknown>, `${prefix}${key}.`)
        : [`${prefix}${key}`],
    );
  expect(keys(en).sort()).toEqual(keys(zh).sort());
  for (const value of Object.values(en))
    if (typeof value === 'string') expect(value.trim()).not.toBe('');
});

it('uses Shanghai midnight for current occupancy and future allocation checks', () => {
  expect(assetBusinessDay(new Date('2026-10-15T15:59:59Z'))).toBe('2026-10-15');
  expect(assetBusinessDay(new Date('2026-10-15T16:00:00Z'))).toBe('2026-10-16');
});
