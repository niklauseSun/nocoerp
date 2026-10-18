import type { DatabaseConnection } from '@nocobase/db';
import type { Row } from './model.js';
// Caller holds the same project lock as procurement mutations. Only physical fulfilment blocks repair completion.
export async function procurementRepairBlock(
  c: DatabaseConnection,
  repairId: string,
  action: string,
) {
  if (!['complete', 'close', 'cancel'].includes(action)) return '';
  const requests = await c
      .repository<Row>('hylPurchaseRequests')
      .findMany({ filter: { repairId } }),
    orders = await c
      .repository<Row>('hylPurchaseOrders')
      .findMany({ filter: { repairId } });
  const openRequest = requests.some(
      (r) => !['cancelled', 'ordered'].includes(r.status),
    ),
    live = orders.filter((r) => r.status !== 'cancelled');
  if (action === 'cancel')
    return openRequest || live.length > 0
      ? 'PURCHASE_REPAIR_CANCEL_BLOCKED'
      : '';
  return openRequest ||
    live.some((r) => BigInt(r.acceptedCents) !== BigInt(r.amountCents))
    ? 'PURCHASE_REPAIR_INCOMPLETE'
    : '';
}
