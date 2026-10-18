import { apportion } from './calculation.js';
import { CashierService } from '../cashier/service.js';
import { randomUUID } from 'node:crypto';
import type { DatabaseConnection, RepositoryPolicy } from '@nocobase/db';
import { ApiError } from '@nocobase/app-server/router';
import { buildFilter } from '@nocobase/repository-input';
import type { Access, HylService } from '../hyl/service.js';
import { fail } from '../hyl/service.js';
import type { Row } from '../hyl/schema.js';
import { cents } from '../hyl/calculation.js';
import { getLease } from '../leases/model.js';
import type { Bill } from '../billing/model.js';
import { assertCashReference } from '../billing/accounting.js';
import { fingerprint, snapshot, projectSource } from './projection.js';
import {
  splitActions,
  type Rule,
  type RuleInput,
  type RuleValues,
  type Order,
  type ActionInput,
  type SourceInput,
  type ListInput,
  type Transfer,
} from './model.js';
export class SplitService {
  constructor(readonly hyl: HylService) {}
  async contracts(
    access: Access,
    id: string,
    actions: string[],
    c = this.hyl.db.connection(),
    policies?: Map<string, RepositoryPolicy>,
  ) {
    let row: Row | undefined;
    for (const action of new Set(actions))
      row = await this.hyl.get(
        access,
        'contracts',
        id,
        action,
        c,
        policies?.get(action) ??
          (await this.hyl.policy(access, 'contracts', action)),
      );
    return row!;
  }
  async prepare(access: Access, id: string, actions: string[]) {
    const policies = new Map<string, RepositoryPolicy>();
    for (const a of new Set(actions))
      policies.set(a, await this.hyl.policy(access, 'contracts', a));
    const contract = await this.contracts(
      access,
      id,
      actions,
      undefined,
      policies,
    );
    return { contract, policies };
  }
  async guard(access: Access, id: string, action = 'splitRead') {
    const row = await this.hyl.db
      .repository<Order>('hylSplitOrders')
      .findOne({ filter: { id } });
    if (!row) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    await this.prepare(access, row.contractId, [
      action,
      'splitRead',
      'read',
      ...(row.sourceKind === 'bill' ? ['billingRead', 'receiptRead'] : []),
    ]);
    if (row.sourceKind === 'settlement')
      await this.hyl.get(access, 'settlements', row.sourceId, 'read');
    return row;
  }
  async atomic<T>(
    access: Access,
    id: string,
    body: { requestId: string },
    intent: unknown,
    fn: (c: DatabaseConnection) => Promise<T>,
  ) {
    const contract = await this.hyl.db
      .repository<Row>('hylContracts')
      .findOne({ filter: { id } });
    if (!contract) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    const hash = fingerprint({ actor: access.actor, intent });
    return this.hyl.db.transaction(async (c) => {
      await this.hyl.lockMerchant(c, contract.merchantId);
      const old = await c
        .repository<{
          id: string;
          actor: string;
          hash: string;
          payload: { result: T };
        }>('hylSplitOperations')
        .findOne({ filter: { id: body.requestId } });
      if (old) {
        if (old.actor !== access.actor || old.hash !== hash)
          fail('IDEMPOTENCY_CONFLICT', 'ABORTED');
        return old.payload.result;
      }
      if ((await getLease(c, contract)).status === 'closed')
        fail('LEASE_CLOSED');
      const result = await fn(c);
      await c.repository('hylSplitOperations').createOne({
        values: {
          id: body.requestId,
          actor: access.actor,
          hash,
          payload: { result },
          createdAt: new Date().toISOString(),
        },
      });
      return result;
    });
  }
  async validateRule(c: DatabaseConnection, contract: Row, input: RuleValues) {
    if (input.copyFromRuleId) {
      const origin = await c
        .repository<Rule>('hylSplitRules')
        .findOne({ filter: { id: input.copyFromRuleId } });
      if (
        !origin ||
        (await getLease(c, contract)).payload.predecessorId !==
          origin.contractId
      )
        fail('SPLIT_SOURCE_INELIGIBLE');
    }
    const r = input.recipients;
    if (
      new Set(r.map((r) => r.key)).size !== r.length ||
      new Set(input.billFeeTypes).size !== input.billFeeTypes.length ||
      r.filter((r) => r.kind === 'project').length !== 1 ||
      r.some((r) => cents(r.rate) <= 0n || cents(r.rate) > 10000n) ||
      r.reduce((n, r) => n + cents(r.rate), 0n) !== 10000n
    )
      fail('SPLIT_RATE_TOTAL', 'INVALID_ARGUMENT');
    const start = String(contract.payload.start),
      end = String(contract.payload.end),
      day = input.effectiveFrom;
    if (
      day < start ||
      day > end ||
      (day !== start &&
        !(
          (contract.payload.cycle === 'month' && day.endsWith('-01')) ||
          (contract.payload.cycle !== 'month' && /-(01|16)$/.test(day))
        ))
    )
      fail('INVALID_PERIOD');
    const history = await c.repository<Rule>('hylSplitRules').findMany({
      filter: { contractId: contract.id },
      sort: (s) => [s.field('effectiveFrom').asc()],
    });
    if (history.some((r) => r.effectiveFrom >= day))
      fail('SPLIT_SOURCE_CHANGED', 'ABORTED');
    const bills = await c
      .repository<Bill>('hylBills')
      .findMany({ filter: { contractId: contract.id } });
    const settlements = await c
      .repository<Row>('hylSettlements')
      .findMany({ filter: { merchantId: contract.merchantId } });
    if (
      bills.some((b) => b.start >= day && BigInt(b.allocatedCents) > 0n) ||
      settlements.some(
        (s) =>
          s.payload.contractId === contract.id &&
          String(s.payload.start) >= day &&
          ['payable', 'partial', 'paid', 'due', 'settled'].includes(s.status),
      )
    )
      fail('SPLIT_SOURCE_INELIGIBLE');
    return {
      sample: Object.fromEntries(
        Object.entries(
          apportion(
            10000n,
            input.recipients.map((r) => ({
              key: r.key,
              weight: cents(r.rate),
            })),
          ),
        ).map(([k, v]) => [k, String(v)]),
      ),
      version: history.at(-1)?.version ?? 0,
      contract: { id: contract.id, number: contract.number, start, end },
      values: input,
    };
  }
  async renewals(access: Access, id: string, input: ListInput) {
    await this.prepare(access, id, ['read', 'splitRead']);
    const allowed: Row[] = [];
    for (const lease of await this.hyl.db
      .repository<{
        id: string;
        status: string;
        payload: Record<string, unknown>;
      }>('hylLeases')
      .findMany()) {
      if (lease.status === 'closed' || lease.payload.predecessorId !== id)
        continue;
      try {
        const { contract } = await this.prepare(access, lease.id, [
          'read',
          'splitConfigure',
        ]);
        if (!input.q || contract.number.includes(input.q))
          allowed.push(contract);
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
      }
    }
    allowed.sort((a, b) => a.number.localeCompare(b.number));
    return {
      data: allowed.slice((input.page - 1) * 20, input.page * 20),
      meta: { page: input.page, pageSize: 20, total: allowed.length },
    };
  }
  async previewRule(access: Access, id: string, input: RuleValues) {
    if (input.copyFromRuleId)
      await this.ruleDetail(access, input.copyFromRuleId);
    const { contract } = await this.prepare(access, id, [
      'splitConfigure',
      'read',
    ]);
    return this.validateRule(this.hyl.db.connection(), contract, input);
  }
  async saveRule(access: Access, id: string, input: RuleInput) {
    if (input.copyFromRuleId)
      await this.ruleDetail(access, input.copyFromRuleId);
    const { contract } = await this.prepare(access, id, [
      'splitConfigure',
      'read',
    ]);
    return this.atomic(
      access,
      id,
      input,
      { saveRule: id, input },
      async (c) => {
        const { version } = await this.validateRule(c, contract, input);
        if (version !== input.expectedVersion)
          fail('VERSION_CONFLICT', 'ABORTED');
        const {
          copyFromRuleId: _copyFromRuleId,
          requestId: _requestId,
          expectedVersion: _expectedVersion,
          ...values
        } = input;
        const now = new Date().toISOString(),
          merchant = await c
            .repository<Row>('hylMerchants')
            .findOne({ filter: { id: contract.merchantId } });
        const rule: Rule = {
          id: randomUUID(),
          contractId: id,
          merchantId: contract.merchantId,
          version: version + 1,
          effectiveFrom: input.effectiveFrom,
          enabled: input.enabled,
          payload: values,
          actor: access.actor,
          createdAt: now,
          updatedAt: now,
          searchText: `${contract.number} ${merchant?.name ?? ''}`,
        };
        await c.repository<Rule>('hylSplitRules').createOne({ values: rule });
        return rule;
      },
    );
  }
  async ruleDetail(access: Access, id: string) {
    const row = await this.hyl.db
      .repository<Rule>('hylSplitRules')
      .findOne({ filter: { id } });
    if (!row) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    const { contract } = await this.prepare(access, row.contractId, [
      'splitRead',
      'read',
    ]);
    const closed =
      (await getLease(this.hyl.db.connection(), contract)).status === 'closed';
    const allowedActions: string[] = [];
    try {
      await this.prepare(access, row.contractId, ['splitConfigure']);
      if (!closed) allowedActions.push('splitConfigure');
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
    }
    const merchant = await this.hyl.db
      .repository<Row>('hylMerchants')
      .findOne({ filter: { id: contract.merchantId } });
    return {
      ...row,
      closed,
      allowedActions,
      contractNumber: contract.number,
      merchantName: merchant?.name ?? '',
    };
  }
  async list(access: Access, kind: 'orders' | 'rules', input: ListInput) {
    const policy = await this.hyl.policy(access, 'contracts', 'splitRead'),
      rows = await this.hyl.db
        .repository<Row>('hylContracts')
        .withPolicy(policy)
        .findMany();
    let cashierBills: Set<string> | undefined;
    if (input.cashierOrderId) {
      const cashier = new CashierService(this.hyl);
      await cashier.guard(access, 'orders', input.cashierOrderId);
      cashierBills = new Set(
        (await cashier.members(input.cashierOrderId))
          .filter((m) => m.kind === 'bill')
          .map((m) => m.sourceId),
      );
    }
    const visible: string[] = [];
    for (const r of rows) {
      try {
        await this.prepare(access, String(r.id), ['read']);
        visible.push(String(r.id));
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
      }
    }
    const table = kind === 'orders' ? 'hylSplitOrders' : 'hylSplitRules',
      all = await this.hyl.db.repository<Order | Rule>(table).findMany();
    const ids: string[] = [];
    for (const row of all) {
      if (
        cashierBills &&
        (!(row as Order).sourceId || !cashierBills.has((row as Order).sourceId))
      )
        continue;
      if (!visible.includes(String(row.contractId))) continue;
      const day =
        kind === 'rules'
          ? (row as Rule).effectiveFrom
          : new Intl.DateTimeFormat('en-CA', {
              timeZone: 'Asia/Shanghai',
            }).format(new Date(row.createdAt));
      if (
        (input.from && day < input.from) ||
        (input.to && day > input.to) ||
        (kind === 'rules' &&
          input.enabled &&
          String((row as Rule).enabled) !== input.enabled)
      )
        continue;
      if (kind === 'orders') {
        try {
          await this.guard(access, String(row.id));
        } catch (e) {
          if (e instanceof ApiError) continue;
          throw e;
        }
      }
      ids.push(String(row.id));
    }
    const filter = buildFilter((f) =>
      f.and([
        ids.length
          ? f.or(ids.map((id) => f.string('id').eq(id)))
          : f.string('id').eq('__none__'),
        ...(input.q
          ? [
              f.or([
                f
                  .string(kind === 'orders' ? 'number' : 'searchText')
                  .includes(input.q),
                f.string('searchText').includes(input.q),
              ]),
            ]
          : []),
        ...(input.contractId
          ? [f.string('contractId').eq(input.contractId)]
          : []),
        ...(kind === 'orders' && input.sourceId
          ? [f.string('sourceId').eq(input.sourceId)]
          : []),
        ...(kind === 'orders' && input.sourceKind
          ? [f.string('sourceKind').eq(input.sourceKind)]
          : []),
        ...(kind === 'orders' && input.status
          ? [f.string('status').eq(input.status)]
          : []),
      ]),
    );
    const column = input.orderBy.replace(/^-/, ''),
      allowed =
        kind === 'rules'
          ? ['updatedAt', 'createdAt', 'effectiveFrom', 'version']
          : [
              'updatedAt',
              'createdAt',
              'sourceFundsCents',
              'netPaidCents',
              'remainingCents',
              'recoveryCents',
            ];
    if (!allowed.includes(column)) fail('INVALID_INPUT', 'INVALID_ARGUMENT');
    const repo = this.hyl.db.repository<Order | Rule>(table),
      data = await repo.findMany({
        filter,
        limit: input.pageSize,
        offset: (input.page - 1) * input.pageSize,
        sort: (s) => [
          input.orderBy.startsWith('-')
            ? s.field(column).desc()
            : s.field(column).asc(),
          s.field('id').asc(),
        ],
      });
    return {
      data:
        kind === 'rules'
          ? await Promise.all(data.map((r) => this.ruleDetail(access, r.id)))
          : data,
      meta: {
        page: input.page,
        pageSize: input.pageSize,
        total: await repo.count({ filter }),
      },
    };
  }
  async detail(
    access: Access,
    id: string,
    pages: Record<string, number | string> = {},
  ) {
    const row = await this.guard(access, id),
      c = this.hyl.db.connection(),
      contract = await this.hyl.db
        .repository<Row>('hylContracts')
        .findOne({ filter: { id: row.contractId } });
    const allowedActions: string[] = [];
    for (const a of splitActions) {
      try {
        await this.prepare(access, row.contractId, [a]);
        if (a === 'splitExecute' && row.sourceKind === 'settlement') {
          try {
            await this.hyl.get(access, 'settlements', row.sourceId, 'pay');
            allowedActions.push('merchantPay');
          } catch (e) {
            if (!(e instanceof ApiError)) throw e;
          }
        }
        allowedActions.push(a);
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
      }
    }
    const children = async (table: string, key: string) => {
      const page = Number(pages[key] ?? 1);
      const orderBy = String(pages[key + 'Order'] ?? '-createdAt'),
        column = orderBy.replace(/^-/, '');
      const repo = c.repository(table),
        filter = { orderId: id };
      if (key === 'attempts' && column === 'amountCents') {
        const rows = await c
          .repository<{
            id: string;
            orderId: string;
            payload: { amount: string };
          }>(table)
          .findMany({ filter });
        rows.sort((a, b) => {
          const x = cents(a.payload.amount),
            y = cents(b.payload.amount);
          return x === y
            ? a.id.localeCompare(b.id)
            : (x < y ? -1 : 1) * (orderBy.startsWith('-') ? -1 : 1);
        });
        return {
          data: rows.slice((page - 1) * 20, page * 20),
          meta: { page, pageSize: 20, total: rows.length },
        };
      }
      return {
        data: await repo.findMany({
          filter,
          limit: 20,
          offset: (page - 1) * 20,
          sort: (s) => [
            orderBy.startsWith('-')
              ? s.field(column).desc()
              : s.field(column).asc(),
            s.field('id').desc(),
          ],
        }),
        meta: { page, pageSize: 20, total: await repo.count({ filter }) },
      };
    };
    const merchantPayments =
      row.sourceKind === 'settlement'
        ? await c
            .repository<{
              id: string;
              settlementId: string;
              reference: string;
              payload: Record<string, unknown>;
            }>('hylPayments')
            .findMany({ filter: { settlementId: row.sourceId } })
        : [];
    const computed = await snapshot(c, row, row);
    const memoryPage = <T>(items: T[], key: string) => {
      const page = Number(pages[key] ?? 1);
      return {
        data: items.slice((page - 1) * 20, page * 20),
        meta: { page, pageSize: 20, total: items.length },
      };
    };
    return {
      ...row,
      sourceRows: memoryPage(
        computed?.sources ?? row.payload.snapshot.sources,
        'sources',
      ),
      payments: memoryPage(
        merchantPayments
          .map((p) => ({
            ...p,
            createdAt: String(p.payload.date),
            kind: 'merchant',
          }))
          .sort(
            (a, b) =>
              b.createdAt.localeCompare(a.createdAt) ||
              a.id.localeCompare(b.id),
          ),
        'payments',
      ),
      payload: {
        ...row.payload,
        snapshot: {
          ...row.payload.snapshot,
          operatingComposition: computed?.operatingComposition,
          feeComposition: computed?.feeComposition,
          excludedDepositCents: computed?.excludedDepositCents,
        },
      },
      closed: (await getLease(c, contract!)).status === 'closed',
      allowedActions,
      revisions: await children('hylSplitRevisions', 'revisions'),
      transfers: await children('hylSplitTransfers', 'transfers'),
      attempts: await children('hylSplitAttempts', 'attempts'),
    };
  }
  async preview(access: Access, input: SourceInput) {
    const c = this.hyl.db.connection(),
      s = await snapshot(c, input);
    if (!s) fail('SPLIT_RULE_MISSING');
    await this.prepare(access, s.contractId, [
      'splitRead',
      'read',
      ...(input.sourceKind === 'bill' ? ['billingRead', 'receiptRead'] : []),
    ]);
    if (input.sourceKind === 'settlement')
      await this.hyl.get(access, 'settlements', input.sourceId, 'read');
    return s;
  }
  async backfill(
    access: Access,
    input: SourceInput & {
      requestId: string;
      sourceHash: string;
      reason: string;
    },
  ) {
    const s = await this.preview(access, input);
    await this.prepare(access, s.contractId, ['splitConfigure']);
    return this.atomic(
      access,
      s.contractId,
      input,
      { backfill: input },
      async (c) => {
        if (
          await c.repository('hylSplitOrders').exists({
            filter: {
              sourceKind: input.sourceKind,
              sourceId: input.sourceId,
            },
          })
        )
          fail('SPLIT_DUPLICATE_REFERENCE', 'ALREADY_EXISTS');
        const latest = await snapshot(c, input);
        if (latest?.sourceHash !== input.sourceHash)
          fail('SPLIT_SOURCE_CHANGED', 'ABORTED');
        if (
          input.sourceKind === 'settlement' &&
          (await c
            .repository('hylPayments')
            .exists({ filter: { settlementId: input.sourceId } }))
        )
          fail('SPLIT_SOURCE_INELIGIBLE');
        return projectSource(c, this.hyl, input, access.actor, true);
      },
    );
  }
  async act(access: Access, id: string, action: string, body: ActionInput) {
    const right =
        action === 'execute'
          ? 'splitExecute'
          : ['recover', 'reverse'].includes(action)
            ? 'splitRecover'
            : 'splitReview',
      original = await this.guard(access, id, right);
    if (action === 'reverse')
      await this.prepare(access, original.contractId, ['splitExecute']);
    const merchantPolicy =
      original.sourceKind === 'settlement' &&
      action === 'execute' &&
      body.recipientKey === 'merchant'
        ? await this.hyl.policy(access, 'merchants', 'read')
        : undefined;
    const payPolicy =
      original.sourceKind === 'settlement' &&
      action === 'execute' &&
      body.recipientKey === 'merchant'
        ? await this.hyl.policy(access, 'settlements', 'pay')
        : undefined;
    if (payPolicy)
      await this.hyl.get(
        access,
        'settlements',
        original.sourceId,
        'pay',
        undefined,
        payPolicy,
      );
    return this.atomic(
      access,
      original.contractId,
      body,
      { id, action, body },
      async (c) => {
        const row = (await c
          .repository<Order>('hylSplitOrders')
          .findOne({ filter: { id } }))!;
        if (row.version !== body.expectedVersion)
          fail('VERSION_CONFLICT', 'ABORTED');
        const fresh = await snapshot(c, row, row);
        if (
          !fresh ||
          fresh.sourceHash !== row.sourceHash ||
          (body.sourceHash && body.sourceHash !== fresh.sourceHash)
        )
          fail('SPLIT_SOURCE_CHANGED', 'ABORTED');
        if (row.status === 'cancelled') fail('SPLIT_SOURCE_INELIGIBLE');
        if (action === 'review') {
          if (!body.evidence.trim())
            fail('PAYMENT_REQUIRED', 'INVALID_ARGUMENT');
          await c.repository('hylSplitOrders').updateOne({
            filter: { id },
            values: {
              payload: {
                ...row.payload,
                reviewedHash: row.sourceHash,
                history: [
                  ...(row.payload.history ?? []),
                  {
                    action,
                    actor: access.actor,
                    at: new Date().toISOString(),
                    ...body,
                  },
                ],
              },
            },
          });
        } else if (action === 'cancel') {
          if (!body.reason || !body.evidence)
            fail('REASON_REQUIRED', 'INVALID_ARGUMENT');
          if (
            BigInt(fresh.sourceFundsCents) > 0n ||
            BigInt(fresh.grossPaidCents) > 0n ||
            BigInt(fresh.recoveredCents) > 0n
          )
            fail('SPLIT_SOURCE_INELIGIBLE');
          await this.hyl.runtime.fire('hylSplitOrders', id, 'refresh', {
            actor: { id: access.actor },
            transaction: c,
            expect: { version: row.lifecycleVersion },
            input: { state: 'cancelled' },
          });
          await c.repository('hylSplitOrders').updateOne({
            filter: { id },
            values: {
              version: row.version + 1,
              payload: {
                ...row.payload,
                history: [
                  ...(row.payload.history ?? []),
                  {
                    action,
                    ...body,
                    actor: access.actor,
                    at: new Date().toISOString(),
                  },
                ],
              },
            },
          });
          return c
            .repository<Order>('hylSplitOrders')
            .findOne({ filter: { id } });
        } else if (action === 'reverse') {
          if (!body.reason || !body.evidence || !body.transferId)
            fail('REASON_REQUIRED', 'INVALID_ARGUMENT');
          const transfer = await c
            .repository<Transfer>('hylSplitTransfers')
            .findOne({ filter: { id: body.transferId, orderId: id } });
          if (!transfer || !['partnerPay', 'recover'].includes(transfer.kind))
            fail('SPLIT_SOURCE_INELIGIBLE');
          const all = await c
            .repository<Transfer>('hylSplitTransfers')
            .findMany({ filter: { orderId: id } });
          if (all.some((t) => t.sourceTransferId === transfer.id))
            fail('SPLIT_SOURCE_INELIGIBLE');
          if (
            transfer.kind === 'partnerPay' &&
            all.some(
              (t) =>
                t.recipientKey === transfer.recipientKey &&
                t.kind === 'recover' &&
                !all.some(
                  (x) => x.kind === 'reverse' && x.sourceTransferId === t.id,
                ),
            )
          )
            fail('SPLIT_RECOVERY_REQUIRED');
          await c.repository<Transfer>('hylSplitTransfers').createOne({
            values: {
              id: randomUUID(),
              orderId: id,
              contractId: row.contractId,
              merchantId: row.merchantId,
              recipientKey: transfer.recipientKey,
              kind: 'reverse',
              amountCents: transfer.amountCents,
              reference: null,
              sourceTransferId: transfer.id,
              payload: {
                ...body,
                method: transfer.payload.method,
                actor: access.actor,
                originalKind: transfer.kind,
              },
              createdAt: new Date().toISOString(),
            },
          });
        } else if (action === 'execute' || action === 'recover') {
          if (row.payload.reviewedHash !== row.sourceHash)
            fail('SPLIT_NOT_REVIEWED');
          if (BigInt(fresh.fundingGapCents) > 0n) fail('SPLIT_INSUFFICIENT');
          const line = fresh.lines.find((l) => l.key === body.recipientKey);
          if (
            !line ||
            !['merchant', 'partner'].includes(line.kind) ||
            cents(body.amount) <= 0n
          )
            fail('SPLIT_SOURCE_INELIGIBLE');
          if (action === 'recover' && line.kind !== 'partner')
            fail('SPLIT_SOURCE_INELIGIBLE');
          if (
            cents(body.amount) >
            BigInt(
              action === 'recover' ? line.recoveryCents : line.remainingCents,
            )
          )
            fail('OVERPAYMENT');
          if (!body.date) fail('PAYMENT_REQUIRED', 'INVALID_ARGUMENT');
          if (action === 'execute' && !body.result)
            fail('INVALID_INPUT', 'INVALID_ARGUMENT');
          if (action === 'execute' && body.result === 'failed') {
            if (!body.failureReason.trim())
              fail('REASON_REQUIRED', 'INVALID_ARGUMENT');
            await c.repository('hylSplitAttempts').createOne({
              values: {
                id: randomUUID(),
                orderId: id,
                recipientKey: line.key,
                status: 'failed',
                payload: { ...body, actor: access.actor },
                createdAt: new Date().toISOString(),
              },
            });
            return row;
          }
          if (
            !body.reference ||
            !body.evidence ||
            (action === 'recover' && !body.reason)
          )
            fail('PAYMENT_REQUIRED', 'INVALID_ARGUMENT');
          await assertCashReference(c, row.merchantId, body.reference);
          if (line.kind === 'merchant') {
            if (body.expectedSettlementVersion === undefined)
              fail('VERSION_CONFLICT', 'ABORTED');
            await this.hyl.act(
              access,
              'settlements',
              row.sourceId,
              'pay',
              {
                expectedVersion: body.expectedSettlementVersion,
                amount: body.amount,
                date: body.date,
                reference: body.reference,
                method: body.method,
                evidence: body.evidence,
                reason: body.reason,
                notes: body.notes,
                confirmation: 'offline',
                confirmedBy: access.actor,
              },
              {
                connection: c,
                policy: payPolicy!,
                merchantPolicy: merchantPolicy!,
              },
            );
          } else
            await c.repository<Transfer>('hylSplitTransfers').createOne({
              values: {
                id: randomUUID(),
                orderId: id,
                contractId: row.contractId,
                merchantId: row.merchantId,
                recipientKey: line.key,
                kind: action === 'recover' ? 'recover' : 'partnerPay',
                amountCents: String(cents(body.amount)),
                reference: body.reference,
                sourceTransferId: null,
                payload: { ...body, actor: access.actor },
                createdAt: new Date().toISOString(),
              },
            });
          await c.repository('hylSplitAttempts').createOne({
            values: {
              id: randomUUID(),
              orderId: id,
              recipientKey: line.key,
              status: 'success',
              payload: { ...body, actor: access.actor },
              createdAt: new Date().toISOString(),
            },
          });
        } else fail('INVALID_ACTION', 'INVALID_ARGUMENT');
        return projectSource(c, this.hyl, row, access.actor);
      },
    );
  }
}
