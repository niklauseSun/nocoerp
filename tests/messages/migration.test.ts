// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { describeMigration } from '@nocobase/app-testing/server';
describeMigration('202610190002_messages', {
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
    await expectCollection('hylMessageTodos').toHaveIndex(['dedupeKey'], {
      unique: true,
    });
    await expectCollection('hylMessagePreferences').toExist();
  },
  down: async ({ expectCollection }) => {
    await expectCollection('hylMessageTodos').not.toExist();
    await expectCollection('hylMessagePreferences').not.toExist();
  },
});
