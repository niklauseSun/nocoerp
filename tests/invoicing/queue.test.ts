// @vitest-environment node
import { it, expect, vi, beforeEach } from 'vitest';
import type { DatabaseConnection } from '@nocobase/db';
import type { HylService } from '../../server/hyl/service.js';
const { refresh, autoIssue } = vi.hoisted(() => ({
  refresh: vi.fn(),
  autoIssue: vi.fn(),
}));
vi.mock('../../server/invoicing/engine.js', () => ({ refresh, autoIssue }));
import {
  markInvoiceBill,
  flushInvoices,
} from '../../server/invoicing/queue.js';
beforeEach(() => {
  refresh.mockReset();
  autoIssue.mockReset();
});
it('coalesces nested bill changes, flushes once, clears rollback and error queues', async () => {
  let rollback = () => {};
  const c = {
      afterRollback: (fn: () => void) => {
        rollback = fn;
      },
      repository: () => ({ findOne: async () => ({ paidCents: '100' }) }),
    } as unknown as DatabaseConnection,
    hyl = {} as HylService;
  refresh.mockResolvedValue({ paidCents: '200' });
  markInvoiceBill(c, 'b');
  markInvoiceBill(c, 'b');
  expect(refresh).not.toHaveBeenCalled();
  await flushInvoices(c, hyl, 'actor');
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(autoIssue).toHaveBeenCalledTimes(1);
  await flushInvoices(c, hyl, 'actor');
  expect(refresh).toHaveBeenCalledTimes(1);
  markInvoiceBill(c, 'b');
  rollback();
  await flushInvoices(c, hyl, 'actor');
  expect(refresh).toHaveBeenCalledTimes(1);
  markInvoiceBill(c, 'b');
  refresh.mockRejectedValueOnce(Error('unknown database error'));
  await expect(flushInvoices(c, hyl, 'actor')).rejects.toThrow(
    'unknown database error',
  );
  await flushInvoices(c, hyl, 'actor');
  expect(refresh).toHaveBeenCalledTimes(2);
});
it('does not automatically reissue on a refund decrease or same-paid reversal rebuild', async () => {
  const c = {
    afterRollback: () => {},
    repository: () => ({ findOne: async () => ({ paidCents: '100' }) }),
  } as unknown as DatabaseConnection;
  for (const paid of ['90', '100']) {
    refresh.mockResolvedValue({ paidCents: paid });
    markInvoiceBill(c, 'b');
    await flushInvoices(c, {} as HylService, 'actor');
  }
  expect(autoIssue).not.toHaveBeenCalled();
});
