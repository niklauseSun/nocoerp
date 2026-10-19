import {
  useQuery,
  type QueryKey,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useAuthorizationRevision } from '@nocobase/app-plugin-authorization/client';
/** Keep pagination continuity only within the same signed-in identity and authorization revision. */
export function useScopedQuery<
  TQueryFnData,
  TError = Error,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(options: UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>) {
  const { session } = useAuthentication(),
    revision = useAuthorizationRevision(),
    scope = JSON.stringify([session?.user.id ?? null, revision]);
  return useQuery({
    ...options,
    queryKey: [...options.queryKey, scope] as unknown as TQueryKey,
    placeholderData: options.placeholderData
      ? (data, previous) =>
          previous?.queryKey.at(-1) === scope ? data : undefined
      : undefined,
  });
}
