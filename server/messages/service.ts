import { randomUUID } from 'node:crypto';
import type { DatabaseConnection } from '@nocobase/db';
import type { NotificationService } from '@nocobase/app-plugin-notification/server';
import type { AppAuthorization } from '@nocobase/app-plugin-authorization';
import type { z } from 'zod';
import { fail, type Access, type HylService } from '../hyl/service.js';
import { MessageSources, hidden, key } from './sources.js';
import type { Preferences, Todo } from './model.js';
import type { preferenceInput, listInput } from './schema.js';
const now = () => new Date().toISOString();
const prefTable = 'hylMessagePreferences',
  todoTable = 'hylMessageTodos';
export const defaults = (userId: string): Preferences => ({
  userId,
  version: 0,
  enabled: false,
  contracts: true,
  bills: true,
  repairs: true,
  purchases: true,
  contractDays: 30,
  billDays: 7,
  locale: 'zh-CN',
  scanToken: '',
  leaseUntil: '',
  lastCheckedAt: '',
  lastError: '',
  createdAt: now(),
  updatedAt: now(),
});
// Translation is injected by the provider so service tests use the same frozen-outbox contract.
export type Wording = (
  locale: Preferences['locale'],
  reason: string,
) => Promise<{ title: string; body: string }>;
export class MessageService {
  readonly sources: MessageSources;
  constructor(
    readonly hyl: HylService,
    readonly notifications: NotificationService,
    readonly wording: Wording,
  ) {
    this.sources = new MessageSources(hyl);
  }
  c() {
    return this.hyl.db.connection();
  }
  async preferences(access: Access, c = this.c()) {
    return (
      (await c
        .repository<Preferences>(prefTable)
        .findOne({ filter: { userId: access.actor } })) ??
      defaults(access.actor)
    );
  }
  // Internal lease fields never cross the API boundary.
  publicPreferences(p: Preferences) {
    const { userId: _u, scanToken: _t, leaseUntil: _l, ...publicValues } = p;
    return publicValues;
  }
  async save(access: Access, input: z.infer<typeof preferenceInput>) {
    return this.hyl.db.transaction(async (c) => {
      const p = await this.preferences(access, c);
      if (p.version !== input.expectedVersion)
        fail('MESSAGE_CHANGED', 'ABORTED');
      if (p.leaseUntil > now()) fail('MESSAGE_BUSY', 'ABORTED');
      const values = {
        ...input.values,
        version: p.version + 1,
        updatedAt: now(),
      };
      if (p.version === 0)
        await c
          .repository<Preferences>(prefTable)
          .createOne({ values: { ...p, ...values } });
      else {
        const u = await c.repository<Preferences>(prefTable).updateMany({
          filter: {
            userId: access.actor,
            version: p.version,
            scanToken: p.scanToken,
          },
          values,
        });
        if (u.updatedCount !== 1) fail('MESSAGE_CHANGED', 'ABORTED');
      }
      // Disabling all subscriptions cannot rely on the enabled-only schedule for cleanup.
      const rows = await c
        .repository<Todo>(todoTable)
        .findMany({ filter: { userId: access.actor, status: 'active' } });
      for (const r of rows)
        if (!values.enabled || !values[r.kind])
          await this.transition(c, r, 'resolve', access.actor, {});
      return this.publicPreferences({ ...p, ...values });
    });
  }
  async transition(
    c: DatabaseConnection,
    r: Todo,
    action: 'resolve' | 'reopen',
    actor: string,
    values: Partial<Todo>,
  ) {
    await this.hyl.runtime.fire(todoTable, r.id, action, {
      actor: { id: actor },
      transaction: c,
      expect: { version: r.lifecycleVersion },
    });
    await c.repository<Todo>(todoTable).updateMany({
      filter: { id: r.id, userId: actor },
      values: { ...values, updatedAt: now() },
    });
  }
  async person(id: string) {
    const u = await this.hyl.users.get(id);
    return !!u && u.kind === 'person' && !u.disabledAt;
  }
  async acquire(access: Access) {
    return this.hyl.db.transaction(async (c) => {
      const p = await this.preferences(access, c);
      if (!p.enabled) return null;
      if (p.leaseUntil > now()) return null;
      const scanToken = randomUUID(),
        leaseUntil = new Date(Date.now() + 300000).toISOString();
      const u = await c.repository<Preferences>(prefTable).updateMany({
        filter: {
          userId: access.actor,
          version: p.version,
          scanToken: p.scanToken,
          leaseUntil: p.leaseUntil,
        },
        values: { scanToken, leaseUntil },
      });
      return u.updatedCount === 1 ? { ...p, scanToken, leaseUntil } : null;
    });
  }
  async fence(c: DatabaseConnection, p: Preferences) {
    const fresh = await c
      .repository<Preferences>(prefTable)
      .findOne({ filter: { userId: p.userId, scanToken: p.scanToken } });
    if (!fresh || !fresh.enabled || fresh.leaseUntil <= now())
      fail('MESSAGE_BUSY', 'ABORTED');
  }
  identity(r: Todo) {
    return 'nocoerp-message-' + r.id + '-' + r.generation;
  }
  async dispatch(access: Access, r: Todo, p: Preferences) {
    await this.fence(this.c(), p);
    if (!(await this.person(access.actor))) return false;
    const fresh = await this.sources.inspect(
      access,
      r.kind,
      r.sourceType,
      r.sourceId,
      p,
    );
    if (
      !fresh.candidates.some((x) => access.actor + ':' + key(x) === r.dedupeKey)
    )
      return false;
    // Same exact frozen payload after an accepted-but-unrecorded send or unknown outcome.
    const sent = await this.notifications.send({
      idempotencyKey: this.identity(r),
      source: { type: 'messageReminder', referenceId: r.id },
      messages: {
        inbox: {
          to: access.actor,
          title: String(r.payload.title),
          body: String(r.payload.body),
          target: { type: 'route', path: '/messageTodos/' + r.id },
        },
      },
    });
    await this.hyl.db.transaction(async (c) => {
      await this.fence(c, p);
      await c.repository<Todo>(todoTable).updateMany({
        filter: {
          id: r.id,
          userId: access.actor,
          generation: r.generation,
          status: 'active',
        },
        values: { notificationId: sent.notificationId, updatedAt: now() },
      });
    });
    return !sent.deduplicated;
  }
  async scan(access: Access) {
    const result = {
      active: 0,
      created: 0,
      resolved: 0,
      sent: 0,
      failed: 0,
      busy: false,
    };
    if (!(await this.person(access.actor)))
      fail('ACCESS_DENIED', 'PERMISSION_DENIED');
    const p = await this.acquire(access);
    if (!p) {
      result.busy = (await this.preferences(access)).enabled;
      return result;
    }
    let error = '';
    try {
      const candidates = await this.sources.collect(access, p),
        words = new Map<string, Awaited<ReturnType<Wording>>>();
      for (const x of candidates)
        if (!words.has(x.reason))
          words.set(x.reason, await this.wording(p.locale, x.reason));
      await this.hyl.db.transaction(async (c) => {
        await this.fence(c, p);
        const repo = c.repository<Todo>(todoTable),
          rows = await repo.findMany({ filter: { userId: access.actor } }),
          byKey = new Map(rows.map((r) => [r.dedupeKey, r])),
          live = new Set(candidates.map((x) => access.actor + ':' + key(x)));
        for (const r of rows)
          if (r.status === 'active' && !live.has(r.dedupeKey)) {
            await this.transition(c, r, 'resolve', access.actor, {});
            result.resolved++;
          }
        for (const x of candidates) {
          const dedupeKey = access.actor + ':' + key(x),
            r = byKey.get(dedupeKey),
            payload = words.get(x.reason)!;
          if (!r) {
            const at = now();
            await this.hyl.runtime.create(
              todoTable,
              {
                id: randomUUID(),
                userId: access.actor,
                dedupeKey,
                kind: x.kind,
                sourceType: x.sourceType,
                sourceId: x.sourceId,
                reason: x.reason,
                dueOn: x.dueOn,
                generation: 1,
                notificationId: '',
                payload,
                createdAt: at,
                updatedAt: at,
              },
              { actor: { id: access.actor }, transaction: c },
            );
            result.created++;
          } else if (r.status === 'resolved') {
            await this.transition(c, r, 'reopen', access.actor, {
              generation: r.generation + 1,
              notificationId: '',
              payload,
            });
            result.created++;
          }
        }
      });
      const rows = await this.c()
        .repository<Todo>(todoTable)
        .findMany({ filter: { userId: access.actor, status: 'active' } });
      result.active = rows.length;
      for (const r of rows) {
        if (r.notificationId) continue;
        try {
          if (await this.dispatch(access, r, p)) result.sent++;
        } catch (e) {
          if (!hidden(e)) {
            result.failed++;
            error = 'MESSAGE_SEND_FAILED';
          }
        }
      }
    } catch (e) {
      error = 'MESSAGE_CHECK_FAILED';
      throw e;
    } finally {
      await this.c()
        .repository<Preferences>(prefTable)
        .updateMany({
          filter: { userId: access.actor, scanToken: p.scanToken },
          values: {
            scanToken: '',
            leaseUntil: '',
            lastCheckedAt: now(),
            lastError: error,
          },
        });
    }
    return result;
  }
  async view(access: Access, r: Todo, p: Preferences) {
    const fresh = await this.sources.inspect(
        access,
        r.kind,
        r.sourceType,
        r.sourceId,
        p,
      ),
      active = fresh.candidates.some(
        (x) => access.actor + ':' + key(x) === r.dedupeKey,
      );
    return {
      id: r.id,
      kind: r.kind,
      reason: r.reason,
      dueOn: r.dueOn,
      status: active && r.status === 'active' ? 'active' : 'resolved',
      generation: r.generation,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      ...fresh.source,
      notificationId: r.notificationId,
    };
  }
  async delivery(id: string) {
    if (!id) return { deliveryStatus: 'pending', canRetry: false };
    const n = await this.notifications.getNotification(id);
    return {
      deliveryStatus: n?.status ?? 'unknown',
      canRetry: !!n?.deliveries.some((d) => d.status === 'failed'),
    };
  }
  async detail(access: Access, id: string) {
    const r = await this.c()
      .repository<Todo>(todoTable)
      .findOne({ filter: { id, userId: access.actor } });
    if (!r) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    try {
      const v = await this.view(access, r, await this.preferences(access)),
        d = await this.delivery(r.notificationId);
      return {
        ...v,
        ...d,
        canRetry: v.status === 'active' && (d.canRetry || !r.notificationId),
      };
    } catch (e) {
      if (hidden(e)) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
      throw e;
    }
  }
  async list(access: Access, input: z.infer<typeof listInput>) {
    const p = await this.preferences(access),
      rows = await this.c()
        .repository<Todo>(todoTable)
        .findMany({ filter: { userId: access.actor } }),
      views = [];
    for (const r of rows) {
      try {
        const v = await this.view(access, r, p);
        if (
          (!input.kind || v.kind === input.kind) &&
          (input.status === 'all' || v.status === input.status) &&
          (!input.q ||
            (v.number + ' ' + v.title)
              .toLowerCase()
              .includes(input.q.toLowerCase()))
        )
          views.push(v);
      } catch (e) {
        if (!hidden(e)) throw e;
      }
    }
    const field = input.order.replace('-', '') as
        'dueOn' | 'createdAt' | 'updatedAt',
      direction = input.order.startsWith('-') ? -1 : 1;
    views.sort(
      (a, b) =>
        direction * a[field].localeCompare(b[field]) ||
        a.id.localeCompare(b.id),
    );
    return {
      data: views.slice(
        (input.page - 1) * input.pageSize,
        input.page * input.pageSize,
      ),
      meta: { page: input.page, pageSize: input.pageSize, total: views.length },
    };
  }
  async retry(access: Access, id: string) {
    const d = await this.detail(access, id);
    if (!d.canRetry) fail('MESSAGE_RETRY_NOT_ALLOWED');
    const p = await this.acquire(access);
    if (!p) fail('MESSAGE_BUSY', 'ABORTED');
    try {
      await this.fence(this.c(), p);
      if (!(await this.person(access.actor)))
        fail('ACCESS_DENIED', 'PERMISSION_DENIED');
      const r = await this.c()
        .repository<Todo>(todoTable)
        .findOne({ filter: { id, userId: access.actor } });
      if (!r) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
      const fresh = await this.view(access, r, p);
      if (fresh.status !== 'active') fail('MESSAGE_RETRY_NOT_ALLOWED');
      if (!r.notificationId) await this.dispatch(access, r, p);
      else {
        const n = await this.notifications.getNotification(r.notificationId),
          failed = n?.deliveries.filter((x) => x.status === 'failed') ?? [];
        if (!failed.length) fail('MESSAGE_RETRY_NOT_ALLOWED');
        for (const delivery of failed)
          await this.notifications.retryDelivery({
            deliveryId: delivery.id,
            reason: 'Recipient requested retry',
          });
      }
    } finally {
      await this.c()
        .repository<Preferences>(prefTable)
        .updateMany({
          filter: { userId: access.actor, scanToken: p.scanToken },
          values: { scanToken: '', leaseUntil: '' },
        });
    }
    return this.detail(access, id);
  }
  async tick(authz: AppAuthorization) {
    // Oldest checked first gives persisted fairness across restarts, including failing recipients.
    const eligible: Preferences[] = [];
    for (const p of await this.c()
      .repository<Preferences>(prefTable)
      .findMany({ filter: { enabled: true } })) {
      if (await this.person(p.userId)) eligible.push(p);
    }
    const prefs = eligible
      .sort(
        (a, b) =>
          a.lastCheckedAt.localeCompare(b.lastCheckedAt) ||
          a.userId.localeCompare(b.userId),
      )
      .slice(0, 10);
    let failed = 0;
    for (const p of prefs) {
      if (!(await this.person(p.userId))) continue;
      try {
        await this.scan({
          actor: p.userId,
          authorization: authz.for({
            principal: { type: 'user', id: p.userId },
            subjects: [
              { type: 'authenticated', id: '*' },
              ...(await authz.subjects.resolveFor({
                type: 'user',
                id: p.userId,
              })),
            ],
          }),
        });
      } catch {
        failed++;
      }
    }
    return { checked: prefs.length, failed };
  }
}
