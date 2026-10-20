import { useEffect } from 'react';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from '@nocobase/i18n/client';
import { useWork } from '../cashier/work.js';
export function useDeliveryWrite() {
  const api = useApiClient(),
    cache = useQueryClient(),
    toast = useToaster(),
    { t } = useTranslation(),
    w = useWork();
  const write = async <T>(
    path: string,
    body: unknown,
    message: string | ((result: T) => string),
  ): Promise<T | undefined> => {
    w.setError(undefined);
    w.setBusy(true);
    try {
      const result = await api.request<{ data: T }>({
        path,
        method: 'POST',
        json: body,
      });
      await cache.invalidateQueries({ queryKey: ['hyl'] });
      toast.show({
        type: 'success',
        title: typeof message === 'function' ? message(result.data) : message,
      });
      return result.data;
    } catch (e) {
      w.fail(e);
      return undefined;
    } finally {
      w.setBusy(false);
    }
  };
  return { ...w, write, t };
}
export function toggleSelection(
  values: string[],
  id: string,
  checked: boolean,
) {
  return checked
    ? [...new Set([...values, id])]
    : values.filter((v) => v !== id);
}

export function useRefreshMissing(error: unknown) {
  const cache = useQueryClient();
  useEffect(() => {
    if (error instanceof ApiClientError && [403, 404].includes(error.status))
      void cache.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'hyl' &&
          [
            'tenantOperations/serviceRecords',
            'tenantOperations/batches',
          ].includes(String(query.queryKey[1])),
      });
  }, [error, cache]);
}
