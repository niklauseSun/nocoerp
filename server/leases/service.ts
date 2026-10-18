import type { EnergyRecord } from '../energy/model.js';
import { flushInvoices } from '../invoicing/queue.js';
import { buildFilter } from '@nocobase/repository-input';
import { syncContract } from '../profit-sharing/projection.js';
import { ApiError } from '@nocobase/app-server/router';
import type { Bill } from '../billing/model.js';
import {
  assertCashReference,
  closingBlockers,
  rentOnlyCovered,
  recalculateBill,
} from '../billing/accounting.js';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { DatabaseConnection, RepositoryPolicy } from '@nocobase/db';
import { fail, type Access, type HylService } from '../hyl/service.js';
import type { Row } from '../hyl/schema.js';
import { contractSchema } from '../hyl/schema.js';
import { cents } from '../hyl/calculation.js';
import { saveContractAssets } from '../assets/contracts.js';
import { assetPolicy } from '../providers/assets.js';
import { getAsset, lockProjects, audit } from '../assets/transactions.js';
import type { Binding, ContractAsset } from '../assets/schema.js';
import {
  getLease,
  effectiveEnd,
  effectiveEntries,
  depositBalance,
  money,
  type Entry,
  type Operation,
  type LeaseAction,
} from './model.js';

