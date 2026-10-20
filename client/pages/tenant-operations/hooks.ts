import { useApiClient } from '@nocobase/app-client';
import { useQuery } from '@tanstack/react-query';
import { useBusinessIdentity } from '../hyl/hooks.js';
/** Retain pagination/search results only within the same business scope and view. */
export function useOperations<T>(query: Record<string, string>) {
  const api = useApiClient(),
    [actor, revision] = useBusinessIdentity();
  return useQuery({
    queryKey: ['hyl', 'tenantOperations', query, actor, revision],
    queryFn: () => api.request<T>({ path: 'tenantOperations', query }),
    retry: false,
    refetchOnWindowFocus: false,
    placeholderData: (previous, old) => {
      const scope = old?.queryKey[2] as Record<string, string> | undefined;
      return old?.queryKey[3] === actor &&
        old?.queryKey[4] === revision &&
        scope &&
        ['view', 'month', 'group'].every((k) => scope[k] === query[k])
        ? previous
        : undefined;
    },
  });
}
