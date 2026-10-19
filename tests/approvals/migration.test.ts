// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { describeMigration } from '@nocobase/app-testing/server';
describeMigration('202610190003_approvals', {
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
    for (const table of [
      'hylApprovalRequests',
      'hylApprovalOpinions',
      'hylApprovalOperations',
      'hylApprovalParameterHeads',
      'hylApprovalParameterVersions',
      'hylApprovalParameterSelections',
      'hylApprovalParameterRequests',
      'hylApprovalParameterSnapshots',
      'hylApprovalParameterUsages',
    ])
      await expectCollection(table).toExist();
  },
  down: async ({ expectCollection }) => {
    for (const table of [
      'hylApprovalRequests',
      'hylApprovalOpinions',
      'hylApprovalOperations',
      'hylApprovalParameterHeads',
      'hylApprovalParameterVersions',
      'hylApprovalParameterSelections',
      'hylApprovalParameterRequests',
      'hylApprovalParameterSnapshots',
      'hylApprovalParameterUsages',
    ])
      await expectCollection(table).not.toExist();
  },
});
