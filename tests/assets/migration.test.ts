// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { describeMigration } from '@nocobase/app-testing/server';
const tables = [
  'hylAssets',
  'hylAssetHistory',
  'hylAssetBindings',
  'hylContractAssets',
  'hylAssetFiles',
  'hylAssetFileCleanup',
  'hylAssetSetup',
];
describeMigration('202610150004_assets', {
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
    await expectCollection('hylAssets').toHaveIndex(['number'], {
      unique: true,
    });
    await expectCollection('hylAssetBindings').toHaveIndex(
      ['merchantId', 'requestId'],
      { unique: true },
    );
    await expectCollection('hylContractAssets').toHaveIndex(
      ['contractId', 'assetId'],
      { unique: true },
    );
  },
  down: async ({ expectCollection }) => {
    for (const table of tables) await expectCollection(table).not.toExist();
  },
});
