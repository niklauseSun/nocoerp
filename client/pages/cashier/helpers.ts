import type { Kind } from './types.js';
export const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export const routeKind = (path: string): Kind => {
  const positions: [Kind, number][] = [
    [
      'orders',
      Math.max(
        path.lastIndexOf('/orders'),
        path.lastIndexOf('/order/'),
        path.lastIndexOf('/cashierOrder/'),
      ),
    ],
    [
      'refunds',
      Math.max(path.lastIndexOf('/refunds'), path.lastIndexOf('/refund/')),
    ],
    [
      'reconciliations',
      Math.max(
        path.lastIndexOf('/reconciliations'),
        path.lastIndexOf('/reconciliation/'),
      ),
    ],
  ];
  return positions.sort((a, b) => b[1] - a[1])[0][0];
};
