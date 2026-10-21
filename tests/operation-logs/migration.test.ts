// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { describeMigration } from '@nocobase/app-testing/server';
describeMigration('202610210002_operation_logs', {
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
    await expectCollection('hylOperationLogs').toHaveIndex(['createdAt', 'id']);
  },
  down: async ({ expectCollection }) => {
    await expectCollection('hylOperationLogs').not.toExist();
  },
});
