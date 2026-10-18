import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { ApiClientError, useNavigationGuard } from '@nocobase/app-client';
import { fieldMessages } from '../billing/form-errors.js';
export function useWork() {
  const { t } = useTranslation();
  const [busyInternal, setBusyInternal] = useState(false),
    [error, setError] = useState<unknown>(),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [attempted, setAttempted] = useState(false);
  const busyRef = useRef(false);
  const setBusy = (v: boolean) => {
    busyRef.current = v;
    setBusyInternal(v);
  };
  useNavigationGuard(() => !busyRef.current);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (busyRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);
  const focus = (e: Record<string, string>) => {
    setErrors(e);
    setAttempted(true);
    const first = Object.keys(e)[0];
    if (first)
      setTimeout(() => document.getElementById(`cashier-${first}`)?.focus(), 0);
    return !first;
  };
  const fail = (e: unknown) => {
    setError(e);
    const fields = fieldMessages(e, t);
    if (Object.keys(fields).length) focus(fields);
  };
  return {
    busy: busyInternal,
    setBusy,
    error,
    setError,
    errors,
    setErrors,
    attempted,
    focus,
    fail,
    conflict: error instanceof ApiClientError && error.status === 409,
  };
}
