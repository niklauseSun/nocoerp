import { useApiClient, ApiClientError } from '@nocobase/app-client';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import type { Kind } from './model.js';
export function useBusinessQuery<T>(
  path: string,
  query?: Record<string, string | number>,
  enabled = true,
) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['hyl', path, query],
    queryFn: () => api.request<T>({ path, query }),
    enabled,
    placeholderData: query ? keepPreviousData : undefined,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
export function useBusinessPermission(kind: Kind, action: string) {
  return useCan({ resource: { type: 'composite', id: `hyl.${kind}` }, action });
}
export function useErrorText() {
  const { t, i18n } = useTranslation();
  return (error: unknown): string => {
    if (error instanceof ApiClientError) {
      const key = `hyl.errors.${error.reason}`;
      return i18n.exists(key)
        ? t(key)
        : t(
            `hyl.errors.${[401, 403, 404, 409].includes(error.status) ? error.status : 'generic'}`,
          );
    }
    return t('hyl.errors.network');
  };
}
