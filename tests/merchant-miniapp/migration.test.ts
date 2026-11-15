// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { describeMigration } from '@nocobase/app-testing/server';

describeMigration('202611150001_merchant_miniapp', {
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
    await expectCollection('hylMiniappGrants').toHaveIndex(
      ['merchantId', 'phone'],
      { unique: true },
    );
    await expectCollection('hylMiniappIdentities').toHaveIndex(['userId'], {
      unique: true,
    });
    await expectCollection('hylMiniappDaily').toHaveIndex(
      ['merchantId', 'date'],
      { unique: true },
    );
    await expectCollection('hylMiniappLoginProofs').toHaveIndex(['expiresAt']);
    await expectCollection('hylMiniappSessions').toHaveIndex(['expiresAt']);
  },
  down: async ({ expectCollection }) => {
    for (const name of [
      'hylMiniappGrants',
      'hylMiniappIdentities',
      'hylMiniappDaily',
      'hylMiniappLoginProofs',
      'hylMiniappSessions',
    ])
      await expectCollection(name).not.toExist();
  },
});
