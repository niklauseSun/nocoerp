// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { describeMigration } from '@nocobase/app-testing/server';
describeMigration('202610170002_billing', {
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
    await expectCollection('hylBillingConfigs').toHaveIndex(
      ['contractId', 'version'],
      { unique: true },
    );
    await expectCollection('hylBillLines').toHaveIndex(['sourceKey']);
    await expectCollection('hylBills').toHaveIndex(['contractId']);
    await expectCollection('hylReceipts').toHaveIndex(
      ['merchantId', 'reference'],
      { unique: true },
    );
    await expectCollection('hylReceiptEntries').toHaveIndex(['reverseOf'], {
      unique: true,
    });
  },
  down: async ({ expectCollection }) => {
    for (const name of [
      'hylBillingConfigs',
      'hylBills',
      'hylBillLines',
      'hylReceipts',
      'hylReceiptEntries',
      'hylBillingOperations',
    ])
      await expectCollection(name).not.toExist();
  },
});
