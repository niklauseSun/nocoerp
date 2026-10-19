import { useEffect, useRef, useState } from 'react';
import { useApiClient, useToaster, ApiClientError } from '@nocobase/app-client';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from '@nocobase/i18n/client';
import { useWork } from '../cashier/work.js';
export { useBusinessQuery } from '../hyl/hooks.js';
export const kinds = ['contracts', 'bills', 'purchases'];
export function useWrite() {
  const w = useWork(),
    api = useApiClient(),
    cache = useQueryClient(),
    toast = useToaster(),
    { t } = useTranslation(),
    [uncertain, setUncertain] = useState(false),
    busyRef = useRef(false),
    pendingRef = useRef<{ path: string; body: unknown } | undefined>(undefined);
  return {
    ...w,
    uncertain,
    send: async (
      path: string,
      body: unknown,
      done: (data: unknown) => void,
      name: string,
    ) => {
      if (busyRef.current) return;
      busyRef.current = true;
      w.setBusy(true);
      w.setError(undefined);
      const request = pendingRef.current ?? { path, body };
      pendingRef.current = request;
      try {
        const r = await api.request<{ data: unknown }>({
          path: request.path,
          method: 'POST',
          json: request.body,
        });
        pendingRef.current = undefined;
        setUncertain(false);
        w.setBusy(false);
        done(r.data);
        toast.show({ title: t('approval.savedNamed', { name }) });
        void cache.invalidateQueries({ queryKey: ['hyl'] });
      } catch (e) {
        w.fail(e);
        if (e instanceof ApiClientError && e.status < 500) {
          pendingRef.current = undefined;
          setUncertain(false);
        } else setUncertain(true);
      } finally {
        busyRef.current = false;
        w.setBusy(false);
      }
    },
  };
}
export function useEvict(error: unknown) {
  const cache = useQueryClient();
  useEffect(() => {
    if (error instanceof ApiClientError && [403, 404].includes(error.status))
      void cache.invalidateQueries({ queryKey: ['hyl', 'approvalRequests'] });
  }, [error, cache]);
}
