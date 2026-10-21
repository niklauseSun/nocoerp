// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { describeMigration } from '@nocobase/app-testing/server';
describeMigration('202610180003_invoicing', {
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
    await expectCollection('hylInvoiceSources').toHaveIndex(['billId'], {
      unique: true,
    });
    await expectCollection('hylInvoiceMembers').toHaveIndex(
      ['invoiceId', 'sourceId'],
      { unique: true },
    );
  },
  down: async ({ expectCollection }) => {
    for (const name of [
      'hylInvoiceConfigs',
      'hylInvoiceSources',
      'hylInvoices',
      'hylInvoiceLines',
      'hylInvoiceMembers',
      'hylInvoiceAttempts',
      'hylInvoiceOperations',
      'hylInvoiceSourceRevisions',
    ])
      await expectCollection(name).not.toExist();
  },
});
