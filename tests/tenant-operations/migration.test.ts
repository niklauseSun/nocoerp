// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { describeMigration } from '@nocobase/app-testing/server';
const sources = [
  {
    packageName: 'nocoerp',
    directory: fileURLToPath(
      new URL('../../database/main/migrations', import.meta.url),
    ),
    extensions: ['.ts'],
  },
];
describeMigration('202610200005_operations_delivery', {
  sources,
  up: async ({ expectCollection }) => {
    await expectCollection('hylSettlementBatchItems').toHaveIndex(
      ['batchId', 'contractId'],
      { unique: true },
    );
    await expectCollection('hylTenantServiceRecords').toHaveIndex([
      'merchantId',
    ]);
  },
  down: async ({ expectCollection }) => {
    for (const c of [
      'hylSettlementBatches',
      'hylSettlementBatchItems',
      'hylTenantServiceRecords',
      'hylTenantServiceEvents',
    ])
      await expectCollection(c).not.toExist();
  },
});
describeMigration('202610200004_bank_resolutions', {
  sources,
  up: async ({ expectCollection }) => {
    await expectCollection('hylBankResolutions').toHaveIndex(['rowId']);
  },
  down: async ({ expectCollection }) => {
    await expectCollection('hylBankResolutions').not.toExist();
  },
});
describeMigration('202610200002_tenant_operations', {
  sources,
  up: async ({ expectCollection }) => {
    await expectCollection('hylBankRows').toHaveIndex(
      ['account', 'externalId'],
      { unique: true },
    );
    await expectCollection('hylBankMatches').toHaveIndex(['eventId'], {
      unique: true,
    });
    await expectCollection('hylBankMatches').toHaveIndex(['rowId'], {
      unique: true,
    });
  },
  down: async ({ expectCollection }) => {
    for (const c of ['hylBankRows', 'hylBankMatches', 'hylOperationFollowups'])
      await expectCollection(c).not.toExist();
  },
});
describeMigration('202610200003_reporting_evidence', {
  sources,
  up: async ({ expectCollection }) => {
    await expectCollection('hylReportingFiles').toHaveIndex([
      'kind',
      'recordId',
    ]);
  },
  down: async ({ expectCollection }) => {
    await expectCollection('hylReportingFiles').not.toExist();
  },
});

describeMigration('202610200006_integration_checks', {
  sources,
  up: async ({ expectCollection }) => {
    await expectCollection('hylIntegrationChecks').toHaveIndex(['actor']);
  },
  down: async ({ expectCollection }) => {
    await expectCollection('hylIntegrationChecks').not.toExist();
  },
});
