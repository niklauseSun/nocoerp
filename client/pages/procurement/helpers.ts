import { useCan } from '@nocobase/app-plugin-authorization/client';
import type { Kind } from '../../../server/procurement/model.js';
export { str, today } from '../repairs/helpers.js';
export const endpoint = (k: Kind) =>
  'purchase' + k[0].toUpperCase() + k.slice(1);
export function useProcurementCan(action: string) {
  return useCan({
    resource: { type: 'composite', id: 'hyl.procurement' },
    action,
  });
}
