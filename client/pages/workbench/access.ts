import { useCan } from '@nocobase/app-plugin-authorization/client';
export function useEntryAccess(
  page: string,
  resource: string,
  action = 'read',
) {
  const p = useCan({ resource: { type: 'page', id: page }, action: 'access' }),
    r = useCan({ resource: { type: 'composite', id: resource }, action });
  return {
    can: p.can && r.can && !p.isPending && !r.isPending,
    pending: p.isPending || r.isPending,
  };
}
