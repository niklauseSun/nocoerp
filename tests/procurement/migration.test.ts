// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { describeMigration } from '@nocobase/app-testing/server';
describeMigration('202610190001_procurement', {
  sources: [
    {
      packageName: 'nocoerp',
      directory: fileURLToPath(
        new URL('../../database/main/migrations', import.meta.url),
      ),
      extensions: ['.ts'],
    },
  ],
  up: async ({ expectCollection }) => {
    for (const n of [
      'hylPurchaseSuppliers',
      'hylPurchaseRequests',
      'hylPurchaseOrders',
      'hylPurchaseReceipts',
      'hylPurchasePayments',
      'hylPurchaseLedger',
    ])
      await expectCollection(n).toHaveIndex(['dedupeKey'], { unique: true });
  },
  down: async ({ expectCollection }) => {
    for (const n of [
      'hylPurchaseSuppliers',
      'hylPurchaseRequests',
      'hylPurchaseOrders',
      'hylPurchaseReceipts',
      'hylPurchasePayments',
      'hylPurchaseLedger',
      'hylPurchaseEvents',
      'hylPurchaseOperations',
    ])
      await expectCollection(n).not.toExist();
  },
});
