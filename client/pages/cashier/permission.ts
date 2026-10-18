import { useBusinessPermission } from '../hyl/hooks.js';
/** Visibility includes prerequisite capabilities; the server still checks every source contract's scope. */
export function useCashierPermission(action: string) {
  const cashier = useBusinessPermission('contracts', action);
  const bill = useBusinessPermission('contracts', 'billingRead');
  const read = useBusinessPermission('contracts', 'receiptRead');
  const receive = useBusinessPermission('contracts', 'receiptReceive');
  const allocate = useBusinessPermission('contracts', 'receiptAllocate');
  const refund = useBusinessPermission('contracts', 'receiptRefund');
  const reverse = useBusinessPermission('contracts', 'receiptReverse');
  return {
    can:
      cashier.can &&
      (action === 'cashierCheckout'
        ? bill.can && read.can && receive.can && allocate.can
        : action === 'cashierRefund'
          ? read.can && refund.can
          : action === 'cashierReverse'
            ? read.can && reverse.can
            : true),
  };
}
