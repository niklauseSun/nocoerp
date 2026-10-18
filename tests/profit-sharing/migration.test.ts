// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { describeMigration } from '@nocobase/app-testing/server';
describeMigration('202610180002_profit_sharing', {
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
    await expectCollection('hylSplitOrders').toHaveIndex(
      ['sourceKind', 'sourceId'],
      { unique: true },
    );
    await expectCollection('hylSplitTransfers').toHaveIndex(
      ['merchantId', 'reference'],
      { unique: true },
    );
  },
  down: async ({ expectCollection }) => {
    for (const name of [
      'hylSplitRules',
      'hylSplitOrders',
      'hylSplitRevisions',
      'hylSplitTransfers',
      'hylSplitAttempts',
      'hylSplitOperations',
    ])
      await expectCollection(name).not.toExist();
  },
});
