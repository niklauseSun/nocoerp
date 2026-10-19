import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useAuthorizationRevision } from '@nocobase/app-plugin-authorization/client';
import { useEffect } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import type { Asset, List } from './model.js';
export function useAssetPermission(action: 'read' | 'write') {
  return useCan({ resource: { type: 'composite', id: 'hyl.assets' }, action });
}
export function useAssetTree(enabled = true) {
  const api = useApiClient(),
    { session } = useAuthentication(),
    revision = useAuthorizationRevision();
  const query = useInfiniteQuery({
    queryKey: ['hyl', 'asset-tree', session?.user.id, revision],
    enabled,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.request<List<Asset>>({
        path: 'assetsTree',
        query: { page: pageParam, pageSize: 200 },
      }),
    getNextPageParam: (page) =>
      page.meta.page * page.meta.pageSize < page.meta.total
        ? page.meta.page + 1
        : undefined,
    retry: false,
  });
  return {
    ...query,
    rows: query.data?.pages.flatMap((page) => page.data) ?? [],
  };
}

export function useDraftWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
}
