// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { describeMigration } from '@nocobase/app-testing/server';
describeMigration('202610180006_inspections', {
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
    await expectCollection('hylInspectionTasks').toHaveIndex(
      ['generationKey'],
      { unique: true },
    );
    await expectCollection('hylInspectionIssues').toHaveIndex(
      ['activeItemKey'],
      { unique: true },
    );
  },
  down: async ({ expectCollection }) => {
    for (const n of [
      'hylInspectionOperations',
      'hylInspectionEvents',
      'hylInspectionIssues',
      'hylInspectionTasks',
      'hylInspectionPlans',
    ])
      await expectCollection(n).not.toExist();
  },
});
