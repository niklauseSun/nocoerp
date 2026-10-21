import { useState, useRef } from 'react';
import { useApiClient, useToaster } from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import {
  useCan,
  useAuthorizationRevision,
} from '@nocobase/app-plugin-authorization/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from '@nocobase/i18n/client';
export function useOrg<T>(
  path: string,
  query?: Record<string, string | number>,
  enabled = true,
  refetchOnMount: boolean | 'always' = true,
) {
  const api = useApiClient(),
    { session } = useAuthentication(),
    revision = useAuthorizationRevision();
  return useQuery({
    queryKey: ['organization', session?.user.id, revision, path, query],
    queryFn: () => api.request<T>({ path, query }),
    enabled,
    refetchOnMount,
    placeholderData: (previous, old) =>
      old?.queryKey[1] === session?.user.id &&
      old?.queryKey[2] === revision &&
      old?.queryKey[3] === path
        ? previous
        : undefined,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
export function useSetting(id: string, action = 'read') {
  return useCan({ resource: { type: 'settings', id }, action });
}

export function useSave() {
  const api = useApiClient(),
    cache = useQueryClient(),
    toast = useToaster(),
    { t } = useTranslation(),
    pendingRef = useRef(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  return {
    busy,
    error,
    async run<T>(
      path: string,
      method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      json: unknown,
      name: string,
      onError?: (error: unknown) => void,
    ) {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setBusy(true);
      setError(undefined);
      try {
        const result = await api.request<T>({ path, method, json });
        await cache.invalidateQueries({ queryKey: ['organization'] });
        toast.show({ title: t('organization.saved', { name }) });
        return result ?? {};
      } catch (e) {
        setError(e);
        onError?.(e);
      } finally {
        pendingRef.current = false;
        setBusy(false);
      }
    },
  };
}
