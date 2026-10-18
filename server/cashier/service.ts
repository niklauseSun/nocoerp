import { flushInvoices } from '../invoicing/queue.js';
import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseConnection, RepositoryPolicy } from '@nocobase/db';
import { ApiError } from '@nocobase/app-server/router';
import { buildFilter } from '@nocobase/repository-input';
import { BillingService } from '../billing/service.js';
import { assertCashReference } from '../billing/accounting.js';
import { fail, type Access, type HylService } from '../hyl/service.js';
import type { Row } from '../hyl/schema.js';
import { getLease, depositBalance, type Entry } from '../leases/model.js';
import { cents, money } from '../hyl/calculation.js';
import { checkoutTotals } from './calculation.js';
import {
  actions,
  type CashierRecord,
  type Checkout,
  type OrderInput,
  type Operation,
  type Member,
  type Reference,
  type ListInput,
} from './model.js';
import { refundPreview, createRefund, reverseRefund } from './refunds.js';
import { reportPreview, confirmReport, reportDetail } from './reports.js';

export const tables = {
  orders: 'hylCashierOrders',
  refunds: 'hylCashierRefunds',
  reconciliations: 'hylCashierReconciliations',
} as const;
export type Kind = keyof typeof tables;
export const hash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const uid = (requestId: string, suffix: string) => {
  const h = hash({ requestId, suffix });
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
export class CashierService {
  readonly billing: BillingService;
  constructor(readonly hyl: HylService) {
    this.billing = new BillingService(hyl);
  }
  async policies(access: Access, names: readonly string[]) {
    const result = new Map<string, RepositoryPolicy>();
    for (const name of new Set(names))
      result.set(name, await this.hyl.policy(access, 'contracts', name));
    return result;
  }
  async contracts(
    access: Access,
    ids: string[],
    policies: ReadonlyMap<string, RepositoryPolicy>,
    c = this.hyl.db.connection(),
  ) {
    const rows = new Map<string, Row>();
    for (const id of new Set(ids))
      for (const [action, policy] of policies) {
        const row = await this.hyl.get(
          access,
          'contracts',
          id,
          action,
          c,
          policy,
        );
        rows.set(id, row);
      }
    return rows;
  }
  async visible(access: Access, action: string) {
    const policy = await this.hyl.policy(access, 'contracts', action);
    return new Set(
      (
        await this.hyl.db
          .repository<Row>('hylContracts')
          .withPolicy(policy)
          .findMany()
      )
        .map((r) => r.id)
        .filter((id): id is string => typeof id === 'string'),
    );
  }
  async record(kind: Kind, id: string, c = this.hyl.db.connection()) {
    const row = await c
      .repository<CashierRecord>(tables[kind])
      .findOne({ filter: { id } });
    if (!row) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    return row;
  }
  async members(id: string, c = this.hyl.db.connection()) {
    return c
      .repository<Member>('hylCashierMembers')
      .findMany({ filter: { recordId: id } });
  }
  async guard(access: Access, kind: Kind, id: string, action = 'cashierRead') {
    const row = await this.record(kind, id);
    const members = await this.members(id);
    await this.contracts(
      access,
      members.map((m) => m.contractId),
      await this.policies(access, [
        action,
        kind === 'orders'
          ? 'receiptRead'
          : kind === 'refunds'
            ? 'receiptRead'
            : 'cashierReconcileRead',
      ]),
    );
    if (
      kind === 'reconciliations' &&
      (row.actor !== access.actor || row.payload.scope === 'authorized')
    )
      await this.hyl.policy(access, 'contracts', 'cashierReconcileAll');
    if (kind !== 'reconciliations' && members.some((m) => m.kind === 'bill'))
      await this.contracts(
        access,
        members.map((m) => m.contractId),
        await this.policies(access, ['billingRead']),
      );
    return row;
  }
  async member(
    c: DatabaseConnection,
    recordId: string,
    contractId: string,
    kind: string,
    sourceId: string,
  ) {
    if (
      await c
        .repository('hylCashierMembers')
        .exists({ filter: { recordId, kind, sourceId } })
    )
      return;
    await c.repository<Member>('hylCashierMembers').createOne({
      values: { id: randomUUID(), recordId, contractId, kind, sourceId },
    });
  }
  async atomic<T>(
    access: Access,
    requestId: string,
    intent: unknown,
    merchantId: string,
    fn: (c: DatabaseConnection) => Promise<T>,
  ) {
    const fingerprint = hash({ actor: access.actor, intent });
    return this.hyl.db.transaction(async (c) => {
      await this.hyl.lockMerchant(c, merchantId);
      const old = await c
        .repository('hylCashierOperations')
        .findOne({ filter: { id: requestId } });
      if (old) {
        if (old.actor !== access.actor || old.hash !== fingerprint)
          fail('BILLING_REQUEST_REUSED', 'ALREADY_EXISTS');
        return (old.payload as { result: T }).result;
      }
      const result = await fn(c);
      await flushInvoices(c, this.hyl, access.actor);
      await c.repository('hylCashierOperations').createOne({
        values: {
          id: requestId,
          actor: access.actor,
          hash: fingerprint,
          payload: { result },
          createdAt: new Date().toISOString(),
        },
      });
      return result;
    });
  }
  async audit(
    c: DatabaseConnection,
    id: string,
    access: Access,
    action: string,
    detail: unknown,
  ) {
    await c.repository('hylEvents').createOne({
      values: {
        id: randomUUID(),
        recordId: id,
        payload: {
          action,
          actor: access.actor,
          at: new Date().toISOString(),
          detail,
        },
      },
    });
  }
  base(
    access: Access,
    prefix: string,
    merchantId: string,
    day: string,
    payload: Record<string, unknown>,
    searchText: string,
  ): CashierRecord {
    const id = randomUUID(),
      now = new Date().toISOString();
    return {
      id,
      number: `${prefix}-${day.replaceAll('-', '')}-${id.slice(0, 8)}`,
      merchantId,
      day,
      actor: access.actor,
      status:
        prefix === 'SY' ? 'draft' : prefix === 'HZ' ? 'confirmed' : 'posted',
      version: 0,
      lifecycleVersion: 0,
      statusChangedAt: now,
      receivedCents: '0',
      allocatedCents: '0',
      refundedCents: '0',
      unusedCents: '0',
      amountCents: '0',
      netCents: '0',
      differenceCents: '0',
      revision: 0,
      searchText,
      payload,
      createdAt: now,
      updatedAt: now,
    };
  }
  lifecycleValues(row: CashierRecord) {
    const values: Record<string, unknown> = { ...row };
    delete values.status;
    delete values.lifecycleVersion;
    delete values.statusChangedAt;
    return values;
  }
  async reserve(
    c: DatabaseConnection,
    merchantId: string,
    reference: string,
    recordId: string,
  ) {
    await assertCashReference(c, merchantId, reference);
    await c.repository<Reference>('hylCashierReferences').createOne({
      values: {
        id: randomUUID(),
        merchantId,
        reference,
        recordId,
        createdAt: new Date().toISOString(),
      },
    });
  }
  async preview(
    access: Access,
    input: Checkout,
    c = this.hyl.db.connection(),
    prepared?: Map<string, RepositoryPolicy>,
  ) {
    const required = [
      'cashierCheckout',
      'billingRead',
      'receiptRead',
      'receiptReceive',
      'receiptAllocate',
      ...(input.targets.some((t) => cents(t.deposit) > 0n)
        ? ['depositRead', 'depositDeduct']
        : []),
    ];
    const policies = prepared ?? (await this.policies(access, required)),
      contracts = await this.contracts(
        access,
        input.targets.map((t) => t.contractId),
        policies,
        c,
      );
    if (
      new Set(input.targets.map((t) => t.billId)).size !==
        input.targets.length ||
      new Set(input.payments.map((p) => p.key)).size !==
        input.payments.length ||
      new Set(input.payments.map((p) => p.reference)).size !==
        input.payments.length
    )
      fail('CASHIER_DUPLICATE');
    const summaries = checkoutTotals(input);
    const deposits = new Map<string, bigint>();
    const sources = [];
    for (const t of input.targets) {
      const contract = contracts.get(t.contractId)!;
      if (contract.merchantId !== input.merchantId) fail('CASHIER_MERCHANT');
      const lease = await getLease(c, contract);
      if (lease.status === 'closed') fail('LEASE_CLOSED');
      this.billing.version(lease, t.expectedLeaseVersion);
      const bill = await this.billing.findBill(t.billId, c);
      if (bill.contractId !== contract.id)
        fail('RECORD_NOT_FOUND', 'NOT_FOUND');
      this.billing.version(bill, t.expectedBillVersion);
      if (bill.status !== 'issued' || cents(t.amount) + cents(t.deposit) <= 0n)
        fail('BILLING_NOT_ISSUED');
      if (cents(t.amount) + cents(t.deposit) > BigInt(bill.remainingCents))
        fail('OVERPAYMENT');
      deposits.set(
        t.contractId,
        (deposits.get(t.contractId) ?? 0n) + cents(t.deposit),
      );
      sources.push({
        billId: bill.id,
        number: bill.number,
        contractId: contract.id,
        contractNumber: contract.number,
        remainingCents: bill.remainingCents,
        amountCents: String(cents(t.amount)),
        depositCents: String(cents(t.deposit)),
      });
    }
    for (const [id, total] of deposits)
      if (
        total >
        depositBalance(
          await c
            .repository<Entry>('hylLeaseEntries')
            .findMany({ filter: { contractId: id } }),
        )
      )
        fail('DEPOSIT_OVERDRAW');
    return {
      ...summaries,
      sources,
      merchantId: input.merchantId,
      sourceHash: hash(input),
    };
  }
  async save(access: Access, input: OrderInput, id?: string) {
    const canonical: Checkout = {
      merchantId: input.merchantId,
      date: input.date,
      notes: input.notes,
      targets: input.targets,
      payments: input.payments,
    };
    const policies = await this.policies(access, [
      'cashierCheckout',
      'billingRead',
      'receiptRead',
      'receiptReceive',
      'receiptAllocate',
      ...(input.targets.some((t) => cents(t.deposit) > 0n)
        ? ['depositRead', 'depositDeduct']
        : []),
    ]);
    await this.contracts(
      access,
      input.targets.map((t) => t.contractId),
      policies,
    );
    if (id) await this.guard(access, 'orders', id, 'cashierCheckout');
    return this.atomic(
      access,
      input.requestId,
      { save: id, input },
      input.merchantId,
      async (c) => {
        const preview = await this.preview(access, input, c, policies);
        if (id) {
          const old = await this.record('orders', id, c);
          this.billing.version(old, input.expectedVersion ?? -1);
          if (old.status !== 'draft' || old.merchantId !== input.merchantId)
            fail('BILLING_NOT_DRAFT');
          await c
            .repository('hylCashierMembers')
            .deleteMany({ filter: { recordId: id } });
          await c.repository('hylCashierOrders').updateOne({
            filter: { id },
            values: {
              payload: { input: canonical, preview },
              day: input.date,
              searchText: input.payments.map((p) => p.reference).join(' '),
              version: old.version + 1,
              updatedAt: new Date().toISOString(),
            },
          });
        } else {
          const row = this.base(
            access,
            'SY',
            input.merchantId,
            input.date,
            { input: canonical, preview },
            input.payments.map((p) => p.reference).join(' '),
          );
          await this.hyl.runtime.create(
            'hylCashierOrders',
            this.lifecycleValues(row),
            { actor: { id: access.actor }, transaction: c },
          );
          id = row.id;
        }
        for (const contractId of new Set(
          input.targets.map((t) => t.contractId),
        ))
          await this.member(c, id, contractId, 'contract', contractId);
        await this.audit(c, id, access, 'save', { requestId: input.requestId });
        return this.record('orders', id, c);
      },
    );
  }
  async post(access: Access, id: string, body: Operation) {
    const old = await this.guard(access, 'orders', id, 'cashierCheckout'),
      input = old.payload.input as Checkout;
    const names = [
      'cashierCheckout',
      'billingRead',
      'receiptRead',
      'receiptReceive',
      'receiptAllocate',
      ...(input.targets.some((t) => cents(t.deposit) > 0n)
        ? ['depositRead', 'depositDeduct']
        : []),
    ];
    const policies = await this.policies(access, names);
    await this.contracts(
      access,
      input.targets.map((t) => t.contractId),
      policies,
    );
    return this.atomic(
      access,
      body.requestId,
      { post: id, body },
      old.merchantId,
      async (c) => {
        const order = await this.record('orders', id, c);
        this.billing.version(order, body.expectedVersion);
        if (order.status !== 'draft') fail('BILLING_NOT_DRAFT');
        await this.preview(access, input, c, policies);
        const tx = new BillingService(this.hyl, {
          connection: c,
          policies,
          actor: access.actor,
          merchantId: old.merchantId,
        });
        for (const t of input.targets)
          if (cents(t.deposit) > 0n) {
            const lease = await getLease(
              c,
              (
                await this.contracts(
                  access,
                  [t.contractId],
                  new Map([['billingRead', policies.get('billingRead')!]]),
                  c,
                )
              ).get(t.contractId)!,
            );
            const bill = await tx.findBill(t.billId, c);
            await tx.billAction(access, t.billId, 'applyDeposit', {
              requestId: uid(body.requestId, 'dep' + t.billId),
              expectedVersion: bill.version,
              expectedLeaseVersion: lease.version,
              amount: t.deposit,
              date: input.date,
              reference: '',
              reason: body.reason,
              evidence: body.evidence,
              allocations: [],
            });
          }
        const left = new Map(
          input.targets.map((t) => [t.billId, cents(t.amount)]),
        );
        for (const p of input.payments) {
          await this.reserve(c, old.merchantId, p.reference, id);
          for (const split of p.splits) {
            const contract = (
              await this.contracts(
                access,
                [split.contractId],
                new Map([['billingRead', policies.get('billingRead')!]]),
                c,
              )
            ).get(split.contractId)!;
            const receipt = await tx.recordReceipt(access, {
              requestId: uid(body.requestId, p.key + split.contractId),
              contractId: contract.id,
              expectedLeaseVersion: (await getLease(c, contract)).version,
              date: input.date,
              amount: split.amount,
              method: p.method,
              reference: randomUUID(),
              evidence: p.evidence,
              notes: `${order.number} ${p.reference}`,
            });
            await c.repository('hylReceipts').updateOne({
              filter: { id: receipt.id },
              values: {
                payload: {
                  ...receipt.payload,
                  cashierOrderId: id,
                  originalReference: p.reference,
                },
              },
            });
            await this.member(c, id, contract.id, 'receipt', receipt.id);
            let available = cents(split.amount);
            const allocations = [];
            for (const t of input.targets.filter(
              (t) => t.contractId === contract.id,
            )) {
              const amount =
                left.get(t.billId)! < available
                  ? left.get(t.billId)!
                  : available;
              if (amount <= 0n) continue;
              allocations.push({
                billId: t.billId,
                expectedBillVersion: (await tx.findBill(t.billId, c)).version,
                amount: money(amount),
              });
              left.set(t.billId, left.get(t.billId)! - amount);
              available -= amount;
            }
            if (allocations.length)
              await tx.operateReceipt(access, receipt.id, 'allocate', {
                requestId: uid(body.requestId, receipt.id),
                expectedVersion: receipt.version,
                amount: '0',
                reference: '',
                reason: body.reason,
                evidence: p.evidence,
                allocations,
              });
          }
        }
        for (const t of input.targets)
          await this.member(c, id, t.contractId, 'bill', t.billId);
        await this.hyl.runtime.fire('hylCashierOrders', id, 'post', {
          actor: { id: access.actor },
          transaction: c,
          expect: { version: order.lifecycleVersion },
        });
        await c.repository('hylCashierOrders').updateOne({
          filter: { id },
          values: {
            payload: {
              ...order.payload,
              postedBy: access.actor,
              postedAt: new Date().toISOString(),
              evidence: body.evidence,
            },
            updatedAt: new Date().toISOString(),
          },
        });
        const { refreshOrders } = await import('./projection.js');
        for (const m of (await this.members(id, c)).filter(
          (m) => m.kind === 'receipt',
        ))
          await refreshOrders(c, m.sourceId);
        await this.audit(c, id, access, 'post', { requestId: body.requestId });
        return this.record('orders', id, c);
      },
    );
  }
  async voidOrder(access: Access, id: string, body: Operation) {
    const order = await this.guard(access, 'orders', id, 'cashierReverse');
    const policies = await this.policies(access, [
      'cashierReverse',
      'receiptRead',
      'receiptReverse',
    ]);
    await this.contracts(
      access,
      (await this.members(id)).map((m) => m.contractId),
      policies,
    );
    return this.atomic(
      access,
      body.requestId,
      { void: id, body },
      order.merchantId,
      async (c) => {
        const row = await this.record('orders', id, c);
        this.billing.version(row, body.expectedVersion);
        const tx = new BillingService(this.hyl, {
          connection: c,
          policies,
          actor: access.actor,
          merchantId: row.merchantId,
        });
        if (
          (row.payload.input as Checkout).targets.some(
            (t) => cents(t.deposit) > 0n,
          ) &&
          row.status === 'posted'
        )
          fail('BILLING_HAS_ALLOCATIONS');
        for (const m of (await this.members(id, c)).filter(
          (m) => m.kind === 'receipt',
        )) {
          const r = await tx.findReceipt(m.sourceId, c);
          await tx.operateReceipt(access, r.id, 'void', {
            ...body,
            expectedVersion: r.version,
            reference: '',
            amount: '0',
            allocations: [],
          });
        }
        await this.hyl.runtime.fire('hylCashierOrders', id, 'void', {
          actor: { id: access.actor },
          transaction: c,
          expect: { version: row.lifecycleVersion },
        });
        await c.repository('hylCashierOrders').updateOne({
          filter: { id },
          values: {
            version: (await this.record('orders', id, c)).version + 1,
            payload: {
              ...row.payload,
              voidReason: body.reason,
              voidEvidence: body.evidence,
            },
          },
        });
        await this.audit(c, id, access, 'void', {
          reason: body.reason,
          evidence: body.evidence,
        });
        return this.record('orders', id, c);
      },
    );
  }
  async detail(access: Access, kind: Kind, id: string) {
    if (kind === 'reconciliations') return this.reportDetail(access, id);
    const row = await this.guard(access, kind, id);
    const members = await this.members(id);
    const sources = [];
    for (const m of members) {
      const table =
        m.kind === 'receipt'
          ? 'hylReceipts'
          : m.kind === 'bill'
            ? 'hylBills'
            : 'hylContracts';
      const source = await this.hyl.db
        .repository<{ id: string; number: string }>(table)
        .findOne({ filter: { id: m.sourceId } });
      sources.push({ ...m, number: source?.number ?? m.sourceId });
    }
    const events = await this.hyl.db
      .repository('hylEvents')
      .findMany({ filter: { recordId: id } });
    const contracts = await this.contracts(
      access,
      members.map((m) => m.contractId),
      await this.policies(access, ['cashierRead', 'receiptRead']),
    );
    const merchant = await this.hyl.db
      .repository<Row>('hylMerchants')
      .findOne({ filter: { id: row.merchantId } });
    const allowed = [];
    for (const action of actions) {
      try {
        await this.contracts(
          access,
          [...contracts.keys()],
          await this.policies(
            access,
            action === 'cashierReverse'
              ? [action, 'receiptRead', 'receiptReverse']
              : action === 'cashierRefund'
                ? [action, 'receiptRead', 'receiptRefund']
                : action === 'cashierCheckout'
                  ? [
                      action,
                      'billingRead',
                      'receiptRead',
                      'receiptReceive',
                      'receiptAllocate',
                    ]
                  : [action],
          ),
        );
        allowed.push(action);
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
      }
    }
    const closed = (
      await Promise.all(
        [...contracts.values()].map((r) =>
          getLease(this.hyl.db.connection(), r),
        ),
      )
    ).some((l) => l.status === 'closed');
    return {
      ...row,
      closed,
      merchantName: merchant?.name ?? '',
      members: sources,
      events: events.map((e) => e.payload),
      contracts: [...contracts.values()].map((r) => ({
        id: r.id,
        number: r.number,
      })),
      allowedActions: allowed,
    };
  }
  async list(access: Access, kind: Kind, input: ListInput) {
    const action =
      kind === 'reconciliations' ? 'cashierReconcileRead' : 'cashierRead';
    const visible = await this.visible(access, action);
    const readable =
      kind === 'reconciliations'
        ? visible
        : await this.visible(access, 'receiptRead');
    if (kind === 'reconciliations' && input.scope === 'authorized')
      await this.hyl.policy(access, 'contracts', 'cashierReconcileAll');
    let billingVisible = new Set<string>();
    if (kind !== 'reconciliations') {
      try {
        billingVisible = await this.visible(access, 'billingRead');
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
      }
    }
    const members = await this.hyl.db
      .repository<Member>('hylCashierMembers')
      .findMany();
    const grouped = new Map<string, Member[]>();
    for (const m of members)
      grouped.set(m.recordId, [...(grouped.get(m.recordId) ?? []), m]);
    let canAll = false;
    if (kind === 'reconciliations') {
      try {
        await this.hyl.policy(access, 'contracts', 'cashierReconcileAll');
        canAll = true;
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
      }
    }
    const permitted = [...grouped]
      .filter(([, ms]) =>
        ms.every(
          (m) =>
            visible.has(m.contractId) &&
            readable.has(m.contractId) &&
            (m.kind !== 'bill' || billingVisible.has(m.contractId)),
        ),
      )
      .map(([id]) => id);
    if (kind === 'reconciliations' && !canAll) {
      const snapshots = await this.hyl.db
        .repository<CashierRecord>(tables.reconciliations)
        .findMany();
      const forbidden = new Set(
        snapshots
          .filter((r) => r.payload.scope === 'authorized')
          .map((r) => r.id),
      );
      for (let i = permitted.length - 1; i >= 0; i--)
        if (forbidden.has(permitted[i])) permitted.splice(i, 1);
    }
    const merchants = await this.hyl.db
      .repository<Row>('hylMerchants')
      .findMany();
    const searched = merchants
      .filter((m) =>
        String(m.name)
          .toLocaleLowerCase()
          .includes(input.q.toLocaleLowerCase()),
      )
      .map((m) => m.id);
    let methodIds: string[] | undefined;
    if (input.method) {
      const candidates = await this.hyl.db
        .repository<CashierRecord>(tables[kind])
        .findMany({
          filter: buildFilter((f) =>
            permitted.length
              ? f.or(permitted.map((id) => f.string('id').eq(id)))
              : f.string('id').eq('__none__'),
          ),
        });
      methodIds = candidates
        .filter((r) =>
          JSON.stringify(r.payload).includes(`"method":"${input.method}"`),
        )
        .map((r) => r.id);
    }
    const filter = buildFilter((f) =>
      f.and([
        permitted.length
          ? f.or(permitted.map((id) => f.string('id').eq(id)))
          : f.string('id').eq('__none__'),
        ...(input.merchantId
          ? [f.string('merchantId').eq(input.merchantId)]
          : []),
        ...(input.q
          ? [
              f.or([
                f.string('number').includes(input.q),
                f.string('searchText').includes(input.q),
                ...searched.map((id) => f.string('merchantId').eq(id)),
              ]),
            ]
          : []),
        ...(input.status && input.status !== 'hasLateEvents'
          ? [f.string('status').eq(input.status)]
          : []),
        ...(input.from
          ? [
              f
                .date('createdAt')
                .notBefore(
                  new Date(input.from + 'T00:00:00+08:00').toISOString(),
                ),
            ]
          : []),
        ...(input.to
          ? [
              f
                .date('createdAt')
                .notAfter(
                  new Date(
                    new Date(input.to + 'T00:00:00+08:00').getTime() +
                      86400000 -
                      1,
                  ).toISOString(),
                ),
            ]
          : []),
        ...(kind === 'reconciliations' && input.scope === 'own'
          ? [f.string('actor').eq(access.actor)]
          : []),
        ...(methodIds
          ? [
              methodIds.length
                ? f.or(methodIds.map((id) => f.string('id').eq(id)))
                : f.string('id').eq('__none__'),
            ]
          : []),
      ]),
    );
    const repo = this.hyl.db.repository<CashierRecord>(tables[kind]);
    const rows = await repo.findMany({
      filter,
      limit: input.pageSize,
      offset: (input.page - 1) * input.pageSize,
      sort: (s) => [
        input.order === 'asc'
          ? s.field(input.sort).asc()
          : s.field(input.sort).desc(),
        s.field('id').asc(),
      ],
    });
    const data = [];
    for (const row of rows) {
      const m = await this.hyl.db
        .repository<Row>('hylMerchants')
        .findOne({ filter: { id: row.merchantId } });
      data.push({ ...row, merchantName: m?.name ?? '' });
    }
    return {
      data,
      meta: {
        total: await repo.count({ filter }),
        page: input.page,
        pageSize: input.pageSize,
      },
    };
  }
  refundPreview = refundPreview;
  createRefund = createRefund;
  reverseRefund = reverseRefund;
  reportPreview = reportPreview;
  confirmReport = confirmReport;
  reportDetail = reportDetail;
}
