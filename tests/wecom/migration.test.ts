// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { describeMigration } from '@nocobase/app-testing/server';
describeMigration('202611130001_wecom', {
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
    await expectCollection('hylWecomMappings').toHaveIndex(
      ['corpId', 'kind', 'remoteId'],
      { unique: true },
    );
    await expectCollection('hylWecomMappings').toHaveIndex(
      ['corpId', 'kind', 'localId'],
      { unique: true },
    );
    await expectCollection('hylWecomMessages').toExist();
  },
  down: async ({ expectCollection }) => {
    for (const name of [
      'hylWecomMessages',
      'hylWecomAudit',
      'hylWecomMappings',
    ])
      await expectCollection(name).not.toExist();
  },
});
