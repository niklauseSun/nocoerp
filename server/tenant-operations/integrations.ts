import type { z } from 'zod';
import { z as schema } from 'zod';
import { type Access, type HylService, fail } from '../hyl/service.js';
import { normalizeBankCsv } from './bank-import.js';
import { fingerprint } from './batches.js';
export const integrationTypes = [
  'payments',
  'invoices',
  'platform',
  'miniapp',
] as const;
export const integrationCheckSchema = schema
  .object({ requestId: schema.uuid(), type: schema.enum(integrationTypes) })
  .strict();
export interface IntegrationCheck {
  id: string;
  actor: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
/** Preparation only. No service-provider credentials, remote calls or financial state changes are made here. */
export class IntegrationReadiness {
  constructor(readonly hyl: HylService) {}
  async scope(access: Access) {
    await this.hyl.policy(access, 'merchants', 'read');
  }
  async list(access: Access) {
    await this.scope(access);
    const checks = await this.hyl.db
      .repository<IntegrationCheck>('hylIntegrationChecks')
      .findMany({
        filter: { actor: access.actor },
        sort: (s) => [s.field('createdAt').desc()],
      });
    const canRun =
      (
        await access.authorization.authorize({
          resource: { type: 'settings', id: 'hyl.integrationTesting' },
          action: 'run',
        })
      ).effect === 'permit';
    return {
      canRun,
      items: integrationTypes.map((type) => ({
        type,
        environment: 'test',
        status: type === 'miniapp' ? 'h5Only' : 'testOnly',
        providerConfigured: false,
        checks: checks.filter((c) => c.type === type).slice(0, 10),
        path:
          type === 'invoices'
            ? '/invoicing'
            : type === 'payments'
              ? '/profit-sharing'
              : type === 'miniapp'
                ? '/workbench'
                : '/tenantOperations?view=reconciliation',
      })),
    };
  }
  async check(access: Access, v: z.infer<typeof integrationCheckSchema>) {
    await this.scope(access);
    if (
      (
        await access.authorization.authorize({
          resource: { type: 'settings', id: 'hyl.integrationTesting' },
          action: 'run',
        })
      ).effect !== 'permit'
    )
      fail('ACCESS_DENIED', 'PERMISSION_DENIED');
    const repo = this.hyl.db.repository<IntegrationCheck>(
      'hylIntegrationChecks',
    );
    const old = await repo.findOne({ filter: { id: v.requestId } });
    if (old) {
      if (old.actor !== access.actor || old.type !== v.type)
        fail('REQUEST_CONFLICT', 'ALREADY_EXISTS');
      return old;
    }
    const reference = 'TEST-NOT-REAL-' + v.requestId;
    const fixture =
      v.type === 'platform'
        ? normalizeBankCsv(
            `ID,Date,Ref,Net\nTEST-ROW,2026-10-20,${reference},100.01`,
            {
              externalId: 'ID',
              date: 'Date',
              reference: 'Ref',
              amount: 'Net',
              unit: 'yuan',
              defaultMethod: 'bank',
            },
          )
        : {
            requestId: v.requestId,
            reference,
            amountCents: '10001',
            currency: 'CNY',
            environment: 'test',
            financialMutation: false,
            issued: false,
            paid: false,
          };
    return (
      await repo.createOne({
        values: {
          id: v.requestId,
          actor: access.actor,
          type: v.type,
          payload: {
            reference,
            mode: 'localContractCheck',
            fingerprint: fingerprint(fixture),
            fixture,
            result: 'testPassed',
            remoteVerified: false,
            financialMutation: false,
          },
          createdAt: new Date().toISOString(),
        },
      })
    ).record;
  }
}
