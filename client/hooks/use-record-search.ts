import { useState } from 'react';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useAuthorizationRevision } from '@nocobase/app-plugin-authorization/client';
export function useRecordSearchScope(source: string) {
  const { session } = useAuthentication(),
    revision = useAuthorizationRevision();
  return JSON.stringify([source, session?.user.id, revision]);
}
/** Reset query and paging immediately when source constraints or authorization change. */
export function useRecordSearchState(source: string) {
  const scope = useRecordSearchScope(source);
  const [stored, setStored] = useState({ scope, q: '', page: 1 });
  if (stored.scope !== scope) setStored({ scope, q: '', page: 1 });
  const state = stored.scope === scope ? stored : { scope, q: '', page: 1 };
  return {
    q: state.q,
    page: state.page,
    setQ: (q: string) =>
      setStored((old) => ({
        scope,
        q,
        page: old.scope === scope ? old.page : 1,
      })),
    setPage: (page: number) =>
      setStored((old) => ({
        scope,
        page,
        q: old.scope === scope ? old.q : '',
      })),
  };
}
