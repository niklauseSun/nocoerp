// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { describeMigration } from '@nocobase/app-testing/server';
describeMigration('202610170001_lease_lifecycle', {
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
    await expectCollection('hylLeases').toHaveIndex(['merchantId']);
    await expectCollection('hylLeaseEntries').toHaveIndex(
      ['contractId', 'requestId'],
      { unique: true },
    );
    await expectCollection('hylLeaseEntries').toHaveIndex(
      ['contractId', 'reference'],
      { unique: true },
    );
    await expectCollection('hylLeaseEntries').toHaveIndex(['reverseOf'], {
      unique: true,
    });
  },
  down: async ({ expectCollection }) => {
    await expectCollection('hylLeases').not.toExist();
    await expectCollection('hylLeaseEntries').not.toExist();
  },
});
