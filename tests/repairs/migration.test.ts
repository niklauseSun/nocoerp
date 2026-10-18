// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { describeMigration } from '@nocobase/app-testing/server';
describeMigration('202610180005_repairs', {
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
    await expectCollection('hylRepairOrders').toHaveIndex(['number'], {
      unique: true,
    });
    await expectCollection('hylRepairEvents').toHaveIndex(['orderId']);
  },
  down: async ({ expectCollection }) => {
    for (const n of [
      'hylRepairOperations',
      'hylRepairEvents',
      'hylRepairOrders',
    ])
      await expectCollection(n).not.toExist();
  },
});
