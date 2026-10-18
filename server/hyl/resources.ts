import {
  defineCompositeResource,
  defineRecordAccess,
} from '@nocobase/authorization/core';
import {
  defineDatabasePermission,
  type AppAuthorization,
} from '@nocobase/app-plugin-authorization/server';
import { buildFilter } from '@nocobase/repository-input';
import type { DatabaseManager } from '@nocobase/db';
import { kinds, tables, type Kind } from './schema.js';
const fields = [
  'id',
  'number',
  'name',
  'merchantId',
  'userId',
  'date',
  'status',
  'payload',
  'version',
  'lifecycleVersion',
  'statusChangedAt',
  'createdAt',
  'updatedAt',
  'amountCents',
  'settlementId',
];
export const resources = Object.fromEntries(
  kinds.map((kind) => {
    const data = defineDatabasePermission((p) =>
      p
        .collection(tables[kind])
        .title({ key: `hyl.nav.${kind}`, ns: 'nocoerp' })
        .read(fields),
    );
    return [
      kind,
      defineCompositeResource(`hyl.${kind}`, (r) => {
        const base = r
          .title({ key: `hyl.nav.${kind}`, ns: 'nocoerp' })
          .action('read', (a) =>
            a
              .title({ key: 'hyl.actions.view', ns: 'nocoerp' })
              .grant('records', data),
          )
          .action('write', (a) =>
            a
              .title({ key: 'hyl.actions.edit', ns: 'nocoerp' })
              .grant('records', data.create(fields).update(fields)),
          )
          .action('submit', (a) =>
            a
              .title({ key: 'hyl.actions.submit', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('review', (a) =>
            a
              .title({ key: 'hyl.actions.approve', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('confirm', (a) =>
            a
              .title({ key: 'hyl.actions.confirm', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('pay', (a) =>
            a
              .title({ key: 'hyl.actions.pay', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          );
        if (kind !== 'contracts') return base;
        return base
          .action('invoiceRead', (a) =>
            a
              .title({ key: 'invoice.permissions.invoiceRead', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('invoiceConfigure', (a) =>
            a
              .title({
                key: 'invoice.permissions.invoiceConfigure',
                ns: 'nocoerp',
              })
              .grant('records', data.update(fields)),
          )
          .action('invoiceIssue', (a) =>
            a
              .title({ key: 'invoice.permissions.invoiceIssue', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('invoiceRed', (a) =>
            a
              .title({ key: 'invoice.permissions.invoiceRed', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('invoiceBackfill', (a) =>
            a
              .title({
                key: 'invoice.permissions.invoiceBackfill',
                ns: 'nocoerp',
              })
              .grant('records', data.update(fields)),
          )
          .action('splitRead', (a) =>
            a
              .title({ key: 'split.permissions.splitRead', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('splitConfigure', (a) =>
            a
              .title({ key: 'split.permissions.splitConfigure', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('splitReview', (a) =>
            a
              .title({ key: 'split.permissions.splitReview', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('splitExecute', (a) =>
            a
              .title({ key: 'split.permissions.splitExecute', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('splitRecover', (a) =>
            a
              .title({ key: 'split.permissions.splitRecover', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('cashierRead', (a) =>
            a
              .title({ key: 'cashier.permissions.cashierRead', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('cashierCheckout', (a) =>
            a
              .title({
                key: 'cashier.permissions.cashierCheckout',
                ns: 'nocoerp',
              })
              .grant('records', data.update(fields)),
          )
          .action('cashierRefund', (a) =>
            a
              .title({
                key: 'cashier.permissions.cashierRefund',
                ns: 'nocoerp',
              })
              .grant('records', data.update(fields)),
          )
          .action('cashierReverse', (a) =>
            a
              .title({
                key: 'cashier.permissions.cashierReverse',
                ns: 'nocoerp',
              })
              .grant('records', data.update(fields)),
          )
          .action('cashierReconcileRead', (a) =>
            a
              .title({
                key: 'cashier.permissions.cashierReconcileRead',
                ns: 'nocoerp',
              })
              .grant('records', data.update(fields)),
          )
          .action('cashierReconcile', (a) =>
            a
              .title({
                key: 'cashier.permissions.cashierReconcile',
                ns: 'nocoerp',
              })
              .grant('records', data.update(fields)),
          )
          .action('cashierReconcileAll', (a) =>
            a
              .title({
                key: 'cashier.permissions.cashierReconcileAll',
                ns: 'nocoerp',
              })
              .grant('records', data.update(fields)),
          )
          .action('billingRead', (a) =>
            a
              .title({ key: 'billing.permissions.billingRead', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('billingConfigure', (a) =>
            a
              .title({
                key: 'billing.permissions.billingConfigure',
                ns: 'nocoerp',
              })
              .grant('records', data.update(fields)),
          )
          .action('billWrite', (a) =>
            a
              .title({ key: 'billing.permissions.billWrite', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('billIssue', (a) =>
            a
              .title({ key: 'billing.permissions.billIssue', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('billVoid', (a) =>
            a
              .title({ key: 'billing.permissions.billVoid', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('receiptRead', (a) =>
            a
              .title({ key: 'billing.permissions.receiptRead', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('receiptReceive', (a) =>
            a
              .title({
                key: 'billing.permissions.receiptReceive',
                ns: 'nocoerp',
              })
              .grant('records', data.update(fields)),
          )
          .action('receiptAllocate', (a) =>
            a
              .title({
                key: 'billing.permissions.receiptAllocate',
                ns: 'nocoerp',
              })
              .grant('records', data.update(fields)),
          )
          .action('receiptReverse', (a) =>
            a
              .title({
                key: 'billing.permissions.receiptReverse',
                ns: 'nocoerp',
              })
              .grant('records', data.update(fields)),
          )
          .action('receiptRefund', (a) =>
            a
              .title({
                key: 'billing.permissions.receiptRefund',
                ns: 'nocoerp',
              })
              .grant('records', data.update(fields)),
          )
          .action('depositRead', (a) =>
            a
              .title({ key: 'lease.actions.depositRead', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('depositReceive', (a) =>
            a
              .title({ key: 'lease.actions.depositReceive', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('depositDeduct', (a) =>
            a
              .title({ key: 'lease.actions.depositDeduct', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('depositRefund', (a) =>
            a
              .title({ key: 'lease.actions.depositRefund', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('depositTransfer', (a) =>
            a
              .title({ key: 'lease.actions.depositTransfer', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('depositReverse', (a) =>
            a
              .title({ key: 'lease.actions.depositReverse', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('renew', (a) =>
            a
              .title({ key: 'lease.actions.renew', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('terminate', (a) =>
            a
              .title({ key: 'lease.actions.terminate', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('closeLease', (a) =>
            a
              .title({ key: 'lease.actions.closeLease', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('reopenLease', (a) =>
            a
              .title({ key: 'lease.actions.reopenLease', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('collectionReceive', (a) =>
            a
              .title({ key: 'lease.actions.collectionReceive', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('collectionReverse', (a) =>
            a
              .title({ key: 'lease.actions.collectionReverse', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('chargeWrite', (a) =>
            a
              .title({ key: 'lease.actions.chargeWrite', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          )
          .action('chargeConfirm', (a) =>
            a
              .title({ key: 'lease.actions.chargeConfirm', ns: 'nocoerp' })
              .grant('records', data.update(fields)),
          );
      }),
    ];
  }),
) as Record<Kind, ReturnType<typeof defineCompositeResource>>;
export function registerResources(
  authz: AppAuthorization,
  db: DatabaseManager,
): void {
  authz.ui.sections.add({
    name: 'hyl',
    title: { key: 'hyl.copy.workspace', ns: 'nocoerp' },
    parent: 'business',
  });
  for (const kind of kinds) {
    authz.database.collections.add({
      name: tables[kind],
      title: { key: `hyl.nav.${kind}`, ns: 'nocoerp' },
    });
    authz.compositeResources.define(resources[kind]);
    authz.ui.place(resources[kind].reference(), { section: 'hyl' });
  }
  authz.recordAccess.define(
    defineRecordAccess('hyl.ownMerchant', (access) =>
      access
        .title({ key: 'hyl.ownMerchant', ns: 'nocoerp' })
        .collections(...Object.values(tables))
        .resolver(async ({ principal, collection }) => {
          if (principal.type !== 'user') return false;
          if (collection === tables.merchants)
            return buildFilter((f) => f.string('userId').eq(principal.id));
          const merchants = await db
            .repository(tables.merchants)
            .findMany({ filter: { userId: principal.id } });
          if (!merchants.length) return false;
          return buildFilter((f) =>
            f.or(
              merchants.map((m) =>
                f.string('merchantId').eq(typeof m.id === 'string' ? m.id : ''),
              ),
            ),
          );
        }),
    ),
  );
}
