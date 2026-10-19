import { useAuthorizationRevision } from '@nocobase/app-plugin-authorization/client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useApiClient } from '@nocobase/app-client';
import { useQuery } from '@tanstack/react-query';
export function useReport<T>(
  path: string,
  query: Record<string, string | number>,
) {
  const revision = useAuthorizationRevision(),
    api = useApiClient(),
    { session } = useAuthentication(),
    actor = session?.user.id ?? 'signed-out';
  return useQuery({
    queryKey: ['finance', path, query, actor, revision],
    queryFn: () => api.request<T>({ path, query }),
    retry: false,
    refetchOnWindowFocus: false,
    placeholderData: (previous, previousQuery) => {
      const old = previousQuery?.queryKey[2] as
        Record<string, string | number> | undefined;
      return old &&
        previousQuery?.queryKey[3] === actor &&
        previousQuery?.queryKey[4] === revision &&
        ['projectId', 'from', 'to', 'view'].every((k) => old[k] === query[k])
        ? previous
        : undefined;
    },
  });
}
export const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
