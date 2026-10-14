// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { describeMigration } from '@nocobase/app-testing/server';
describeMigration('202610140003_merchant_profile', {
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
    await expectCollection('hylMerchantRecords').toHaveIndex(
      ['merchantId', 'type', 'requestId'],
      { unique: true },
    );
    await expectCollection('hylMerchantFiles').toHaveIndex([
      'merchantId',
      'ownerId',
      'linked',
    ]);
  },
  down: async ({ expectCollection }) => {
    await expectCollection('hylMerchantRecords').not.toExist();
    await expectCollection('hylMerchantFiles').not.toExist();
  },
});
