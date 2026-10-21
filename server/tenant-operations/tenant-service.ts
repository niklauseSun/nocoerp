import type { z } from 'zod';
import { ApiError } from '@nocobase/app-server/router';
import { type Access, type HylService, fail } from '../hyl/service.js';
import { dayOf } from '../cashier/reports.js';
import { deliveryPage, fingerprint } from './batches.js';
import { TenantOperations } from './service.js';
import type {
  ServiceRecord,
  ServiceEvent,
  DeliveryQuery,
  serviceCreateSchema,
  serviceActionSchema,
} from './delivery-model.js';
const table = 'hylTenantServiceRecords',
  eventsTable = 'hylTenantServiceEvents';
const now = () => new Date().toISOString();
const notice = (type: string) => ['notice', 'policy'].includes(type);
export class TenantService {
  readonly ops: TenantOperations;
  constructor(readonly hyl: HylService) {
    this.ops = new TenantOperations(hyl);
  }
  async manages(access: Access) {
    return (
      (
        await access.authorization.authorize({
          resource: { type: 'settings', id: 'hyl.tenantService' },
          action: 'manage',
        })
      ).effect === 'permit'
    );
  }
  async context(access: Access, merchantId: string) {
    const merchant = await this.hyl.get(access, 'merchants', merchantId),
      manage = await this.manages(access);
    return { merchant, manage, owner: merchant.userId === access.actor };
  }
  async options(access: Access) {
    const manage = await this.manages(access),
      merchants = await this.ops.records(access, 'merchants');
    return {
      manage,
      merchants: merchants
        .filter((m) => manage || m.userId === access.actor)
        .map((m) => ({ id: m.id, name: m.name })),
    };
  }
  async get(access: Access, id: string) {
    const row = await this.hyl.db
      .repository<ServiceRecord>(table)
      .findOne({ filter: { id } });
    if (!row) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    const context = await this.context(access, row.merchantId),
      today = dayOf(now());
    if (
      !context.manage &&
      (!context.owner ||
        (notice(row.type) &&
          (row.status !== 'published' ||
            row.start > today ||
            row.dueDate < today)))
    )
      fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    return { row, ...context };
  }
  async detail(access: Access, id: string) {
    const d = await this.get(access, id),
      events = await this.hyl.db
        .repository<ServiceEvent>(eventsTable)
        .findMany({
          filter: { recordId: id },
          sort: (s) => [s.field('createdAt').asc()],
        });
    const actions: string[] = [];
    if (notice(d.row.type)) {
      if (d.manage && d.row.status === 'draft') actions.push('publish');
      if (d.manage && d.row.status === 'published') actions.push('withdraw');
      if (
        d.owner &&
        d.row.status === 'published' &&
        d.row.start <= dayOf(now()) &&
        d.row.dueDate >= dayOf(now()) &&
        !events.some((e) => e.action === 'read' && e.actor === access.actor)
      )
        actions.push('read');
    } else {
      if (d.manage && d.row.status === 'submitted') actions.push('accept');
      if (d.manage && d.row.status === 'processing')
        actions.push('reply', 'close');
      if (
        d.owner &&
        d.row.actor === access.actor &&
        d.row.status === 'closed' &&
        !events.some((e) => e.action === 'feedback')
      )
        actions.push('feedback');
    }
    return {
      ...d.row,
      merchantName: d.merchant.name,
      events,
      allowedActions: actions,
      completedActions: events
        .filter(
          (e) =>
            e.actor === access.actor && ['read', 'feedback'].includes(e.action),
        )
        .map((e) => e.action),
    };
  }
  async create(access: Access, v: z.infer<typeof serviceCreateSchema>) {
    const d = await this.context(access, v.merchantId);
    if (notice(v.type) ? !d.manage : !d.owner && !d.manage)
      fail('ACCESS_DENIED', 'PERMISSION_DENIED');
    if (!notice(v.type) && v.start !== dayOf(now()))
      fail('INVALID_PERIOD', 'INVALID_ARGUMENT');
    const digest = fingerprint({ ...v, requestId: undefined });
    return this.hyl.db.transaction(async (c) => {
      await this.hyl.lockMerchant(c, v.merchantId);
      const old = await c
        .repository<ServiceRecord>(table)
        .findOne({ filter: { id: v.requestId } });
      if (old) {
        if (old.actor !== access.actor || old.payload.fingerprint !== digest)
          fail('REQUEST_CONFLICT', 'ALREADY_EXISTS');
        return old;
      }
      const at = now();
      const created = await this.hyl.runtime.create(
        table,
        {
          id: v.requestId,
          number: 'FW-' + v.requestId.slice(0, 8),
          merchantId: v.merchantId,
          type: v.type,
          title: v.title,
          body: v.body,
          start: v.start,
          dueDate: v.dueDate,
          actor: access.actor,
          version: 1,
          payload: { notes: v.notes, fingerprint: digest },
          createdAt: at,
          updatedAt: at,
        },
        { actor: { id: access.actor }, transaction: c },
      );
      if (!notice(v.type))
        await this.hyl.runtime.fire(table, v.requestId, 'submit', {
          actor: { id: access.actor },
          transaction: c,
          expect: { version: Number(created.record.lifecycleVersion) },
        });
      await c.repository<ServiceEvent>(eventsTable).createOne({
        values: {
          id: v.requestId,
          recordId: v.requestId,
          actor: access.actor,
          action: notice(v.type) ? 'create' : 'submit',
          payload: { text: v.notes },
          createdAt: at,
        },
      });
      return (await c
        .repository<ServiceRecord>(table)
        .findOne({ filter: { id: v.requestId } }))!;
    });
  }
  async act(
    access: Access,
    id: string,
    v: z.infer<typeof serviceActionSchema>,
  ) {
    const current = await this.detail(access, id),
      digest = fingerprint(v);
    // Idempotency also rechecks current source visibility. A withdrawn notice is only retryable by managers.
    const previous = await this.hyl.db
      .repository<ServiceEvent>(eventsTable)
      .findOne({ filter: { id: v.requestId } });
    if (previous) {
      if (
        previous.actor !== access.actor ||
        previous.recordId !== id ||
        previous.payload.fingerprint !== digest
      )
        fail('REQUEST_CONFLICT', 'ALREADY_EXISTS');
      if (
        !(await this.manages(access)) &&
        !['read', 'feedback'].includes(v.action)
      )
        fail('ACCESS_DENIED', 'PERMISSION_DENIED');
      return current;
    }
    if (!current.allowedActions.includes(v.action))
      fail('ACCESS_DENIED', 'PERMISSION_DENIED');
    if (['accept', 'reply', 'close', 'feedback'].includes(v.action) && !v.text)
      fail('REASON_REQUIRED', 'INVALID_ARGUMENT');
    if (v.action === 'accept' && (!v.dueDate || v.dueDate < dayOf(now())))
      fail('INVALID_PERIOD', 'INVALID_ARGUMENT');
    if (v.action === 'feedback' && !v.rating)
      fail('INVALID_ARGUMENT', 'INVALID_ARGUMENT');
    await this.hyl.db.transaction(async (c) => {
      await this.hyl.lockMerchant(c, current.merchantId);
      const row = await c
        .repository<ServiceRecord>(table)
        .findOne({ filter: { id } });
      if (!row || row.version !== v.expectedVersion)
        fail('VERSION_CONFLICT', 'ABORTED');
      // Recheck under the merchant lock to prevent duplicate acknowledgements/feedback.
      const existing = await c
        .repository<ServiceEvent>(eventsTable)
        .findMany({ filter: { recordId: id, action: v.action } });
      if (
        (v.action === 'read' &&
          existing.some((e) => e.actor === access.actor)) ||
        (v.action === 'feedback' && existing.length)
      )
        fail('REQUEST_CONFLICT', 'ALREADY_EXISTS');
      await this.hyl.runtime.fire(table, id, v.action, {
        actor: { id: access.actor },
        transaction: c,
        expect: { version: row.lifecycleVersion },
      });
      const update = await c.repository<ServiceRecord>(table).updateMany({
        filter: { id, version: row.version },
        values: {
          version: row.version + 1,
          updatedAt: now(),
          ...(v.action === 'accept'
            ? {
                dueDate: v.dueDate,
                payload: { ...row.payload, assignee: access.actor },
              }
            : {}),
          ...(v.action === 'feedback'
            ? { payload: { ...row.payload, rating: v.rating } }
            : {}),
        },
      });
      if (update.updatedCount !== 1) fail('VERSION_CONFLICT', 'ABORTED');
      await c.repository<ServiceEvent>(eventsTable).createOne({
        values: {
          id: v.requestId,
          recordId: id,
          action: v.action,
          actor: access.actor,
          payload: {
            text: v.text,
            dueDate: v.dueDate ?? '',
            rating: v.rating ?? 0,
            fingerprint: digest,
          },
          createdAt: now(),
        },
      });
    });
    return this.detail(access, id);
  }
  async list(access: Access, q: DeliveryQuery) {
    await this.hyl.policy(access, 'merchants', 'read');
    const records = await this.hyl.db
        .repository<ServiceRecord>(table)
        .findMany(),
      rows = [];
    for (const r of records.filter((r) => !q.type || r.type === q.type)) {
      try {
        const d = await this.get(access, r.id);
        if (
          q.q &&
          ![r.title, r.body, d.merchant.name]
            .join(' ')
            .toLocaleLowerCase()
            .includes(q.q.toLocaleLowerCase())
        )
          continue;
        rows.push({
          id: r.id,
          name: r.title,
          date: r.dueDate,
          status: r.status,
          amountCents: '0',
          updatedAt: r.updatedAt,
          detail: d.merchant.name,
          type: r.type,
          path: 'service/' + r.id,
        });
      } catch (e) {
        if (
          !(e instanceof ApiError) ||
          !['PERMISSION_DENIED', 'NOT_FOUND'].includes(e.status)
        )
          throw e;
      }
    }
    return deliveryPage(rows, { ...q, q: '' });
  }
}
