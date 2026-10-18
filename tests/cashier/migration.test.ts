// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { describeMigration } from '@nocobase/app-testing/server';
describeMigration('202610180001_cashier', {
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
    await expectCollection('hylCashierReferences').toHaveIndex(
      ['merchantId', 'reference'],
      { unique: true },
    );
    await expectCollection('hylCashierMembers').toHaveIndex(
      ['recordId', 'kind', 'sourceId'],
      { unique: true },
    );
  },
  down: async ({ expectCollection }) => {
    for (const name of [
      'hylCashierOrders',
      'hylCashierRefunds',
      'hylCashierReconciliations',
      'hylCashierMembers',
      'hylCashierReferences',
      'hylCashierOperations',
    ])
      await expectCollection(name).not.toExist();
  },
});
