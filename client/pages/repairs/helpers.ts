import { useBusinessIdentity } from '../hyl/hooks.js';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useQueryClient } from '@tanstack/react-query';
import type { Order } from './common.js';
export const str = (v: unknown) => (typeof v === 'string' ? v : '');
export const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export function useRepairCan(action: string) {
  return useCan({ resource: { type: 'composite', id: 'hyl.repairs' }, action });
}
export function useRepairCache() {
  const identity = useBusinessIdentity();
  const cache = useQueryClient();
  return async (row: Order) => {
    cache.setQueriesData<{ data: Order }>(
      {
        predicate: (q) =>
          q.queryKey[3] === identity[0] &&
          q.queryKey[4] === identity[1] &&
          q.queryKey[0] === 'hyl' &&
          q.queryKey[1] === 'repairOrders/' + row.id,
      },
      (old) =>
        old ? { data: { ...row, events: old.data.events } } : { data: row },
    );
    await cache.invalidateQueries({
      predicate: (q) =>
        q.queryKey[0] === 'hyl' &&
        String(q.queryKey[1]).startsWith('repairOrders'),
    });
  };
}
