import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DatabaseConnection } from '@nocobase/db';
import type { UserRoleScopeRegistry } from '@nocobase/app-plugin-users/server/tokens';
import type { OrganizationService } from '../organization/service.js';
import type { Member } from '../organization/model.js';
import type { WecomConfig } from '../config/wecom.js';
import { WecomClient, WecomError } from './client.js';
import {
  direction,
  equal,
  hash,
  refuse,
  type Mapping,
  type Snapshot,
  type mappingInput,
} from './model.js';
const table = 'hylWecomMappings';
const department = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  parentid: z.number().int().nonnegative(),
});
const person = z.object({
  userid: z.string(),
  name: z.string().min(1),
  email: z.string().email(),
  department: z.array(z.number().int().positive()).min(1),
  main_department: z.number().optional(),
  status: z.union([z.literal(1), z.literal(2), z.literal(4)]),
});

export class WecomService {
  readonly read: WecomClient;
  readonly write: WecomClient;
  readonly appClient: WecomClient;
  constructor(
    readonly org: OrganizationService,
    readonly roles: UserRoleScopeRegistry,
    readonly config: WecomConfig,
    transport?: typeof fetch,
  ) {
    this.read = new WecomClient(
      config.corpId,
      config.readSecret || config.appSecret,
      transport,
    );
    this.write = new WecomClient(
      config.corpId,
      config.contactsSecret,
      transport,
    );
    this.appClient = new WecomClient(
      config.corpId,
      config.appSecret,
      transport,
    );
  }
  ready() {
    if (!this.config.enabled || !this.config.corpId) refuse('NOT_CONFIGURED');
  }
  status() {
    const c = this.config;
    return {
      enabled: c.enabled,
      corpId: c.corpId,
      agentId: c.agentId,
      directoryRead: !!(c.readSecret || c.appSecret),
      directoryWrite: !!c.contactsSecret,
      messages: !!c.appSecret && !!c.agentId && c.notifications,
      autoSync: c.autoSync,
    };
  }
  async check() {
    this.ready();
    try {
      await this.read.call('department/list');
      await this.write.accessToken();
      await this.appClient.call('agent/get', { agentid: this.config.agentId });
      return { connected: true };
    } catch {
      refuse('CONNECTION_FAILED');
    }
  }
  mappings(c = this.org.db.connection()) {
    return c.repository<Mapping>(table).findMany({
      filter: { corpId: this.config.corpId },
      sort: (s) => [s.field('updatedAt').desc(), s.field('id').asc()],
    });
  }
  async get(id: string, c = this.org.db.connection()) {
    const m = await c
      .repository<Mapping>(table)
      .findOne({ filter: { id, corpId: this.config.corpId } });
    if (!m) refuse('NOT_FOUND', 'NOT_FOUND');
    return m;
  }
  async create(actor: string, input: z.infer<typeof mappingInput>) {
    this.ready();
    const id = randomUUID();
    const m: Mapping = {
      ...input,
      id,
      corpId: this.config.corpId,
      localId: input.localId || id,
      remoteId:
        input.remoteId ||
        (input.kind === 'department'
          ? String(parseInt(hash(id).slice(0, 7), 16) + 10)
          : 'erp_' + id.replaceAll('-', '')),
      localExists: !!input.localId,
      remoteExists: !!input.remoteId,
      baseline: null,
      intent: null,
      intentDirection: '',
      state: 'new',
      version: 0,
      error: '',
      updatedAt: new Date().toISOString(),
    };
    if (m.kind === 'department' && !/^\d+$/.test(m.remoteId))
      refuse('INVALID_ID');
    // Verify all existing targets and field visibility before establishing identity; never match by name/email.
    const maps = [...(await this.mappings()), m];
    if (m.localExists) await this.local(m, maps);
    if (m.remoteExists) await this.remote(m, maps);
    return this.org.db.transaction(async (c) => {
      await this.org.lock(c);
      const existing = await this.mappings(c);
      if (
        existing.some(
          (x) =>
            x.kind === m.kind &&
            (x.localId === m.localId || x.remoteId === m.remoteId),
        )
      )
        refuse('DUPLICATE');
      await c.repository<Mapping>(table).createOne({ values: m });
      await this.audit(c, m.id, actor, 'link', 'created');
      return m;
    });
  }
  async local(
    m: Mapping,
    maps: Mapping[],
    c = this.org.db.connection(),
  ): Promise<Snapshot | null> {
    if (!m.localExists) return null;
    if (m.kind === 'department') {
      const row = (await this.org.tree(c)).find((x) => x.id === m.localId);
      if (!row) refuse('LOCAL_MISSING');
      if (
        row.parentId &&
        !maps.some((x) => x.kind === 'department' && x.localId === row.parentId)
      )
        refuse('MAP_PARENT');
      return {
        name: row.title,
        parent: row.parentId || '',
        enabled: row.active,
      };
    }
    const u = await this.org.users.withConnection(c).get(m.localId);
    if (!u || u.kind !== 'person') refuse('LOCAL_MISSING');
    const memberships = await c
      .repository<Member>('hylDepartmentMembers')
      .findMany({ filter: { userId: u.id, active: true } });
    if (
      !memberships.length ||
      memberships.some(
        (x) =>
          !maps.some(
            (d) => d.kind === 'department' && d.localId === x.departmentId,
          ),
      )
    )
      refuse('MAP_DEPARTMENTS');
    return {
      name: u.name,
      email: u.email,
      departments: memberships.map((x) => x.departmentId).sort(),
      primary:
        memberships.find((x) => x.primary)?.departmentId ||
        memberships.map((x) => x.departmentId).sort()[0],
      enabled: !u.disabledAt,
    };
  }
  async remote(m: Mapping, maps: Mapping[]): Promise<Snapshot | null> {
    if (!m.remoteExists) return null;
    try {
      if (m.kind === 'department') {
        const raw = await this.read.call('department/list', { id: m.remoteId });
        const rows = z.array(department).parse(raw.department),
          row = rows.find((x) => String(x.id) === m.remoteId);
        if (!row) refuse('REMOTE_MISSING');
        const parent =
          row.parentid === 0
            ? ''
            : maps.find(
                (x) =>
                  x.kind === 'department' &&
                  x.remoteId === String(row.parentid),
              )?.localId;
        if (parent === undefined) refuse('MAP_PARENT');
        return { name: row.name, parent, enabled: true };
      }
      const row = person.parse(
        await this.read.call('user/get', { userid: m.remoteId }),
      );
      if (row.userid !== m.remoteId) refuse('REMOTE_MISSING');
      const ids = row.department.map(
        (id) =>
          maps.find((x) => x.kind === 'department' && x.remoteId === String(id))
            ?.localId,
      );
      if (ids.some((x) => !x)) refuse('MAP_DEPARTMENTS');
      const primary = maps.find(
        (x) =>
          x.kind === 'department' &&
          x.remoteId === String(row.main_department ?? row.department[0]),
      )?.localId;
      if (!primary || !ids.includes(primary)) refuse('MAP_DEPARTMENTS');
      return {
        name: row.name,
        email: row.email,
        departments: (ids as string[]).sort(),
        primary,
        enabled: row.status !== 2,
      };
    } catch (e) {
      if (e instanceof WecomError) refuse('REMOTE_READ');
      if (e instanceof z.ZodError) refuse('INCOMPLETE_DIRECTORY');
      throw e;
    }
  }
  async preview(id: string) {
    this.ready();
    const m = await this.get(id),
      maps = await this.mappings();
    const [local, remote] = await Promise.all([
      this.local(m, maps),
      this.remote(m, maps),
    ]);
    return {
      mapping: m,
      local,
      remote,
      suggested: direction(m.baseline, local, remote),
      fingerprint: hash([
        m.corpId,
        this.config.agentId,
        m.version,
        local,
        remote,
      ]),
      history: await this.org.db.repository('hylWecomAudit').findMany({
        filter: { mappingId: id },
        sort: (s) => [s.field('at').desc()],
        limit: 20,
      }),
    };
  }
  async audit(
    c: DatabaseConnection,
    mappingId: string,
    actor: string,
    way: string,
    result: string,
    error = '',
  ) {
    await c.repository('hylWecomAudit').createOne({
      values: {
        id: randomUUID(),
        mappingId,
        actor,
        direction: way,
        result,
        error,
        at: new Date().toISOString(),
      },
    });
  }
  async pull(
    c: DatabaseConnection,
    m: Mapping,
    wanted: Snapshot,
    maps: Mapping[],
    actor: string,
  ) {
    if (m.kind === 'department') {
      const old = m.localExists
        ? (await this.org.tree(c)).find((x) => x.id === m.localId)
        : undefined;
      // Creation uses the preallocated local identity so children can refer to it consistently.
      if (!m.localExists) {
        if (
          wanted.parent &&
          !maps.some(
            (x) =>
              x.kind === 'department' &&
              x.localId === wanted.parent &&
              x.localExists,
          )
        )
          refuse('MAP_PARENT');
        await c.repository('hylDepartments').createOne({
          values: {
            id: m.localId,
            title: wanted.name,
            parentId: wanted.parent || null,
            active: true,
            version: 0,
          },
        });
        await this.org.audit(
          c,
          actor,
          'department.create',
          m.localId,
          null,
          wanted,
        );
      } else
        await this.org.department(
          actor,
          {
            title: wanted.name,
            parentId: wanted.parent || null,
            active: wanted.enabled,
            version: old!.version,
          },
          m.localId,
          c,
        );
      return;
    }
    const users = this.org.users.withConnection(c);
    if (!wanted.email || !wanted.departments?.length)
      refuse('INCOMPLETE_DIRECTORY');
    if (
      wanted.departments.some(
        (id) =>
          !maps.some(
            (x) => x.kind === 'department' && x.localId === id && x.localExists,
          ),
      )
    )
      refuse('MAP_DEPARTMENTS');
    if (!m.localExists) {
      const u = await users.create({
        name: wanted.name,
        email: wanted.email,
        username: 'wx_' + hash(m.corpId + ':' + m.remoteId).slice(0, 24),
        password: randomBytes(36).toString('base64url'),
      });
      m.localId = u.id;
    } else
      await users.update(m.localId, { name: wanted.name, email: wanted.email });
    if (!wanted.enabled) {
      if (m.localId === actor) refuse('SELF_DISABLE');
      for (const scope of this.roles.list())
        await scope.assertCanDisable?.(m.localId, c);
      await users.disable(m.localId);
    } else if ((await users.get(m.localId))?.disabledAt)
      await users.enable(m.localId);
    const existing = await c
      .repository<Member>('hylDepartmentMembers')
      .findMany({ filter: { userId: m.localId } });
    for (const x of existing)
      if (x.active && !wanted.departments.includes(x.departmentId))
        await this.org.member(
          actor,
          x.departmentId,
          { userId: m.localId, active: false, primary: false },
          c,
        );
    // Memberships remain recorded even for disabled users; public org.member only accepts enabled identities.
    if (wanted.enabled)
      for (const id of wanted.departments)
        await this.org.member(
          actor,
          id,
          { userId: m.localId, active: true, primary: id === wanted.primary },
          c,
        );
    else {
      // Do not silently discard department changes received with a disable operation.
      for (const id of wanted.departments) {
        const old = existing.find((x) => x.departmentId === id);
        const row = {
          id: old?.id || randomUUID(),
          userId: m.localId,
          departmentId: id,
          active: true,
          primary: id === wanted.primary,
        };
        if (old)
          await c
            .repository<Member>('hylDepartmentMembers')
            .updateOne({ filter: { id: old.id }, values: row });
        else
          await c
            .repository<Member>('hylDepartmentMembers')
            .createOne({ values: row });
      }
      await this.org.refresh(c, [m.localId]);
    }
    await this.org.audit(c, actor, 'wecom.user.pull', m.localId, null, {
      name: wanted.name,
      enabled: wanted.enabled,
    });
  }
  async push(
    m: Mapping,
    wanted: Snapshot,
    maps: Mapping[],
    onSubmit: () => void,
  ) {
    if (!this.config.contactsSecret) refuse('WRITE_NOT_CONFIGURED');
    if (m.kind === 'department') {
      if (!wanted.enabled || m.remoteId === '1') refuse('DEPARTMENT_STATE');
      const parent = wanted.parent
        ? maps.find(
            (x) =>
              x.kind === 'department' &&
              x.localId === wanted.parent &&
              x.remoteExists,
          )?.remoteId
        : '1';
      if (!parent || parent === m.remoteId) refuse('MAP_PARENT');
      onSubmit();
      await this.write.call(
        'department/' + (m.remoteExists ? 'update' : 'create'),
        {},
        { id: Number(m.remoteId), name: wanted.name, parentid: Number(parent) },
      );
    } else {
      const departments = wanted.departments?.map(
        (id) =>
          maps.find(
            (x) =>
              x.kind === 'department' && x.localId === id && x.remoteExists,
          )?.remoteId,
      );
      if (!departments?.length || departments.some((x) => !x))
        refuse('MAP_DEPARTMENTS');
      const primary = maps.find(
        (x) =>
          x.kind === 'department' &&
          x.localId === wanted.primary &&
          x.remoteExists,
      )?.remoteId;
      if (!primary) refuse('MAP_DEPARTMENTS');
      onSubmit();
      await this.write.call(
        'user/' + (m.remoteExists ? 'update' : 'create'),
        {},
        {
          userid: m.remoteId,
          name: wanted.name,
          email: wanted.email,
          department: departments.map(Number),
          main_department: Number(primary),
          enable: wanted.enabled ? 1 : 0,
          to_invite: false,
        },
      );
    }
  }
  async sync(
    actor: string,
    id: string,
    fingerprint: string,
    requested: 'auto' | 'pull' | 'push',
  ) {
    const p = await this.preview(id),
      m = p.mapping;
    if (p.fingerprint !== fingerprint) refuse('STALE', 'ABORTED');
    if (['busy', 'unknown'].includes(m.state))
      refuse('RECONCILE_REQUIRED', 'ABORTED');
    const way = requested === 'auto' ? p.suggested : requested;
    if (way === 'conflict') refuse('CONFLICT', 'ABORTED');
    const wanted = way === 'pull' ? p.remote : p.local;
    if (!wanted) refuse('SOURCE_MISSING');
    if (
      way === 'push' &&
      !m.remoteExists &&
      !wanted.parent &&
      m.kind === 'department'
    )
      refuse('MAP_PARENT');
    // Claim before any external write. A crash keeps busy and requires read-only reconciliation, never lease stealing.
    const claimed = await this.org.db.repository<Mapping>(table).updateMany({
      filter: { id, version: m.version, state: m.state },
      values: {
        state: 'busy',
        intent: wanted,
        intentDirection: way,
        version: m.version + 1,
        updatedAt: new Date().toISOString(),
      },
    });
    if (claimed.updatedCount !== 1) refuse('BUSY', 'ABORTED');
    let external = false;
    try {
      const maps = await this.mappings();
      if (way === 'push' && !equal(p.local, p.remote)) {
        await this.push(m, wanted, maps, () => {
          external = true;
        });
      }
      await this.org.db.transaction(async (c) => {
        await this.org.lock(c);
        const current = await this.get(id, c);
        if (current.version !== m.version + 1 || current.state !== 'busy')
          refuse('STALE', 'ABORTED');
        if (!equal(await this.local(m, maps, c), p.local))
          refuse('STALE', 'ABORTED');
        if (way === 'pull' && !equal(p.local, p.remote))
          await this.pull(c, m, wanted, maps, actor);
        await c.repository<Mapping>(table).updateMany({
          filter: { id, version: m.version + 1, state: 'busy' },
          values: {
            localId: m.localId,
            localExists: true,
            remoteExists: true,
            baseline: wanted,
            intent: null,
            state: 'synced',
            error: '',
            updatedAt: new Date().toISOString(),
          },
        });
        await this.audit(c, id, actor, way, 'synced');
      });
      return await this.get(id);
    } catch (e) {
      const uncertain = external && (!(e instanceof WecomError) || e.uncertain);
      const error =
        e instanceof WecomError ? 'REMOTE_' + e.code : 'SYNC_FAILED';
      await this.org.db.transaction(async (c) => {
        await c.repository<Mapping>(table).updateMany({
          filter: { id, version: m.version + 1, state: 'busy' },
          values: {
            state: uncertain ? 'unknown' : 'failed',
            error,
            updatedAt: new Date().toISOString(),
          },
        });
        await this.audit(
          c,
          id,
          actor,
          way,
          uncertain ? 'unknown' : 'failed',
          error,
        );
      });
      refuse(uncertain ? 'UNKNOWN' : 'SYNC_FAILED', 'ABORTED');
    }
  }
  async reconcile(actor: string, id: string) {
    const m = await this.get(id);
    // The network timeout is 12s. Never race a live writer; a busy process death is recoverable after 2 minutes.
    if (m.state === 'busy' && Date.now() - Date.parse(m.updatedAt) < 120000)
      refuse('BUSY', 'ABORTED');
    if (!['busy', 'unknown'].includes(m.state) || !m.intent)
      refuse('RECONCILE_REQUIRED');
    if (m.intentDirection === 'pull' || m.intentDirection === 'equal') {
      // Local changes and mapping completion commit together. Still busy means that transaction did not commit.
      await this.org.db.transaction(async (c) => {
        await this.org.lock(c);
        const res = await c.repository<Mapping>(table).updateMany({
          filter: { id, version: m.version, state: m.state },
          values: {
            state: 'failed',
            intent: null,
            error: 'LOCAL_ROLLED_BACK',
            version: m.version + 1,
            updatedAt: new Date().toISOString(),
          },
        });
        if (res.updatedCount !== 1) refuse('STALE', 'ABORTED');
        await this.audit(
          c,
          id,
          actor,
          'reconcile',
          'failed',
          'LOCAL_ROLLED_BACK',
        );
      });
      return this.get(id);
    }
    const maps = await this.mappings();
    const candidate = { ...m, remoteExists: true };
    const [l, r] = await Promise.all([
      this.local(m, maps),
      this.remote(candidate, maps),
    ]);
    if (!equal(l, m.intent) || !equal(r, m.intent))
      refuse('UNKNOWN', 'ABORTED');
    await this.org.db.transaction(async (c) => {
      const res = await c.repository<Mapping>(table).updateMany({
        filter: { id, version: m.version, state: m.state },
        values: {
          state: 'synced',
          remoteExists: true,
          baseline: m.intent,
          intent: null,
          error: '',
          version: m.version + 1,
          updatedAt: new Date().toISOString(),
        },
      });
      if (res.updatedCount !== 1) refuse('STALE', 'ABORTED');
      await this.audit(c, id, actor, 'reconcile', 'synced');
    });
    return this.get(id);
  }
}
