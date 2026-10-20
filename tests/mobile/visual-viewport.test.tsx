import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useVisualViewport } from '../../client/hooks/use-visual-viewport.js';
const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');
afterEach(() => {
  cleanup();
  if (original) Object.defineProperty(window, 'visualViewport', original);
  else Reflect.deleteProperty(window, 'visualViewport');
});
it('tracks keyboard-sized viewport and offset without changing application state', () => {
  const viewport = Object.assign(new EventTarget(), {
    height: 700,
    offsetTop: 0,
  });
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: viewport,
  });
  const remove = vi.spyOn(viewport, 'removeEventListener');
  const { result, unmount } = renderHook(useVisualViewport);
  expect(result.current).toMatchObject({
    '--route-viewport-height': '700px',
    '--route-viewport-top': '0px',
  });
  act(() => {
    viewport.height = 330;
    viewport.offsetTop = 80;
    viewport.dispatchEvent(new Event('resize'));
  });
  expect(result.current).toMatchObject({
    '--route-viewport-height': '330px',
    '--route-viewport-top': '80px',
  });
  act(() => {
    viewport.offsetTop = 100;
    viewport.dispatchEvent(new Event('scroll'));
  });
  expect(result.current['--route-viewport-top']).toBe('100px');
  unmount();
  expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
  expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
  act(() => {
    viewport.dispatchEvent(new Event('resize'));
  });
});
it('uses the window viewport when visualViewport is unavailable', () => {
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: undefined,
  });
  const { result } = renderHook(useVisualViewport);
  expect(result.current['--route-viewport-height']).toBe(
    window.innerHeight + 'px',
  );
  expect(result.current['--route-viewport-top']).toBe('0px');
});
