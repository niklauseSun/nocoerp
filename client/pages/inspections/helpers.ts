import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiClientError } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import type { Kind } from '../../../server/inspections/model.js';
export { str, today } from '../repairs/helpers.js';
export const endpoint = (kind: Kind) =>
  'inspection' + kind[0].toUpperCase() + kind.slice(1);
export function useInspectionCan(action: string) {
  return useCan({
    resource: { type: 'composite', id: 'hyl.inspections' },
    action,
  });
}

export function useMissingRecord(error: unknown, kind: Kind) {
  const cache = useQueryClient();
  useEffect(() => {
    if (error instanceof ApiClientError && error.status === 404)
      void cache.invalidateQueries({ queryKey: ['hyl', endpoint(kind)] });
  }, [error, cache, kind]);
}
