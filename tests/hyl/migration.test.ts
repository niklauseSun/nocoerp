// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { describeMigration } from '@nocobase/app-testing/server';
describeMigration('202610140001_hyl_business', {
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
    for (const name of [
      'hylMerchants',
      'hylContracts',
      'hylRevenueReports',
      'hylExpenses',
      'hylSettlements',
    ]) {
      await expectCollection(name).toHaveIndex(['number'], { unique: true });
      await expectCollection(name).toHaveIndex(['merchantId']);
    }
    await expectCollection('hylPayments').toHaveIndex(['reference'], {
      unique: true,
    });
  },
  down: async ({ expectCollection }) => {
    for (const name of [
      'hylMerchants',
      'hylContracts',
      'hylRevenueReports',
      'hylExpenses',
      'hylSettlements',
      'hylPayments',
      'hylEvents',
      'hylTransitions',
      'hylEffectRuns',
    ])
      await expectCollection(name).not.toExist();
  },
});
