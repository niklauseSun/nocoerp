// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { describeMigration } from '@nocobase/app-testing/server';
describeMigration('202610150001_merchant_file_recovery', {
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
    await expectCollection('hylMerchantFiles').toHaveIndex(
      ['merchantId', 'ownerId', 'uploadId'],
      { unique: true },
    );
    await expectCollection('hylMerchantFileCleanup').toHaveIndex([
      'merchantId',
      'ownerId',
    ]);
  },
  down: async ({ expectCollection }) => {
    await expectCollection('hylMerchantFileCleanup').not.toExist();
  },
});
describeMigration('202610150002_enforce_merchant_upload_identity', {
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
    await expectCollection('hylMerchantFiles').toHaveIndex(
      ['merchantId', 'ownerId', 'uploadId'],
      { unique: true },
    );
  },
  down: async ({ expectCollection }) => {
    await expectCollection('hylMerchantFiles').toHaveIndex([
      'merchantId',
      'ownerId',
      'linked',
    ]);
  },
});