const actionKinds: Record<string, LeaseAction> = {
  receive: 'depositReceive',
  deduct: 'depositDeduct',
  refund: 'depositRefund',
  reverse: 'depositReverse',
  collect: 'collectionReceive',
  reverseCollection: 'collectionReverse',
  charge: 'chargeWrite',
  confirmCharge: 'chargeConfirm',
  cancelCharge: 'chargeConfirm',
  renew: 'renew',
  terminate: 'terminate',
  closeLease: 'closeLease',
  reopenLease: 'reopenLease',
};
export class LeaseService {
  constructor(readonly hyl: HylService) {}
  async entries(c: DatabaseConnection, id: string) {
    return c.repository<Entry>('hylLeaseEntries').findMany({
      filter: { contractId: id },
      sort: (s) => [s.field('createdAt').asc(), s.field('id').asc()],
    });
  }
  async summary(access: Access, id: string) {
    const policy = await this.hyl.policy(access, 'contracts', 'depositRead');
    const row = await this.hyl.get(
      access,
      'contracts',
      id,
      'depositRead',
      undefined,
      policy,
    );
    const c = this.hyl.db.connection(),
      lease = await getLease(c, row),
      entries = await this.entries(c, id);
    const settlementPolicy = await this.hyl
      .policy(access, 'settlements', 'read')
      .catch(() => undefined);
    const settlements = settlementPolicy
      ? await c
          .repository<Row>('hylSettlements')
          .withPolicy(settlementPolicy)
          .findMany({ filter: { merchantId: row.merchantId } })
      : [];
    const own = (settlements as Row[]).filter(
      (s) => s.payload.contractId === id && s.status !== 'cancelled',
    );
    const charges = effectiveEntries(entries)
      .filter((e) => e.kind === 'charge')
      .map((e) => ({
        ...e,
        state: entries.some(
          (x) => x.kind === 'cancelCharge' && x.sourceId === e.id,
        )
          ? 'cancelled'
          : entries.some(
                (x) => x.kind === 'confirmCharge' && x.sourceId === e.id,
              )
            ? 'confirmed'
            : 'draft',
        remaining: money(this.remaining(entries, e.id, BigInt(e.amountCents))),
      }));
    let billingVisible = false;
    try {
      await this.hyl.get(access, 'contracts', id, 'billingRead');
      billingVisible = true;
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
    }
    const bills = billingVisible
      ? await c
          .repository<Bill>('hylBills')
          .findMany({ filter: { contractId: id } })
      : [];
    const checkedEntries = await Promise.all(
      entries.map(async (e) => {
        const blockers: {
          reason: string;
          contractId: string;
          entries: string[];
        }[] = [];
        if (
          [
            'receive',
            'refund',
            'deduct',
            'transferIn',
            'transferOut',
            'collect',
          ].includes(e.kind) &&
          !e.reverseOf &&
          !entries.some((x) => x.reverseOf === e.id)
        ) {
          if (lease.status === 'closed')
            blockers.push({ reason: 'closed', contractId: id, entries: [] });
          if (
            depositBalance([
              ...entries,
              { ...e, id: 'preview', reverseOf: e.id },
            ]) < 0n
          )
            blockers.push({
              reason: 'consumed',
              contractId: id,
              entries: effectiveEntries(entries)
                .filter((x) =>
                  ['deduct', 'refund', 'transferOut'].includes(x.kind),
                )
                .map((x) => x.id),
            });
          if (e.pairId) {
            const other = (await c
              .repository<Row>('hylContracts')
              .withPolicy(policy)
              .findOne({ filter: { id: e.pairId } })) as Row | undefined;
            if (!other)
              blockers.push({
                reason: 'restricted',
                contractId: '',
                entries: [],
              });
            else {
              const otherLease = await getLease(c, other),
                others = await this.entries(c, other.id),
                pair = others.find(
                  (x) =>
                    x.pairId === id &&
                    x.payload.transferId === e.payload.transferId,
                );
              if (otherLease.status === 'closed')
                blockers.push({
                  reason: 'closed',
                  contractId: other.id,
                  entries: [],
                });
              else if (
                pair &&
                depositBalance([
                  ...others,
                  { ...pair, id: 'preview', reverseOf: pair.id },
                ]) < 0n
              )
                blockers.push({
                  reason: 'consumed',
                  contractId: other.id,
                  entries: effectiveEntries(others)
                    .filter((x) =>
                      ['deduct', 'refund', 'transferOut'].includes(x.kind),
                    )
                    .map((x) => x.id),
                });
            }
          }
        }
        return { ...e, reversalBlockers: blockers };
      }),
    );
    return {
      ...lease,
      depositTarget:
        typeof row.payload.depositTarget === 'string'
          ? row.payload.depositTarget
          : '0',
      balance: money(depositBalance(entries)),
      entries: checkedEntries,
      charges,
      bills: bills
        .filter((b) => b.status === 'issued')
        .map((b) => ({
          id: b.id,
          number: b.number,
          remaining: money(BigInt(b.remainingCents)),
        })),
      settlements: own.map((s) => ({
        ...s,
        debtRemaining: money(
          this.remaining(
            entries,
            s.id,
            BigInt(s.amountCents) < 0n ? -BigInt(s.amountCents) : 0n,
          ),
        ),
      })),
    };
  }
  remaining(entries: Entry[], sourceId: string, due: bigint) {
    return (
      due -
      effectiveEntries(entries)
        .filter(
          (e) =>
            e.sourceId === sourceId && ['deduct', 'collect'].includes(e.kind),
        )
        .reduce((sum, e) => sum + BigInt(e.amountCents), 0n)
    );
  }
  async preview(
    access: Access,
    id: string,
    actualEnd: string,
    closing = false,
  ) {
    const policy = await this.hyl.policy(access, 'contracts', 'terminate');
    const row = await this.hyl.get(
      access,
      'contracts',
      id,
      'terminate',
      undefined,
      policy,
    );
    const policies = await this.sourcePolicies(access);
    const assets = await assetPolicy(access, 'write');
    return this.inspect(
      this.hyl.db.connection(),
      row,
      actualEnd,
      policies,
      closing,
      assets,
    );
  }
  private async sourcePolicies(access: Access) {
    return {
      revenueReports: await this.hyl.policy(access, 'revenueReports', 'read'),
      expenses: await this.hyl.policy(access, 'expenses', 'read'),
      settlements: await this.hyl.policy(access, 'settlements', 'read'),
      contracts: await this.hyl.policy(access, 'contracts', 'read'),
      billing: await this.hyl
        .policy(access, 'contracts', 'billingRead')
        .catch(() => undefined),
      receipts: await this.hyl
        .policy(access, 'contracts', 'receiptRead')
        .catch(() => undefined),
    };
  }
  private async inspect(
    c: DatabaseConnection,
    row: Row,
    end: string,
    policies: Awaited<ReturnType<LeaseService['sourcePolicies']>>,
    closing = false,
    assetAccess?: RepositoryPolicy,
  ) {
    if (end < String(row.payload.start) || end > String(row.payload.end))
      fail('INVALID_PERIOD');
    const blockers: {
      kind: string;
      id: string;
      number: string;
      date: string;
      status: string;
      contractId?: string;
    }[] = [];
    for (const kind of [
      'revenueReports',
      'expenses',
      'settlements',
      'contracts',
    ] as const) {
      const all = await c
        .repository<Row>(`hyl${kind[0].toUpperCase()}${kind.slice(1)}`)
        .withPolicy(policies[kind])
        .findMany({ filter: { merchantId: row.merchantId } });
      const count = await c
        .repository(`hyl${kind[0].toUpperCase()}${kind.slice(1)}`)
        .count({ filter: { merchantId: row.merchantId } });
      if (all.length !== count) fail('ACCESS_DENIED', 'PERMISSION_DENIED');
      for (const r of all as Row[]) {
        const conflict =
          kind === 'contracts'
            ? !closing &&
              r.id !== row.id &&
              String(r.payload.start) >= String(row.payload.start)
            : kind === 'settlements'
              ? r.status !== 'cancelled' &&
                r.payload.contractId === row.id &&
                String(r.payload.end) > end
              : !closing &&
                r.date > end &&
                r.date >= String(row.payload.start) &&
                r.date <= String(row.payload.end);
        if (conflict)
          blockers.push({
            kind,
            id: r.id,
            number: r.number,
            date: kind === 'settlements' ? String(r.payload.end) : r.date,
            status: r.status,
          });
      }
    }
    const occupancy: {
      id: string;
      asset: string;
      start: string;
      end: string;
      proposedEnd: string;
    }[] = [];
    if (!closing && assetAccess) {
      const links = await c
        .repository<ContractAsset>('hylContractAssets')
        .findMany({ filter: { contractId: row.id } });
      for (const link of links) {
        const asset = await getAsset(c, link.assetId, assetAccess),
          bindings = await c.repository<Binding>('hylAssetBindings').findMany({
            filter: { assetId: link.assetId, merchantId: row.merchantId },
          });
        for (const binding of bindings.filter(
          (b) =>
            b.start <= String(row.payload.start) &&
            (!b.end || b.end >= String(row.payload.end)),
        )) {
          occupancy.push({
            id: binding.id,
            asset: asset.name,
            start: binding.start,
            end: binding.end,
            proposedEnd: end,
          });
          const dependents = await c
            .repository<ContractAsset>('hylContractAssets')
            .findMany({
              filter: { assetId: link.assetId, merchantId: row.merchantId },
            });
          for (const dep of dependents)
            if (
              dep.contractId !== row.id &&
              dep.end > end &&
              dep.start >= binding.start &&
              (!binding.end || dep.start <= binding.end)
            ) {
              const contract = await c
                .repository<Row>('hylContracts')
                .withPolicy(policies.contracts)
                .findOne({ filter: { id: dep.contractId } });
              if (!contract) fail('ACCESS_DENIED', 'PERMISSION_DENIED');
              blockers.push({
                kind: 'bindings',
                id: binding.id,
                contractId: dep.contractId,
                number: `${asset.name} / ${contract.number}`,
                date: dep.end,
                status: String(contract.status),
              });
            }
        }
      }
    }
    for (const [table, policy] of [
      ['hylBills', policies.billing],
      ['hylReceipts', policies.receipts],
    ] as const) {
      if (
        (await c
          .repository(table)
          .exists({ filter: { contractId: row.id } })) &&
        (!policy ||
          !(await c
            .repository<Row>('hylContracts')
            .withPolicy(policy)
            .findOne({ filter: { id: row.id } })))
      )
        fail('ACCESS_DENIED', 'PERMISSION_DENIED');
    }
    for (const r of await c
      .repository<EnergyRecord>('hylEnergyReadings')
      .findMany({ filter: { contractId: row.id } })) {
      if (['submitted', 'approved'].includes(r.status) && r.end > end)
        blockers.push({
          kind: 'billingCoverage',
          id: r.id,
          number: r.number,
          date: r.start,
          status: 'readingAfterEnd',
          contractId: row.id,
        });
    }
    const billingBlockers = await closingBlockers(c, row, end, closing);
    blockers.push(...billingBlockers);
    return {
      actualEnd: end,
      start: String(row.payload.start),
      blockers,
      occupancy,
    };
  }
  private async append(
    c: DatabaseConnection,
    row: Row,
    body: Operation,
    kind: string,
    actor: string,
    extra: Partial<Entry> = {},
  ) {
    const values: Entry = {
      id: randomUUID(),
      contractId: row.id,
      merchantId: row.merchantId,
      requestId: body.requestId,
      reference: ['receive', 'refund', 'collect', 'charge'].includes(kind)
        ? body.reference
        : null,
      kind,
      amountCents: [
        'receive',
        'refund',
        'deduct',
        'collect',
        'charge',
        'transferIn',
        'transferOut',
      ].includes(kind)
        ? cents(body.amount).toString()
        : '0',
      sourceId: body.sourceId ?? '',
      reverseOf: null,
      pairId: '',
      payload: { ...body, actor },
      createdAt: new Date().toISOString(),
      ...extra,
    };
    await c.repository<Entry>('hylLeaseEntries').createOne({ values });
    return values;
  }
  async operate(access: Access, id: string, action: string, body: Operation) {
    const permission = actionKinds[action];
    if (!permission) fail('INVALID_ACTION', 'INVALID_ARGUMENT');
    const contractPolicy = await this.hyl.policy(
      access,
      'contracts',
      permission,
    );
    const original = await this.hyl.get(
      access,
      'contracts',
      id,
      permission,
      undefined,
      contractPolicy,
    );
    if (action === 'renew')
      await this.hyl.get(access, 'merchants', original.merchantId);
    const sourcePolicies = ['terminate', 'closeLease'].includes(action)
      ? await this.sourcePolicies(access)
      : undefined;
    const sourceEntry =
      body.sourceId && action === 'reverse'
        ? await this.hyl.db
            .repository<Entry>('hylLeaseEntries')
            .findOne({ filter: { id: body.sourceId, contractId: id } })
        : undefined;
    const billSourceId =
      sourceEntry?.payload.sourceType === 'bill'
        ? sourceEntry.sourceId
        : body.sourceId;
    const billSource =
      billSourceId && ['deduct', 'collect', 'reverse'].includes(action)
        ? await this.hyl.db
            .repository<Bill>('hylBills')
            .findOne({ filter: { id: billSourceId, contractId: id } })
        : undefined;
    if (billSource) await this.hyl.get(access, 'contracts', id, 'billingRead');
    const settlementPolicy =
      !billSource && ['deduct', 'collect'].includes(action)
        ? await this.hyl.policy(access, 'settlements', 'read')
        : undefined;
    const renewalPolicy =
      action === 'renew'
        ? await this.hyl.policy(access, 'contracts', 'write')
        : undefined;
    const assetAccess = ['renew', 'terminate'].includes(action)
      ? await assetPolicy(access, 'write')
      : undefined;
    if (action === 'renew' && cents(body.amount) > 0n) {
      const transferPolicy = await this.hyl.policy(
        access,
        'contracts',
        'depositTransfer',
      );
      await this.hyl.get(
        access,
        'contracts',
        id,
        'depositTransfer',
        undefined,
        transferPolicy,
      );
    }
    const hash = createHash('sha256')
      .update(JSON.stringify({ action, body, actor: access.actor }))
      .digest('hex');
    return this.hyl.db.transaction(async (c) => {
      const lockedMerchant = await this.hyl.lockMerchant(
        c,
        original.merchantId,
      );
      if (action === 'renew' && lockedMerchant.status !== 'active')
        fail('MERCHANT_INACTIVE');
      const row = await this.hyl.get(
        access,
        'contracts',
        id,
        permission,
        c,
        contractPolicy,
      );
      const entries = await this.entries(c, id);
      const previous = entries.find((e) => e.requestId === body.requestId);
      if (previous) {
        if (previous.payload.hash !== hash)
          fail('LEASE_RETRY_CONFLICT', 'ALREADY_EXISTS');
        return {
          entry: previous,
          lease: await getLease(c, row),
          successorId: previous.payload.successorId,
        };
      }
      let lease = await getLease(c, row);
      if (lease.version !== body.expectedVersion)
        fail('VERSION_CONFLICT', 'ABORTED');
      if (
        action === 'closeLease' &&
        (await c.repository('hylSplitOrders').exists({
          filter: buildFilter((f) =>
            f.and([
              f.string('contractId').eq(id),
              f.string('status').ne('completed'),
              f.string('status').ne('cancelled'),
            ]),
          ),
        }))
      )
        fail('SPLIT_NOT_CLEARED');
      if (action === 'reopenLease' && lease.status !== 'closed')
        fail('LEASE_NOT_CLEARED');
      if (lease.status === 'closed' && action !== 'reopenLease')
        fail('LEASE_CLOSED');
      if (
        action !== 'reopenLease' &&
        [
          'refund',
          'deduct',
          'reverse',
          'reverseCollection',
          'terminate',
          'confirmCharge',
          'cancelCharge',
          'closeLease',
        ].includes(action) &&
        !body.reason.trim()
      )
        fail('REASON_REQUIRED', 'INVALID_ARGUMENT');
      if (
        ['deduct', 'reverse', 'reverseCollection'].includes(action) &&
        (!body.date || !body.evidence)
      )
        fail('CONFIRMATION_EVIDENCE_REQUIRED', 'INVALID_ARGUMENT');
      if (
        ['confirmCharge', 'cancelCharge', 'closeLease', 'reopenLease'].includes(
          action,
        ) &&
        !body.evidence
      )
        fail('CONFIRMATION_EVIDENCE_REQUIRED', 'INVALID_ARGUMENT');
      const balance = depositBalance(entries),
        value = cents(body.amount);
      if (
        ['receive', 'refund', 'deduct', 'collect', 'charge'].includes(action) &&
        value <= 0n
      )
        fail('PAYMENT_REQUIRED', 'INVALID_ARGUMENT');
      if (
        ['receive', 'refund', 'collect'].includes(action) &&
        (!body.date || !body.reference || !body.evidence)
      )
        fail('PAYMENT_REQUIRED', 'INVALID_ARGUMENT');
      if (['deduct', 'refund'].includes(action) && value > balance)
        fail('DEPOSIT_OVERDRAW');
      if (['receive', 'refund', 'collect'].includes(action) && body.reference)
        await assertCashReference(c, row.merchantId, body.reference);
      if (body.reference && entries.some((e) => e.reference === body.reference))
        fail('DUPLICATE_REFERENCE', 'ALREADY_EXISTS');
      if (!(await c.repository('hylLeases').exists({ filter: { id } }))) {
        await this.hyl.runtime.create(
          'hylLeases',
          {
            id,
            merchantId: row.merchantId,
            version: 0,
            actualEnd: '',
            payload: {},
          },
          { actor: { id: access.actor }, transaction: c },
        );
        lease = await getLease(c, row);
      }
      const extra: Partial<Entry> = {};
      let successorId = '';
      if (['deduct', 'collect'].includes(action)) {
        if (!body.sourceId) fail('LEASE_SOURCE_REQUIRED');
        const charge = entries.find(
          (e) => e.id === body.sourceId && e.kind === 'charge',
        );
        let due: bigint;
        if (billSource) {
          const bill = await c
            .repository<Bill>('hylBills')
            .findOne({ filter: { id: billSource.id } });
          if (
            !bill ||
            bill.status !== 'issued' ||
            action !== 'deduct' ||
            value > BigInt(bill.remainingCents)
          )
            fail('OVERPAYMENT');
          due =
            BigInt(bill.remainingCents) +
            entries
              .filter(
                (e) =>
                  e.kind === 'deduct' &&
                  e.sourceId === bill.id &&
                  !entries.some((r) => r.reverseOf === e.id),
              )
              .reduce((n, e) => n + BigInt(e.amountCents), 0n);
        } else if (charge) {
          if (
            !entries.some(
              (e) => e.kind === 'confirmCharge' && e.sourceId === charge.id,
            ) ||
            entries.some(
              (e) => e.kind === 'cancelCharge' && e.sourceId === charge.id,
            )
          )
            fail('LEASE_CHARGE_UNCONFIRMED');
          due = BigInt(charge.amountCents);
        } else {
          const s = await this.hyl.get(
            access,
            'settlements',
            body.sourceId,
            'read',
            c,
            settlementPolicy,
          );
          if (
            s.payload.contractId !== id ||
            s.status !== 'due' ||
            BigInt(s.amountCents) >= 0n
          )
            fail('LEASE_SOURCE_REQUIRED');
          due = -BigInt(s.amountCents);
        }
        if (value > this.remaining(entries, body.sourceId, due))
          fail('OVERPAYMENT');
      }
      if (
        action === 'charge' &&
        (!body.reason ||
          !body.evidence ||
          !body.date ||
          !body.reference ||
          !body.title ||
          body.sourceId)
      )
        fail('REASON_REQUIRED', 'INVALID_ARGUMENT');
      if (
        action === 'charge' &&
        (await c.repository('hylBillLines').exists({
          filter: {
            contractId: id,
            sourceKey: `${id}:other:${body.reference}`,
          },
        }))
      )
        fail('BILLING_FEE_CONFLICT');
      if (['confirmCharge', 'cancelCharge'].includes(action)) {
        const charge = entries.find(
          (e) => e.id === body.sourceId && e.kind === 'charge',
        );
        if (
          !charge ||
          entries.some(
            (e) =>
              e.sourceId === charge.id &&
              [
                'cancelCharge',
                ...(action === 'confirmCharge' ? ['confirmCharge'] : []),
              ].includes(e.kind),
          )
        )
          fail('LEASE_SOURCE_REQUIRED');
        if (
          effectiveEntries(entries).some(
            (e) =>
              e.sourceId === charge.id &&
              ['deduct', 'collect'].includes(e.kind),
          )
        )
          fail('LEASE_REVERSAL_DEPENDENCY');
      }
      if (['reverse', 'reverseCollection'].includes(action)) {
        const target = entries.find(
          (e) => e.id === body.sourceId && !e.reverseOf,
        );
        if (
          !target ||
          ![
            'receive',
            'refund',
            'deduct',
            'transferIn',
            'transferOut',
            'collect',
          ].includes(target.kind) ||
          (action === 'reverseCollection') !== (target.kind === 'collect')
        )
          fail('LEASE_SOURCE_REQUIRED');
        if (entries.some((e) => e.reverseOf === target.id))
          fail('LEASE_ALREADY_REVERSED');
        extra.reverseOf = target.id;
        extra.amountCents = target.amountCents;
        const reversed = {
          ...target,
          id: 'reversal-preview',
          reverseOf: target.id,
        };
        if (depositBalance([...entries, reversed]) < 0n)
          fail('LEASE_REVERSAL_DEPENDENCY');
        if (target.pairId) {
          await this.hyl.get(
            access,
            'contracts',
            target.pairId,
            'depositReverse',
            c,
            contractPolicy,
          );
          const counterpart = (await this.entries(c, target.pairId)).find(
            (e) =>
              e.pairId === id &&
              e.payload.transferId === target.payload.transferId,
          );
          const other = await c
            .repository<Row>('hylContracts')
            .findOne({ filter: { id: target.pairId } });
          if (!counterpart || !other) fail('LEASE_SOURCE_REQUIRED');
          const otherLease = await getLease(c, other),
            others = await this.entries(c, other.id);
          if (
            otherLease.status === 'closed' ||
            depositBalance([
              ...others,
              { ...counterpart, id: 'preview', reverseOf: counterpart.id },
            ]) < 0n
          )
            fail('LEASE_REVERSAL_DEPENDENCY');
          await this.append(
            c,
            other,
            { ...body, requestId: randomUUID() },
            action,
            access.actor,
            { reverseOf: counterpart.id, amountCents: counterpart.amountCents },
          );
          await c.repository('hylLeases').updateMany({
            filter: { id: other.id, version: otherLease.version },
            values: { version: otherLease.version + 1 },
          });
        }
      }
      if (action === 'renew') {
        if (lease.status !== 'active' || lease.payload.successorId)
          fail('LEASE_RENEWAL_EXISTS');
        const values = contractSchema.parse(body.values);
        if (
          values.merchantId !== row.merchantId ||
          values.start <= String(row.payload.end)
        )
          fail('INVALID_PERIOD');
        if (value > balance || value > cents(values.depositTarget))
          fail('DEPOSIT_OVERDRAW');
        const contracts = await c
          .repository<Row>('hylContracts')
          .findMany({ filter: { merchantId: row.merchantId } });
        for (const r of contracts)
          if (
            r.id !== id &&
            String(r.payload.start) <= values.end &&
            (await effectiveEnd(c, r)) >= values.start
          )
            fail('CONTRACT_OVERLAP');
        const number = `HT${randomBytes(12).toString('hex').toUpperCase()}`;
        const next = this.hyl.base(
          'contracts',
          { ...values, number },
          access.actor,
          await c
            .repository<Row>('hylMerchants')
            .findOne({ filter: { id: row.merchantId } }),
        );
        await c
          .repository<Row>('hylContracts')
          .withPolicy(renewalPolicy!)
          .narrow({
            create:
              renewalPolicy!.read === false
                ? false
                : renewalPolicy!.read === true
                  ? true
                  : { scope: renewalPolicy!.read.scope },
          })
          .createOne({ values: next });
        await saveContractAssets(
          c,
          next,
          values.assetIds ?? [],
          assetAccess!,
          access.actor,
        );
        await this.hyl.runtime.create(
          'hylLeases',
          {
            id: next.id,
            merchantId: row.merchantId,
            version: 0,
            actualEnd: '',
            payload: { predecessorId: id },
          },
          { actor: { id: access.actor }, transaction: c },
        );
        successorId = next.id;
        lease.payload = { ...lease.payload, successorId };
        if (value > 0n) {
          const transferId = randomUUID();
          const out = await this.append(
            c,
            row,
            { ...body, requestId: randomUUID() },
            'transferOut',
            access.actor,
            {
              pairId: next.id,
              payload: { transferId, actor: access.actor, reason: body.reason },
            },
          );
          await this.append(
            c,
            next,
            { ...body, requestId: randomUUID() },
            'transferIn',
            access.actor,
            {
              pairId: id,
              payload: {
                transferId,
                actor: access.actor,
                originEntryId: out.id,
              },
            },
          );
        }
        await this.hyl.event(c, next, access, 'create');
      }
      if (action === 'terminate') {
        if (
          lease.status !== 'active' ||
          !body.actualEnd ||
          !body.handover.trim()
        )
          fail('LEASE_TERMINATION_REQUIRED');
        const preview = await this.inspect(
          c,
          row,
          body.actualEnd,
          sourcePolicies!,
          false,
          assetAccess,
        );
        if (preview.blockers.length) fail('LEASE_TERMINATION_BLOCKED');
        const links = await c
          .repository<ContractAsset>('hylContractAssets')
          .findMany({ filter: { contractId: id } });
        const assets = await Promise.all(
          links.map((l) => getAsset(c, l.assetId, assetAccess!)),
        );
        await lockProjects(
          c,
          assets.map((a) => a.projectId),
        );
        for (const link of links) {
          const bindings = await c
            .repository<Binding>('hylAssetBindings')
            .findMany({
              filter: { assetId: link.assetId, merchantId: row.merchantId },
            });
          for (const binding of bindings.filter(
            (b) =>
              b.start <= String(row.payload.start) &&
              (!b.end || b.end >= String(row.payload.end)),
          )) {
            const dependents = await c
              .repository<ContractAsset>('hylContractAssets')
              .findMany({
                filter: { assetId: link.assetId, merchantId: row.merchantId },
              });
            for (const dep of dependents)
              if (
                dep.contractId !== id &&
                dep.end > body.actualEnd &&
                dep.start >= binding.start &&
                (!binding.end || dep.start <= binding.end)
              )
                fail('LEASE_BINDING_DEPENDENCY');
            const updated = await c.repository('hylAssetBindings').updateMany({
              filter: { id: binding.id, version: binding.version },
              values: { end: body.actualEnd, version: binding.version + 1 },
            });
            if (updated.updatedCount !== 1) fail('VERSION_CONFLICT', 'ABORTED');
            await audit(
              c,
              link.assetId,
              access.actor,
              'unbind',
              body.reason,
              binding,
              { ...binding, end: body.actualEnd },
            );
          }
        }
        lease.actualEnd = body.actualEnd;
        lease.payload = {
          ...lease.payload,
          reason: body.reason,
          handover: body.handover,
        };
      }
      if (action === 'closeLease') {
        if (
          lease.status !== 'terminated' ||
          lease.actualEnd > new Date().toISOString().slice(0, 10) ||
          balance !== 0n
        )
          fail('LEASE_NOT_CLEARED');
        const preview = await this.inspect(
          c,
          row,
          lease.actualEnd,
          sourcePolicies!,
          true,
        );
        if (preview.blockers.length) fail('LEASE_NOT_CLEARED');
        for (const kind of ['hylRevenueReports', 'hylExpenses']) {
          const sources = await c
            .repository<Row>(kind)
            .findMany({ filter: { merchantId: row.merchantId } });
          if (
            sources.some(
              (s) =>
                s.date >= String(row.payload.start) &&
                s.date <= lease.actualEnd &&
                (!s.settlementId || s.status !== 'approved'),
            )
          )
            fail('LEASE_NOT_CLEARED');
        }
        const settlements = await c
          .repository<Row>('hylSettlements')
          .findMany({ filter: { merchantId: row.merchantId } });
        const own = settlements.filter(
          (s) => s.payload.contractId === id && s.status !== 'cancelled',
        );
        const rentOnly = await rentOnlyCovered(c, row, lease.actualEnd);
        if (
          (!own.length && !rentOnly) ||
          own.some(
            (s) =>
              !['paid', 'settled', 'due'].includes(s.status) ||
              (s.status === 'due' &&
                this.remaining(entries, s.id, -BigInt(s.amountCents)) !== 0n),
          )
        )
          fail('LEASE_NOT_CLEARED');
        let cursor = String(row.payload.start);
        for (const s of [...own].sort((a, b) =>
          String(a.payload.start).localeCompare(String(b.payload.start)),
        )) {
          if (String(s.payload.start) > cursor) fail('LEASE_NOT_CLEARED');
          const next = new Date(`${String(s.payload.end)}T00:00:00Z`);
          next.setUTCDate(next.getUTCDate() + 1);
          if (next.toISOString().slice(0, 10) > cursor)
            cursor = next.toISOString().slice(0, 10);
        }
        if (cursor <= lease.actualEnd && !rentOnly) fail('LEASE_NOT_CLEARED');
        const charges = entries.filter(
          (e) =>
            e.kind === 'charge' &&
            !entries.some(
              (x) => x.kind === 'cancelCharge' && x.sourceId === e.id,
            ),
        );
        if (
          charges.some(
            (e) =>
              !entries.some(
                (x) => x.kind === 'confirmCharge' && x.sourceId === e.id,
              ) || this.remaining(entries, e.id, BigInt(e.amountCents)) !== 0n,
          )
        )
          fail('LEASE_NOT_CLEARED');
      }
      if (action === 'reopenLease' && !body.reason.trim())
        fail('REASON_REQUIRED', 'INVALID_ARGUMENT');
      if (['terminate', 'closeLease', 'reopenLease'].includes(action))
        await this.hyl.runtime.fire('hylLeases', id, action, {
          actor: { id: access.actor },
          transaction: c,
          expect: { version: lease.lifecycleVersion },
        });
      const updated = await c.repository('hylLeases').updateMany({
        filter: { id, version: lease.version },
        values: {
          version: lease.version + 1,
          actualEnd: lease.actualEnd,
          payload: lease.payload,
        },
      });
      if (updated.updatedCount !== 1) fail('VERSION_CONFLICT', 'ABORTED');
      const entry = await this.append(c, row, body, action, access.actor, {
        ...extra,
        payload: {
          ...body,
          actor: access.actor,
          hash,
          successorId,
          ...(billSource && action === 'deduct' ? { sourceType: 'bill' } : {}),
        },
      });
      if (action === 'deduct' && billSource)
        await recalculateBill(c, billSource.id);
      if (action === 'reverse') {
        const target = entries.find((e) => e.id === body.sourceId);
        if (target?.payload.sourceType === 'bill')
          await recalculateBill(c, target.sourceId);
      }
      await this.hyl.event(c, row, access, action, {
        reason: body.reason,
        reference: body.reference,
        notes: body.notes,
        entryId: entry.id,
      });
      await syncContract(c, this.hyl, id, access.actor);
      await flushInvoices(c, this.hyl, access.actor);
      return { entry, lease: await getLease(c, row), successorId };
    });
  }
}
