import { TenantOperations } from '../tenant-operations/service.js';
import { TenantService } from '../tenant-operations/tenant-service.js';
import type { Followup } from '../tenant-operations/model.js';
import { fail } from '../hyl/service.js';
import { dayOf } from '../cashier/reports.js';
import { ApiError } from '@nocobase/app-server/router';
import { BillingService } from '../billing/service.js';
import { RepairService } from '../repairs/service.js';
import { ProcurementService } from '../procurement/service.js';
import { getLease, effectiveEnd } from '../leases/model.js';
import { today } from '../inspections/calendar.js';
import type { HylService, Access } from '../hyl/service.js';
import type { Candidate, Preferences, Kind } from './model.js';
const str = (v: unknown) => (typeof v === 'string' ? v : '');
export const hidden = (e: unknown) =>
  e instanceof ApiError &&
  ['PERMISSION_DENIED', 'NOT_FOUND'].includes(e.status);
export function plusDays(day: string, n: number) {
  return new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function key(c: Candidate) {
  return [c.kind, c.sourceType, c.sourceId, c.reason, c.dueOn].join(':');
}
export class MessageSources {
  readonly billing: BillingService;
  readonly repairs: RepairService;
  readonly procurement: ProcurementService;
  constructor(readonly hyl: HylService) {
    this.billing = new BillingService(hyl);
    this.repairs = new RepairService(hyl);
    this.procurement = new ProcurementService(hyl);
  }
  async inspect(
    access: Access,
    kind: Kind,
    type: string,
    id: string,
    p: Preferences,
  ) {
    const day = today(),
      base = { kind, sourceType: type, sourceId: id },
      c = this.hyl.db.connection();
    let result: Candidate[] = [];
    let source: { number: string; title: string; path: string };
    if (kind === 'contracts') {
      const r = await this.hyl.detail(access, 'contracts', id),
        lease = await getLease(c, r),
        end = await effectiveEnd(c, r);
      source = {
        number: r.number,
        title: str(r.payload.title) || r.number,
        path: '/contracts/' + id,
      };
      if (
        lease.status === 'active' &&
        !lease.payload.successorId &&
        end <= plusDays(day, p.contractDays) &&
        r.allowedLeaseActions?.some((a) => ['renew', 'terminate'].includes(a))
      )
        result.push({
          ...base,
          ...source,
          reason: end < day ? 'contractExpired' : 'contractExpiry',
          dueOn: end,
        });
    } else if (kind === 'bills' && type === 'operationFollowups') {
      const note = await c
        .repository<Followup>('hylOperationFollowups')
        .findOne({ filter: { id, actor: access.actor } });
      if (!note) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
      const current = await new TenantOperations(this.hyl).source(
        access,
        note.kind,
        note.sourceId,
        true,
      );
      source = {
        number: current.name,
        title: current.name,
        path: `/tenantOperations/followup/${note.kind}/${note.sourceId}`,
      };
      const latest = await c
        .repository<Followup>('hylOperationFollowups')
        .findMany({
          filter: {
            kind: note.kind,
            sourceId: note.sourceId,
            actor: access.actor,
          },
          sort: (s) => [s.field('createdAt').desc(), s.field('id').desc()],
          limit: 1,
        });
      const completed =
        note.kind === 'bill' && BigInt(current.amountCents) === 0n;
      if (note.nextDate <= day && latest[0]?.id === note.id && !completed)
        result.push({
          ...base,
          ...source,
          reason: 'operationFollowup',
          dueOn: note.nextDate,
        });
    } else if (kind === 'bills' && type === 'tenantService') {
      const r = await new TenantService(this.hyl).detail(access, id);
      source = {
        number: r.number,
        title: r.title,
        path: '/tenantOperations/service/' + id + '?view=tenantService',
      };
      if (r.allowedActions.includes('read'))
        result.push({
          ...base,
          ...source,
          reason: 'tenantNotice',
          dueOn: r.start,
        });
      if (
        r.allowedActions.some((a) => ['accept', 'reply', 'close'].includes(a))
      )
        result.push({
          ...base,
          ...source,
          reason:
            r.dueDate < day ? 'tenantServiceOverdue' : 'tenantServiceRequest',
          dueOn: r.dueDate,
        });
    } else if (kind === 'bills' && type === 'settlements') {
      const r = await this.hyl.detail(access, 'settlements', id);
      source = {
        number: r.number,
        title: r.number,
        path: '/settlements/' + id,
      };
      if (r.status === 'confirmation' && r.confirmationModes.length)
        result.push({
          ...base,
          ...source,
          reason: 'settlementConfirm',
          dueOn: dayOf(r.createdAt),
        });
    } else if (kind === 'bills') {
      const r = await this.billing.billDetail(access, id);
      source = {
        number: r.number,
        title: r.number,
        path: '/billing/bills/' + id,
      };
      if (
        r.status === 'issued' &&
        BigInt(r.remainingCents) > 0n &&
        r.dueDate <= plusDays(day, p.billDays) &&
        r.allowedActions.some((a) =>
          ['receiptReceive', 'receiptAllocate'].includes(a),
        )
      )
        result.push({
          ...base,
          ...source,
          reason: r.dueDate < day ? 'billOverdue' : 'billDue',
          dueOn: r.dueDate,
        });
    } else if (kind === 'repairs') {
      const r = await this.repairs.detail(access, id);
      source = { number: r.number, title: r.title, path: '/repairs/' + id };
      const action =
        r.status === 'reported'
          ? 'assign'
          : ['assigned', 'processing'].includes(r.status)
            ? r.status === 'assigned'
              ? 'start'
              : 'complete'
            : r.status === 'pendingAcceptance'
              ? 'accept'
              : r.status === 'accepted'
                ? 'close'
                : '';
      if (
        action &&
        r.allowedActions.includes(action) &&
        !r.blockedActions.includes(action)
      )
        result.push({
          ...base,
          ...source,
          reason: (
            {
              assign: 'repairDispatch',
              start: 'repairProcess',
              complete: 'repairProcess',
              accept: 'repairAccept',
              close: 'repairClose',
            } as Record<string, string>
          )[action],
          dueOn: r.dueOn || r.occurredOn,
        });
    } else {
      const k =
          type === 'requests'
            ? 'requests'
            : type === 'receipts'
              ? 'receipts'
              : 'orders',
        r = await this.procurement.detail(access, k, id);
      source = {
        number: r.number,
        title: r.title,
        path: '/procurement/' + k + '/' + id,
      };
      const add = (action: string, reason: string) => {
        if (r.allowedActions.includes(action) && !r.blockedActions[action])
          result.push({
            ...base,
            ...source,
            reason,
            dueOn: str(r.payload.neededOn) || r.day,
          });
      };
      if (k === 'requests' && r.status === 'pending')
        add('approve', 'purchaseReview');
      if (k === 'requests' && r.status === 'approved')
        add('convert', 'purchaseOrder');
      if (k === 'orders' && r.status === 'draft') add('issue', 'purchaseIssue');
      if (k === 'orders' && r.status === 'issued') {
        add('newReceipt', 'purchaseReceive');
        add('pay', 'purchasePay');
      }
      if (k === 'receipts' && r.status === 'pending')
        add('accept', 'purchaseAccept');
    }
    if (!p.enabled || !p[kind]) result = [];
    return { source, candidates: result };
  }
  async collect(access: Access, p: Preferences) {
    const c = this.hyl.db.connection(),
      candidates: Candidate[] = [];
    const sets: [Kind, string, string][] = [
      ['contracts', 'contracts', 'hylContracts'],
      ['bills', 'bills', 'hylBills'],
      ['bills', 'settlements', 'hylSettlements'],
      ['bills', 'operationFollowups', 'hylOperationFollowups'],
      ['bills', 'tenantService', 'hylTenantServiceRecords'],
      ['repairs', 'repairs', 'hylRepairOrders'],
      ['purchases', 'requests', 'hylPurchaseRequests'],
      ['purchases', 'orders', 'hylPurchaseOrders'],
      ['purchases', 'receipts', 'hylPurchaseReceipts'],
    ];
    if (!p.enabled) return candidates;
    for (const [kind, type, table] of sets) {
      if (!p[kind]) continue;
      const rows = await c.repository<{ id: string }>(table).findMany({});
      for (const r of rows) {
        try {
          candidates.push(
            ...(await this.inspect(access, kind, type, r.id, p)).candidates,
          );
        } catch (e) {
          if (!hidden(e)) throw e;
        }
      }
    }
    return candidates;
  }
}
