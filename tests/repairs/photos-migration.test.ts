// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { describeMigration } from '@nocobase/app-testing/server';
describeMigration('202610210001_repair_photos', {
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
    await expectCollection('hylRepairFiles').toHaveIndex(['orderId', 'stage']);
    await expectCollection('hylRepairFiles').toHaveIndex(['ownerId', 'linked']);
  },
  down: async ({ expectCollection }) => {
    await expectCollection('hylRepairFiles').not.toExist();
  },
});
