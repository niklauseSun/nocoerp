import { createHash, randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { ApiError } from '@nocobase/app-server/router';
import { type Access, type HylService, fail } from '../hyl/service.js';
import { actionSchema } from '../hyl/schema.js';
import { periodFor, cents } from '../hyl/calculation.js';
import { getLease, effectiveEnd } from '../leases/model.js';
import { dayOf } from '../cashier/reports.js';
import type { Row } from '../hyl/schema.js';
import { assetPolicy } from '../providers/assets.js';
import type { Asset, ContractAsset } from '../assets/schema.js';
import { TenantOperations } from './service.js';
import {
  batchStatus,
  type Batch,
  type BatchItem,
  type DeliveryQuery,
  type batchCreateSchema,
  type batchPreviewSchema,
  type batchRunSchema,
} from './delivery-model.js';
export const fingerprint = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const stableId = (value: string) => {
  const d = fingerprint(value);
  return `${d.slice(0, 8)}-${d.slice(8, 12)}-4${d.slice(13, 16)}-a${d.slice(17, 20)}-${d.slice(20, 32)}`;
};
const now = () => new Date().toISOString();
export function deliveryPage<
  T extends {
    id: string;
    name: string;
    date: string;
    status: string;
    amountCents: string;
    updatedAt: string;
    count?: number;
  },
>(rows: T[], q: DeliveryQuery) {
  const term = q.q.toLocaleLowerCase();
  const items = rows.filter(
    (r) =>
      (!q.status || r.status === q.status) &&
      JSON.stringify(r).toLocaleLowerCase().includes(term),
  );
  const sign = q.order.startsWith('-') ? -1 : 1,
    key = q.order.replace('-', '') as
      'name' | 'date' | 'amountCents' | 'updatedAt' | 'count';
  items.sort((a, b) => {
    if (key === 'count')
      return (
        ((a.count ?? 0) - (b.count ?? 0)) * sign || a.id.localeCompare(b.id)
      );
    if (key === 'amountCents')
      return (
        (BigInt(a.amountCents) > BigInt(b.amountCents)
          ? 1
          : BigInt(a.amountCents) < BigInt(b.amountCents)
            ? -1
            : 0) * sign || a.id.localeCompare(b.id)
      );
    return (
      a[key].localeCompare(b[key], 'zh-CN') * sign || a.id.localeCompare(b.id)
    );
  });
  return {
    data: {
      items: items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
    },
    meta: { total: items.length, page: q.page, pageSize: q.pageSize },
  };
}
export class SettlementBatches {
  readonly ops: TenantOperations;
  constructor(readonly hyl: HylService) {
    this.ops = new TenantOperations(hyl);
  }
  async reportingReady(
    access: Access,
    contract: Row,
    month: string,
    part: string,
  ) {
    const [a, b] = periodFor(month, part),
      end = await effectiveEnd(this.hyl.db.connection(), contract);
    const start =
        String(contract.payload.start) > a ? String(contract.payload.start) : a,
      stop = end < b ? end : b;
    if (start > stop) fail('INVALID_PERIOD', 'INVALID_ARGUMENT');
    if (stop > dayOf(new Date().toISOString())) fail('PERIOD_NOT_ENDED');
    const reports = await this.ops.records(access, 'revenueReports');
    for (
      let day = start;
      day <= stop;
      day = new Date(Date.parse(day + 'T12:00:00Z') + 86400000)
        .toISOString()
        .slice(0, 10)
    ) {
      const found = reports.filter(
        (r) => r.merchantId === contract.merchantId && r.date === day,
      );
      if (!found.length || found.some((r) => r.status !== 'approved'))
        fail('REPORTING_INCOMPLETE');
    }
  }
  async contracts(access: Access) {
    const contracts = await this.ops.records(access, 'contracts'),
      merchants = await this.ops.records(access, 'merchants');
    const assets = await this.hyl.db
      .repository<Asset>('hylAssets')
      .withPolicy(await assetPolicy(access, 'read'))
      .findMany();
    const ids = new Set(assets.map((a) => a.id));
    const links = await this.hyl.db
      .repository<ContractAsset>('hylContractAssets')
      .findMany();
    return contracts
      .filter(
        (r) =>
          merchants.some((m) => m.id === r.merchantId) &&
          links
            .filter((b) => b.contractId === r.id)
            .every((b) => ids.has(b.assetId)),
      )
      .map((r) => ({
        ...r,
        projectIds: [
          ...new Set(
            links
              .filter((b) => b.contractId === r.id)
              .map((b) => String(b.snapshot.projectId)),
          ),
        ],
        merchantName: merchants.find((m) => m.id === r.merchantId)!.name,
      }));
  }
  async preview(access: Access, v: z.infer<typeof batchPreviewSchema>) {
    await this.hyl.policy(access, 'settlements', 'write');
    const contracts = await this.contracts(access),
      settlements = await this.ops.records(access, 'settlements');
    const [start, end] = periodFor(v.month, v.part);
    const items = [];
    for (const r of contracts.filter(
      (c) =>
        !v.projectId ||
        (c.projectIds.length === 1 && c.projectIds[0] === v.projectId),
    )) {
      if (
        (r.payload.cycle === 'month') !== (v.part === 'month') ||
        String(r.payload.start) > end ||
        String(r.payload.end) < start
      )
        continue;
      const lease = await getLease(this.hyl.db.connection(), r),
        actualEnd = await effectiveEnd(this.hyl.db.connection(), r);
      const existing = settlements.find(
        (s) =>
          s.merchantId === r.merchantId &&
          s.status !== 'cancelled' &&
          String(s.payload.start) <= end &&
          String(s.payload.end) >= start,
      );
      let reason =
        r.status !== 'active' || lease.status === 'closed' || actualEnd < start
          ? 'CONTRACT_INACTIVE'
          : existing
            ? 'PERIOD_ALREADY_SETTLED'
            : '';
      if (!reason)
        try {
          await this.reportingReady(access, r, v.month, v.part);
        } catch (e) {
          if (!(e instanceof ApiError)) throw e;
          reason = e.reason ?? 'INVALID_ARGUMENT';
        }
      items.push({
        id: r.id,
        number: r.number,
        merchantId: r.merchantId,
        name: r.merchantName,
        canGenerate: !reason,
        reason,
      });
    }
    const assets = await this.hyl.db
      .repository<Asset>('hylAssets')
      .withPolicy(await assetPolicy(access, 'read'))
      .findMany();
    return {
      items,
      projects: assets
        .filter((a) => a.type === 'project')
        .map((a) => ({ id: a.id, name: a.name })),
    };
  }
  async create(access: Access, v: z.infer<typeof batchCreateSchema>) {
    const preview = await this.preview(access, v),
      digest = fingerprint({
        month: v.month,
        part: v.part,
        projectId: v.projectId ?? '',
        contractIds: [...v.contractIds].sort(),
      });
    if (v.contractIds.some((id) => !preview.items.some((i) => i.id === id)))
      fail('ACCESS_DENIED', 'PERMISSION_DENIED');
    const old = await this.hyl.db
      .repository<Batch>('hylSettlementBatches')
      .findOne({ filter: { id: v.requestId } });
    if (old) {
      if (old.actor !== access.actor || old.payload.fingerprint !== digest)
        fail('REQUEST_CONFLICT', 'ALREADY_EXISTS');
      return (await this.detail(access, old.id)).batch;
    }
    if (
      v.contractIds.some(
        (id) => !preview.items.find((i) => i.id === id)?.canGenerate,
      )
    )
      fail('PERIOD_ALREADY_SETTLED', 'ALREADY_EXISTS');
    return this.hyl.db.transaction(async (c) => {
      const at = now(),
        batch: Batch = {
          id: v.requestId,
          number:
            'PC-' + v.month.replace('-', '') + '-' + v.requestId.slice(0, 8),
          month: v.month,
          part: v.part,
          projectId: v.projectId ?? '',
          actor: access.actor,
          leaseToken: '',
          leaseUntil: '',
          payload: {
            contractIds: [...v.contractIds].sort(),
            fingerprint: digest,
          },
          createdAt: at,
          updatedAt: at,
        };
      await c
        .repository<Batch>('hylSettlementBatches')
        .createOne({ values: batch });
      for (const contractId of batch.payload.contractIds)
        await c.repository<BatchItem>('hylSettlementBatchItems').createOne({
          values: {
            id: stableId(batch.id + ':' + contractId),
            batchId: batch.id,
            contractId,
            settlementId: '',
            version: 1,
            payload: { attempts: [] },
            updatedAt: at,
          },
        });
      return batch;
    });
  }
  async detail(access: Access, id: string) {
    const contracts = await this.contracts(access),
      visible = new Set(contracts.map((c) => c.id));
    const batch = await this.hyl.db
      .repository<Batch>('hylSettlementBatches')
      .findOne({ filter: { id } });
    if (!batch || batch.payload.contractIds.some((id) => !visible.has(id)))
      fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    // A batch is all-or-nothing for read scope; no aggregate from inaccessible child sources escapes.
    const items = await this.hyl.db
      .repository<BatchItem>('hylSettlementBatchItems')
      .findMany({ filter: { batchId: id } });
    const records = [];
    for (const i of items) {
      const contract = contracts.find((c) => c.id === i.contractId)!;
      const settlement = i.settlementId
        ? await this.hyl.get(access, 'settlements', i.settlementId)
        : undefined;
      let canReview = false,
        canPay = false;
      if (settlement) {
        try {
          await this.hyl.get(access, 'settlements', settlement.id, 'review');
          canReview = settlement.status === 'review';
        } catch (e) {
          if (
            !(e instanceof ApiError) ||
            !['PERMISSION_DENIED', 'NOT_FOUND'].includes(e.status)
          )
            throw e;
        }
        try {
          await this.hyl.get(access, 'settlements', settlement.id, 'pay');
          canPay = ['payable', 'partial'].includes(settlement.status);
        } catch (e) {
          if (
            !(e instanceof ApiError) ||
            !['PERMISSION_DENIED', 'NOT_FOUND'].includes(e.status)
          )
            throw e;
        }
      }
      records.push({
        ...i,
        number: contract.number,
        merchantName: contract.merchantName,
        settlementNumber: settlement?.number ?? '',
        settlementStatus: settlement?.status ?? '',
        amountCents: settlement?.amountCents ?? '0',
        canReview,
        canPay,
      });
    }
    let canReviewPermission = false;
    try {
      await this.hyl.policy(access, 'settlements', 'review');
      canReviewPermission = true;
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 'PERMISSION_DENIED') throw e;
    }
    let canGenerate = false;
    try {
      await this.hyl.policy(access, 'settlements', 'write');
      canGenerate = true;
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 'PERMISSION_DENIED') throw e;
    }
    return {
      batch: { ...batch, leaseToken: undefined },
      items: records,
      status: batchStatus(items),
      canGenerate,
      canReviewPermission,
    };
  }
  async projects(access: Access) {
    await this.hyl.policy(access, 'settlements', 'read');
    const assets = await this.hyl.db
      .repository<Asset>('hylAssets')
      .withPolicy(await assetPolicy(access, 'read'))
      .findMany();
    return assets
      .filter((a) => a.type === 'project')
      .map((a) => ({ id: a.id, name: a.name }));
  }
  async list(access: Access, q: DeliveryQuery) {
    await this.hyl.policy(access, 'settlements', 'read');
    const batches = await this.hyl.db
      .repository<Batch>('hylSettlementBatches')
      .findMany();
    const rows = [];
    for (const b of batches.filter(
      (b) =>
        (!q.month || b.month === q.month) &&
        (!q.projectId || b.projectId === q.projectId),
    )) {
      try {
        const d = await this.detail(access, b.id);
        rows.push({
          id: b.id,
          name: b.number,
          date: b.month + '-01',
          status: d.status,
          amountCents: String(
            d.items.reduce((n, i) => n + BigInt(i.amountCents), 0n),
          ),
          updatedAt: b.updatedAt,
          count: d.items.length,
          detail: `${d.items.filter((i) => i.settlementId).length}/${d.items.length}`,
          path: 'batch/' + b.id,
        });
      } catch (e) {
        if (
          !(e instanceof ApiError) ||
          !['PERMISSION_DENIED', 'NOT_FOUND'].includes(e.status)
        )
          throw e;
      }
    }
    return deliveryPage(rows, q);
  }
  async run(access: Access, id: string, input: z.infer<typeof batchRunSchema>) {
    const detail = await this.detail(access, id);
    if (input.itemIds.some((id) => !detail.items.some((i) => i.id === id)))
      fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    if (input.action === 'review')
      await this.hyl.policy(access, 'settlements', 'review');
    else await this.hyl.policy(access, 'settlements', 'write');
    const token = randomUUID(),
      at = now(),
      repo = this.hyl.db.repository<Batch>('hylSettlementBatches');
    if (detail.batch.leaseUntil > at) fail('OPERATIONS_BUSY', 'ABORTED');
    const locked = await repo.updateMany({
      filter: { id, leaseUntil: detail.batch.leaseUntil },
      values: {
        leaseToken: token,
        leaseUntil: new Date(Date.now() + 600000).toISOString(),
      },
    });
    if (locked.updatedCount !== 1) fail('OPERATIONS_BUSY', 'ABORTED');
    try {
      for (const item of detail.items.filter((i) =>
        input.itemIds.includes(i.id),
      )) {
        if (input.action !== 'review' && item.settlementId) continue;
        if (
          input.action === 'retry' &&
          item.payload.attempts.at(-1)?.outcome !== 'failed'
        )
          continue;
        if (input.action === 'review' && !item.canReview) continue;
        let settlementId = item.settlementId,
          reason = '',
          outcome = 'succeeded';
        try {
          const contract = await this.hyl.get(
            access,
            'contracts',
            item.contractId,
          );
          if (input.action === 'review') {
            const row = await this.hyl.get(
              access,
              'settlements',
              settlementId,
              'review',
            );
            await this.hyl.act(
              access,
              'settlements',
              row.id,
              'review',
              actionSchema.parse({ expectedVersion: row.version }),
            );
          } else {
            const recovered = (
              await this.ops.records(access, 'settlements')
            ).some((r) => r.payload.batchItemId === item.id);
            if (!recovered)
              await this.reportingReady(
                access,
                contract,
                detail.batch.month,
                detail.batch.part,
              );
            const r = await this.hyl.generate(
              access,
              {
                merchantId: contract.merchantId,
                contractId: contract.id,
                month: detail.batch.month,
                part: detail.batch.part,
              },
              item.id,
            );
            settlementId = r.id;
          }
        } catch (e) {
          if (!(e instanceof ApiError)) throw e;
          outcome = 'failed';
          reason = e.reason ?? 'INVALID_ARGUMENT';
        }
        const changed = await this.hyl.db
          .repository<BatchItem>('hylSettlementBatchItems')
          .updateMany({
            filter: { id: item.id, version: item.version },
            values: {
              settlementId,
              version: item.version + 1,
              updatedAt: now(),
              payload: {
                attempts: [
                  ...item.payload.attempts,
                  {
                    action: input.action,
                    actor: access.actor,
                    at: now(),
                    outcome,
                    reason,
                  },
                ],
              },
            },
          });
        if (changed.updatedCount !== 1) fail('VERSION_CONFLICT', 'ABORTED');
      }
    } finally {
      await repo.updateMany({
        filter: { id, leaseToken: token },
        values: { leaseToken: '', leaseUntil: '', updatedAt: now() },
      });
    }
    return this.detail(access, id);
  }
  async paymentRows(access: Access, id: string) {
    const d = await this.detail(access, id),
      rows = [];
    for (const i of d.items.filter((i) => !!i.settlementId)) {
      const r = await this.hyl.detail(access, 'settlements', i.settlementId);
      await this.hyl.get(access, 'settlements', r.id, 'pay');
      if (!['payable', 'partial'].includes(r.status)) continue;
      const paid = r.payments.reduce<bigint>(
          (n, p) => n + cents(String((p as Record<string, unknown>).amount)),
          0n,
        ),
        remaining = BigInt(r.amountCents) - paid;
      if (remaining <= 0n) continue;
      const m = await this.hyl.get(access, 'merchants', r.merchantId);
      const accountName =
          typeof m.payload.accountName === 'string'
            ? m.payload.accountName
            : '',
        bank = typeof m.payload.bank === 'string' ? m.payload.bank : '',
        account =
          typeof m.payload.account === 'string' ? m.payload.account : '';
      rows.push({
        merchantName: m.name,
        number: r.number,
        amountCents: String(remaining),
        accountName,
        bank,
        account,
        eligible: !!(
          accountName &&
          bank &&
          account &&
          /^\d{8,32}$/.test(account)
        ),
        id: r.id,
      });
    }
    return { number: d.batch.number, generatedAt: now(), items: rows };
  }
}
