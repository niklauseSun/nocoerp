import type { DatabaseConnection } from '@nocobase/db';
import type { HylService } from '../hyl/service.js';
import type { Source } from './model.js';
import { refresh, autoIssue } from './engine.js';
// The transaction owns this queue. Nested receipt mutations never flush intermediate allocations.
const dirty = new WeakMap<DatabaseConnection, Set<string>>();
export function markInvoiceBill(c: DatabaseConnection, id: string) {
  let set = dirty.get(c);
  if (!set) {
    set = new Set();
    dirty.set(c, set);
    c.afterRollback(() => {
      dirty.delete(c);
    });
  }
  set.add(id);
}
export async function flushInvoices(
  c: DatabaseConnection,
  hyl: HylService,
  actor: string,
) {
  const ids = dirty.get(c);
  if (!ids) return;
  try {
    for (const billId of ids) {
      const previous = await c
          .repository<Source>('hylInvoiceSources')
          .findOne({ filter: { billId } }),
        source = await refresh(c, hyl, billId, actor);
      if (BigInt(source.paidCents) > BigInt(previous?.paidCents ?? '0'))
        await autoIssue(c, hyl, source, actor);
    }
  } finally {
    dirty.delete(c);
  }
}
