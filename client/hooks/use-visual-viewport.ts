import { useSyncExternalStore, type CSSProperties } from 'react';
// iOS keyboards may resize only visualViewport, leaving dvh unchanged. The
// overlay reads these variables only on phones; application/form state is untouched.
function snapshot() {
  const viewport = window.visualViewport;
  return `${viewport?.height ?? window.innerHeight}:${viewport?.offsetTop ?? 0}`;
}
function subscribe(onChange: () => void) {
  const viewport = window.visualViewport;
  viewport?.addEventListener('resize', onChange);
  viewport?.addEventListener('scroll', onChange);
  window.addEventListener('resize', onChange);
  return () => {
    viewport?.removeEventListener('resize', onChange);
    viewport?.removeEventListener('scroll', onChange);
    window.removeEventListener('resize', onChange);
  };
}
export function useVisualViewport(): CSSProperties & {
  '--route-viewport-height': string;
  '--route-viewport-top': string;
} {
  const value = useSyncExternalStore(subscribe, snapshot, () => '0:0');
  const [height, top] = value.split(':').map(Number);
  return {
    '--route-viewport-height': height > 0 ? `${height}px` : '100dvh',
    '--route-viewport-top': `${top}px`,
  };
}
