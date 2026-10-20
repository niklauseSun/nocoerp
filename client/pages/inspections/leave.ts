import { useState, useRef, useEffect } from 'react';
import { useNavigationGuard } from '@nocobase/app-client';
export function useLeave(dirty: boolean, busy: boolean) {
  const [discard, setDiscard] = useState(false),
    mayCloseRef = useRef(false),
    discardRef = useRef<((v: boolean) => void) | undefined>(undefined),
    pendingLeaveRef = useRef<string | undefined>(undefined),
    discardOpenRef = useRef(false);
  const w = { busy };
  const guard = () => {
    if (mayCloseRef.current) return true;
    if (busy) return false;
    if (!dirty) return true;
    return new Promise<boolean>((resolve) => {
      discardRef.current = resolve;
      discardOpenRef.current = true;
      setDiscard(true);
    });
  };
  // The app's navigation guard is synchronous. Capture the intended local link/POP,
  // decline navigation, then resume that URL after our asynchronous discard dialog.
  useNavigationGuard(() => {
    if (w.busy) return false;
    if (mayCloseRef.current || !dirty) return true;
    discardRef.current = undefined;
    discardOpenRef.current = true;
    setDiscard(true);
    return false;
  });
  useEffect(() => {
    const click = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>('a[href]')
          : null;
      if (
        link &&
        link.target !== '_blank' &&
        !link.download &&
        new URL(link.href).origin === window.location.origin
      )
        pendingLeaveRef.current = link.href;
    };
    const pop = () => {
      if (!discardOpenRef.current)
        pendingLeaveRef.current = window.location.href;
    };
    document.addEventListener('click', click, true);
    window.addEventListener('popstate', pop);
    return () => {
      document.removeEventListener('click', click, true);
      window.removeEventListener('popstate', pop);
    };
  }, []);
  useEffect(() => {
    const handle = (e: BeforeUnloadEvent) => {
      if (dirty && !mayCloseRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handle);
    return () => window.removeEventListener('beforeunload', handle);
  }, [dirty]);
  const allow = () => {
    mayCloseRef.current = true;
  };
  const dismiss = () => {
    discardOpenRef.current = false;
    setDiscard(false);
    discardRef.current?.(false);
  };
  const accept = (fallback: () => void) => {
    mayCloseRef.current = true;
    discardOpenRef.current = false;
    setDiscard(false);
    if (discardRef.current) discardRef.current(true);
    else if (pendingLeaveRef.current)
      window.location.assign(pendingLeaveRef.current);
    else fallback();
  };
  return { guard, discard, allow, dismiss, accept };
}
