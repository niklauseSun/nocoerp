import { useEffect, useRef } from 'react';
/** Covering pages keep the origin DOM mounted; defer until its inert layer has cleared. */
export function useCoverFocus() {
  const originRef = useRef(
    typeof document === 'undefined' ? null : document.activeElement,
  );
  useEffect(
    () => () => {
      queueMicrotask(() => {
        const prior = originRef.current;
        if (
          prior instanceof HTMLElement &&
          prior !== document.body &&
          prior.isConnected &&
          !prior.closest('[inert]')
        ) {
          prior.focus();
          return;
        }
        const heading = [...document.querySelectorAll<HTMLElement>('h1')]
          .filter((h) => !h.closest('[inert]'))
          .at(-1);
        if (heading) {
          heading.tabIndex = -1;
          heading.focus();
        }
      });
    },
    [],
  );
}
