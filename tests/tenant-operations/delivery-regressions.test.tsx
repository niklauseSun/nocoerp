import { renderHook, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useLeave } from '../../client/pages/inspections/leave.js';
const { guards } = vi.hoisted(() => ({ guards: [] as (() => boolean)[] }));
vi.mock('@nocobase/app-client', () => ({
  useNavigationGuard: (guard: () => boolean) => {
    guards.push(guard);
  },
}));
afterEach(() => {
  cleanup();
  guards.length = 0;
});
it('blocks navigation while submitting even when the page is clean', () => {
  const r = renderHook(({ busy }) => useLeave(false, busy), {
    initialProps: { busy: true },
  });
  expect(guards.at(-1)!()).toBe(false);
  expect(r.result.current.guard()).toBe(false);
  r.rerender({ busy: false });
  expect(guards.at(-1)!()).toBe(true);
});
