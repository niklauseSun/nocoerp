// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { describeMigration } from '@nocobase/app-testing/server';
describeMigration('202610180004_energy', {
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
    await expectCollection('hylEnergyMeters').toHaveIndex(['code'], {
      unique: true,
    });
    await expectCollection('hylEnergyBillLinks').toHaveIndex(
      ['activeReadingId'],
      { unique: true },
    );
  },
  down: async ({ expectCollection }) => {
    for (const name of [
      'hylEnergyMeters',
      'hylEnergyAssignments',
      'hylEnergyReadings',
      'hylEnergyBillLinks',
      'hylEnergyOperations',
      'hylEnergyAudit',
    ])
      await expectCollection(name).not.toExist();
  },
});
