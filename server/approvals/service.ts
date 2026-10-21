import { randomUUID, createHash } from 'node:crypto';
import type {
  DatabaseConnection,
  RepositoryPolicy,
  JsonValue,
} from '@nocobase/db';
import {
  type ParameterVersion,
  resolveReviewerSelections,
  ParameterConfigurationError,
} from '@nocobase/lifecycle';
import type { AppAuthorization } from '@nocobase/app-plugin-authorization';
import type { z } from 'zod';
import { ApiError } from '@nocobase/app-server/router';
import type { HylService, Access } from '../hyl/service.js';
import type { Row as Contract } from '../hyl/schema.js';
import { effectiveEnd } from '../leases/model.js';
import { getAsset } from '../assets/transactions.js';
import { saveContractAssets } from '../assets/contracts.js';
import { ApprovalSources, type Source } from './sources.js';
import {
  group,
  type Request,
  type Opinion,
  type Level,
  type Stage,
} from './model.js';
import { parameters, scope } from './parameters.js';
import { refuse, latest } from './gate.js';
import type {
  Kind,
  configSave,
  submission,
  actionInput,
  listInput,
} from './schema.js';
const at = () => new Date().toISOString(),
  json = (v: unknown) => JSON.parse(JSON.stringify(v)) as JsonValue;
const hidden = (e: unknown) =>
  e instanceof ApiError &&
  ['PERMISSION_DENIED', 'NOT_FOUND'].includes(e.status);
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, canonical(x)]),
    );
  return v;
}
const hash = (v: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(v)))
    .digest('hex');
interface Operation {
  id: string;
  actor: string;
  hash: string;
  recordId: string;
  createdAt: string;
}
type Decision = z.infer<typeof actionInput>;
export class ApprovalService {
  readonly sources: ApprovalSources;
  readonly store: ReturnType<typeof parameters>;
  constructor(
    readonly hyl: HylService,
    readonly authz: AppAuthorization,
  ) {
    this.sources = new ApprovalSources(hyl);
    this.store = parameters(hyl.db);
  }
  c() {
    return this.hyl.db.connection();
  }
  async policy(access: Access, action: string) {
    const d = await access.authorization.authorize({
        resource: { type: 'composite', id: 'hyl.approvals' },
        action,
      }),
      p = d.conditions?.database?.hylAssets;
    if (d.effect === 'deny' || !p)
      refuse('APPROVAL_ACCESS_DENIED', 'PERMISSION_DENIED');
    return p;
  }
  async project(
    access: Access,
    action: string,
    id: string,
    c = this.c(),
    p?: RepositoryPolicy,
  ) {
    const policy = p ?? (await this.policy(access, action)),
      r = await getAsset(c, id, policy);
    if (r.type !== 'project') refuse('APPROVAL_PROJECT_REQUIRED');
    return r;
  }
  async projects(access: Access, action = 'read') {
    const p = await this.policy(access, action);
    return (
      await this.c()
        .repository<{ id: string; name: string; type: string }>('hylAssets')
        .withPolicy(p)
        .findMany({})
    )
      .filter((r) => r.type === 'project')
      .map((r) => ({ id: r.id, name: r.name }));
  }
  async people(access: Access, q: string, page: number) {
    await this.policy(access, 'configure');
    const r = await this.hyl.users.list({
      page,
      pageSize: 20,
      search: q,
      status: 'enabled',
    });
    return {
      data: r.items
        .filter((u) => u.kind === 'person')
        .map((u) => ({ id: u.id, name: u.name })),
      meta: { page: r.page, pageSize: r.pageSize, total: r.total },
    };
  }
  async config(
    access: Access,
    projectId: string,
    kind: Kind,
    saved?: ParameterVersion,
  ) {
    const p = await this.project(access, 'read', projectId),
      v = saved ?? (await this.store.read(scope(projectId, kind), 'approval'));
    const levels = (v?.values.levels ?? []) as unknown as Level[];
    const names = [];
    for (const l of levels) {
      const users = [];
      for (const r of l.reviewers) {
        const u = await this.hyl.users.get(r.referenceId);
        users.push({
          id: r.referenceId,
          name: u?.name ?? r.referenceId,
          active: !!u && !u.disabledAt && u.kind === 'person',
        });
      }
      names.push({
        name: l.name,
        userIds: l.reviewers.map((x) => x.referenceId),
        users,
      });
    }
    return {
      id: scope(projectId, kind),
      projectId,
      projectName: p.name,
      kind,
      revision: v?.revision ?? 0,
      enabled: v?.values.enabled === true,
      levels: names,
      updatedAt: v?.at ?? '',
    };
  }
  async configs(access: Access) {
    await this.policy(access, 'read');
    const heads = await this.c()
        .repository<{ scope: string }>('hylApprovalParameterHeads')
        .findMany({}),
      data = [];
    for (const h of heads) {
      const [id, kind] = h.scope.split(':');
      if (!['contracts', 'bills', 'purchases'].includes(kind)) continue;
      try {
        data.push(await this.config(access, id, kind as Kind));
      } catch (e) {
        if (!hidden(e)) throw e;
      }
    }
    return data.sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
    );
  }
  async saveConfig(access: Access, input: z.infer<typeof configSave>) {
    await this.project(access, 'read', input.projectId);
    const p = await this.policy(access, 'configure');
    await this.project(access, 'configure', input.projectId, undefined, p);
    try {
      const saved = await this.hyl.db.transaction(async (c) => {
        await this.project(access, 'configure', input.projectId, c, p);
        for (const l of input.values.levels)
          for (const id of l.userIds) {
            const u = await this.hyl.users.withConnection(c).get(id);
            if (!u || u.disabledAt || u.kind !== 'person')
              refuse('APPROVAL_PERSON_INVALID');
          }
        return this.store.save(
          {
            scope: scope(input.projectId, input.kind),
            group,
            values: {
              enabled: input.values.enabled,
              levels: input.values.levels.map((l) => ({
                name: l.name,
                reviewers: l.userIds.map((id, group) => ({
                  group: group + 1,
                  type: 'user',
                  referenceId: id,
                })),
              })),
            },
            expectedRevision: input.expectedRevision,
            requestId: input.requestId,
            actorId: access.actor,
            at: at(),
          },
          c,
        );
      });
      return this.config(access, input.projectId, input.kind, saved);
    } catch (e) {
      if (e instanceof ParameterConfigurationError)
        refuse(
          'APPROVAL_' + e.code,
          e.code.includes('CONFLICT') ? 'ABORTED' : 'FAILED_PRECONDITION',
        );
      throw e;
    }
  }
  async accessFor(id: string): Promise<Access> {
    return {
      actor: id,
      authorization: this.authz.for({
        principal: { type: 'user', id },
        subjects: [
          { type: 'authenticated', id: '*' },
          ...(await this.authz.subjects.resolveFor({ type: 'user', id })),
        ],
      }),
    };
  }
  async stageCandidates(
    access: Access,
    s: Source,
    levels: Level[],
  ): Promise<Stage[]> {
    const stages: Stage[] = [];
    for (const l of levels) {
      const ids = await resolveReviewerSelections(
        l.reviewers,
        { scope: scope(s.projectId, s.kind), applicantId: access.actor },
        {
          selectors: { user: async (id) => [id] },
          eligible: async (id) => {
            const u = await this.hyl.users.get(id);
            if (
              !u ||
              u.disabledAt ||
              u.kind !== 'person' ||
              id === access.actor
            )
              return false;
            try {
              const a = await this.accessFor(id);
              await this.project(a, 'decide', s.projectId);
              await this.sources.load(a, s.kind, s.id, 'decide');
              return true;
            } catch (e) {
              if (hidden(e)) return false;
              throw e;
            }
          },
        },
      );
      if (!ids.length) refuse('APPROVAL_NO_CANDIDATE');
      const candidates = [];
      for (const id of ids)
        candidates.push({ id, name: (await this.hyl.users.get(id))!.name });
      stages.push({ name: l.name, candidates });
    }
    return stages;
  }
  async row(id: string, c = this.c()) {
    const r = await c
      .repository<Request>('hylApprovalRequests')
      .findOne({ filter: { id } });
    if (!r) refuse('APPROVAL_NOT_FOUND', 'NOT_FOUND');
    return r;
  }
  async operation(access: Access, id: string, intent: unknown, c = this.c()) {
    const r = await c
      .repository<Operation>('hylApprovalOperations')
      .findOne({ filter: { id } });
    if (r && (r.actor !== access.actor || r.hash !== hash(intent)))
      refuse('APPROVAL_REQUEST_REUSED', 'ALREADY_EXISTS');
    return r;
  }
  async remember(
    c: DatabaseConnection,
    access: Access,
    id: string,
    intent: unknown,
    recordId: string,
  ) {
    await c.repository<Operation>('hylApprovalOperations').createOne({
      values: {
        id,
        actor: access.actor,
        hash: hash(intent),
        recordId,
        createdAt: at(),
      },
    });
  }
  async event(
    c: DatabaseConnection,
    r: Request,
    access: Access,
    action: string,
    comment: string,
    level = r.level,
  ) {
    const u = await this.hyl.users.withConnection(c).get(access.actor);
    await c.repository<Opinion>('hylApprovalOpinions').createOne({
      values: {
        id: randomUUID(),
        requestId: r.id,
        round: r.round,
        level,
        actor: access.actor,
        action,
        comment,
        payload: {
          actorName: u?.name ?? access.actor,
          levelName: r.payload.stages[level]?.name ?? '',
          sourceVersion: r.sourceVersion,
          stages: action === 'submit' ? r.payload.stages : [],
        },
        createdAt: at(),
      },
    });
  }
  async transition(
    c: DatabaseConnection,
    r: Request,
    access: Access,
    action: string,
    patch: Partial<Request>,
  ) {
    await this.hyl.runtime.fire('hylApprovalRequests', r.id, action, {
      actor: { id: access.actor },
      transaction: c,
      expect: { version: r.lifecycleVersion },
    });
    const u = await c.repository<Request>('hylApprovalRequests').updateMany({
      filter: { id: r.id, version: r.version },
      values: { ...patch, version: r.version + 1, updatedAt: at() },
    });
    if (u.updatedCount !== 1) refuse('APPROVAL_CHANGED', 'ABORTED');
    return this.row(r.id, c);
  }
  async sourceView(access: Access, kind: Kind, id: string) {
    await this.policy(access, 'read');
    const s = await this.sources.load(access, kind, id);
    if (!s.projectId)
      return {
        ...this.publicSource(s),
        required: false,
        request: null,
        canSubmit: false,
        levels: [],
      };
    await this.project(access, 'read', s.projectId);
    const r = await latest(this.c(), kind, id),
      v = r
        ? await this.store.snapshot(r.scope, 'hylApprovalRequests', r.id)
        : await this.store.read(scope(s.projectId, kind), 'approval'),
      values = v ? ('values' in v ? v.values : {}) : {},
      enabled = values.enabled === true;
    let canSubmit = false;
    try {
      await this.project(access, 'submit', s.projectId);
      await this.sources.load(access, kind, id, 'submit');
      canSubmit =
        (kind === 'contracts'
          ? s.status === 'draft'
          : kind === 'bills'
            ? s.status === 'draft'
            : ['draft', 'returned', 'pending'].includes(s.status)) &&
        (!r || (r.status === 'rejected' && r.applicantId === access.actor)) &&
        enabled;
    } catch (e) {
      if (!hidden(e)) throw e;
    }
    return {
      ...this.publicSource(s),
      required: enabled || !!r,
      request: r
        ? { id: r.id, status: r.status, level: r.level, round: r.round }
        : null,
      canSubmit,
      levels: ((values.levels ?? []) as unknown as Level[]).map((l) => ({
        name: l.name,
        count: l.reviewers.length,
      })),
    };
  }
  publicSource(s: Source) {
    return {
      kind: s.kind,
      id: s.id,
      projectId: s.projectId,
      number: s.number,
      title: s.title,
      version: s.version,
      status: s.status,
      path: s.path,
      snapshot: s.snapshot,
    };
  }
  async submit(access: Access, input: z.infer<typeof submission>) {
    await this.policy(access, 'read');
    await this.policy(access, 'submit');
    const s = await this.sources.load(
        access,
        input.kind,
        input.sourceId,
        'submit',
      ),
      p = await this.policy(access, 'submit');
    await this.project(access, 'submit', s.projectId, undefined, p);
    const oldOp = await this.operation(access, input.requestId, {
      submit: input,
    });
    if (oldOp) return this.detail(access, oldOp.recordId);
    const prior = await latest(this.c(), input.kind, input.sourceId);
    if (
      prior &&
      !(prior.status === 'rejected' && prior.applicantId === access.actor)
    )
      refuse('APPROVAL_ALREADY_SUBMITTED');
    const config = prior
      ? await this.store.snapshot(prior.scope, 'hylApprovalRequests', prior.id)
      : await this.store.read(scope(s.projectId, s.kind), 'approval');
    if (!config || config.values.enabled !== true) refuse('APPROVAL_DISABLED');
    if (prior && prior.projectId !== s.projectId)
      refuse('APPROVAL_SOURCE_CHANGED', 'ABORTED');
    const stages = await this.stageCandidates(
        access,
        s,
        config.values.levels as unknown as Level[],
      ),
      revision = prior
        ? prior.payload.configRevision
        : 'revision' in config
          ? config.revision
          : 0,
      id = prior?.id ?? randomUUID();
    const start = async (c: DatabaseConnection, fresh: Source) => {
      await this.project(access, 'submit', s.projectId, c, p);
      if (await this.operation(access, input.requestId, { submit: input }, c))
        return;
      const existing = await latest(c, s.kind, s.id);
      if (existing?.id !== prior?.id || existing?.version !== prior?.version)
        refuse('APPROVAL_CHANGED', 'ABORTED');
      if (!prior) {
        const v = await this.store.read(
          scope(s.projectId, s.kind),
          'approval',
          c,
        );
        if (v?.revision !== revision)
          refuse('APPROVAL_CONFIGURATION_CONFLICT', 'ABORTED');
      }
      for (const stage of stages)
        for (const candidate of stage.candidates) {
          const u = await this.hyl.users.withConnection(c).get(candidate.id);
          if (!u || u.disabledAt || u.kind !== 'person')
            refuse('APPROVAL_PERSON_INVALID');
        }
      const payload = {
        number: fresh.number,
        title: fresh.title,
        source: fresh.snapshot,
        stages,
        configRevision: revision,
        comment: input.comment,
      };
      let request: Request;
      if (prior) {
        request = await this.transition(
          c,
          await this.row(id, c),
          access,
          'submit',
          {
            level: 0,
            round: prior.round + 1,
            sourceVersion: fresh.version,
            payload,
          },
        );
      } else {
        const when = at();
        await this.hyl.runtime.create(
          'hylApprovalRequests',
          {
            id,
            kind: s.kind,
            sourceId: s.id,
            projectId: s.projectId,
            scope: scope(s.projectId, s.kind),
            applicantId: access.actor,
            version: 0,
            round: 1,
            level: 0,
            sourceVersion: fresh.version,
            payload: json(payload),
            createdAt: when,
            updatedAt: when,
          },
          { actor: { id: access.actor }, transaction: c },
        );
        request = await this.transition(
          c,
          await this.row(id, c),
          access,
          'submit',
          {},
        );
      }
      await this.event(c, request, access, 'submit', input.comment);
      await this.remember(c, access, input.requestId, { submit: input }, id);
    };
    if (s.kind === 'purchases' && ['draft', 'returned'].includes(s.status)) {
      if (s.version !== input.expectedVersion)
        refuse('APPROVAL_SOURCE_CHANGED', 'ABORTED');
      await this.sources.procurement.act(
        access,
        'requests',
        s.id,
        {
          action: 'submit',
          requestId: input.requestId,
          expectedVersion: s.version,
          note: input.comment,
        },
        {
          after: async (c, r) =>
            start(c, this.sources.purchase(r, s.assetsPolicy, s.domainPolicy!)),
        },
      );
    } else
      await this.hyl.db.transaction(async (c) => {
        await this.sources.lock(c, s);
        const fresh = await this.sources.fresh(c, s, access);
        if (fresh.version !== input.expectedVersion)
          refuse('APPROVAL_SOURCE_CHANGED', 'ABORTED');
        if (
          s.kind === 'purchases'
            ? fresh.status !== 'pending'
            : fresh.status !== 'draft'
        )
          refuse('APPROVAL_SOURCE_STATE');
        await start(c, fresh);
      });
    return this.detail(access, id);
  }
  async visible(access: Access, r: Request, mode: 'read' | 'decide' = 'read') {
    await this.project(access, mode, r.projectId);
    try {
      return await this.sources.load(access, r.kind, r.sourceId, mode);
    } catch (e) {
      if (hidden(e)) refuse('APPROVAL_NOT_FOUND', 'NOT_FOUND');
      throw e;
    }
  }
  async detail(
    access: Access,
    id: string,
    eventPage = 1,
    eventOrder = '-createdAt',
  ) {
    await this.policy(access, 'read');
    const r = await this.row(id);
    const s = await this.visible(access, r);
    let canDecide = false,
      canCancel = false;
    if (
      r.status === 'pending' &&
      r.payload.stages[r.level]?.candidates.some(
        (x) => x.id === access.actor,
      ) &&
      r.applicantId !== access.actor
    ) {
      try {
        await this.visible(access, r, 'decide');
        const u = await this.hyl.users.get(access.actor);
        canDecide = !!u && !u.disabledAt && u.kind === 'person';
      } catch (e) {
        if (!hidden(e)) throw e;
      }
    }
    if (['pending', 'rejected'].includes(r.status)) {
      try {
        await this.project(access, 'cancel', r.projectId);
        canCancel = true;
      } catch (e) {
        if (!hidden(e)) throw e;
      }
    }
    const repo = this.c().repository<Opinion>('hylApprovalOpinions'),
      events = await repo.findMany({
        filter: { requestId: id },
        sort: (o) =>
          eventOrder === 'createdAt'
            ? [o.field('createdAt').asc(), o.field('id').asc()]
            : [o.field('createdAt').desc(), o.field('id').desc()],
        offset: (eventPage - 1) * 20,
        limit: 20,
      }),
      u = await this.hyl.users.get(r.applicantId);
    return {
      ...r,
      applicantName: u?.name ?? r.applicantId,
      sourcePath: s.path,
      currentSourceVersion: s.version,
      canDecide,
      canCancel,
      canResubmit: r.status === 'rejected' && r.applicantId === access.actor,
      events: {
        data: events,
        meta: {
          page: eventPage,
          pageSize: 20,
          total: await repo.count({ filter: { requestId: id } }),
        },
      },
    };
  }
  async list(access: Access, input: z.infer<typeof listInput>) {
    await this.policy(access, 'read');
    const rows = await this.c()
        .repository<Request>('hylApprovalRequests')
        .findMany({}),
      views = [];
    for (const r of rows) {
      if (
        (input.kind && r.kind !== input.kind) ||
        (input.status && r.status !== input.status) ||
        (input.view === 'submitted' && r.applicantId !== access.actor)
      )
        continue;
      if (
        input.q &&
        !(r.payload.number + ' ' + r.payload.title)
          .toLowerCase()
          .includes(input.q.toLowerCase())
      )
        continue;
      try {
        const v = await this.detail(access, r.id);
        if (input.view === 'pending' && !v.canDecide) continue;
        views.push(v);
      } catch (e) {
        if (!hidden(e)) throw e;
      }
    }
    const field = input.order.replace('-', '') as 'updatedAt' | 'createdAt',
      dir = input.order.startsWith('-') ? -1 : 1;
    views.sort(
      (a, b) =>
        dir * a[field].localeCompare(b[field]) || a.id.localeCompare(b.id),
    );
    return {
      data: views
        .slice((input.page - 1) * input.pageSize, input.page * input.pageSize)
        .map(({ events: _e, ...r }) => r),
      meta: { page: input.page, pageSize: input.pageSize, total: views.length },
    };
  }
  async consume(
    c: DatabaseConnection,
    access: Access,
    initial: Request,
    s: Source,
    input: Decision,
  ) {
    const op = await this.operation(
      access,
      input.requestId,
      { id: initial.id, ...input },
      c,
    );
    if (op) return this.row(initial.id, c);
    const r = await this.row(initial.id, c);
    if (
      r.version !== input.expectedVersion ||
      r.status !== initial.status ||
      r.level !== initial.level
    )
      refuse('APPROVAL_CHANGED', 'ABORTED');
    if (
      input.action !== 'cancel' &&
      (s.version !== r.sourceVersion ||
        hash(s.snapshot) !== hash(r.payload.source))
    )
      refuse('APPROVAL_SOURCE_CHANGED', 'ABORTED');
    if (
      input.action !== 'cancel' &&
      (r.status !== 'pending' ||
        r.applicantId === access.actor ||
        !r.payload.stages[r.level]?.candidates.some(
          (x) => x.id === access.actor,
        ))
    )
      refuse('APPROVAL_NOT_YOUR_LEVEL', 'PERMISSION_DENIED');
    const u = await this.hyl.users.withConnection(c).get(access.actor);
    if (!u || u.disabledAt || u.kind !== 'person')
      refuse('APPROVAL_PERSON_INVALID');
    const advance =
        input.action === 'approve' && r.level < r.payload.stages.length - 1,
      action = advance ? 'advance' : input.action,
      out = await this.transition(
        c,
        r,
        access,
        action,
        advance ? { level: r.level + 1 } : {},
      );
    await this.event(c, out, access, input.action, input.comment, r.level);
    await this.remember(
      c,
      access,
      input.requestId,
      { id: r.id, ...input },
      r.id,
    );
    return out;
  }
  async decide(access: Access, id: string, input: Decision) {
    await this.policy(access, 'read');
    await this.policy(access, input.action === 'cancel' ? 'cancel' : 'decide');
    const initial = await this.row(id);
    await this.project(
      access,
      input.action === 'cancel' ? 'cancel' : 'decide',
      initial.projectId,
    );
    const s = await this.sources.load(
      access,
      initial.kind,
      initial.sourceId,
      input.action === 'cancel' ? 'read' : 'decide',
    );
    if (await this.operation(access, input.requestId, { id, ...input }))
      return this.detail(access, id);
    if (initial.version !== input.expectedVersion)
      refuse('APPROVAL_CHANGED', 'ABORTED');
    if (input.action === 'cancel') {
      if (!['pending', 'rejected'].includes(initial.status))
        refuse('APPROVAL_SOURCE_STATE');
    } else if (
      initial.status !== 'pending' ||
      !initial.payload.stages[initial.level]?.candidates.some(
        (c) => c.id === access.actor,
      ) ||
      initial.applicantId === access.actor
    )
      refuse('APPROVAL_NOT_YOUR_LEVEL', 'PERMISSION_DENIED');
    const last =
      input.action === 'approve' &&
      initial.level === initial.payload.stages.length - 1;
    if (last && s.kind === 'bills')
      await this.sources.billing.billAction(
        access,
        s.id,
        'issue',
        {
          requestId: input.requestId,
          expectedVersion: initial.sourceVersion,
          amount: '',
          reference: '',
          reason: input.comment,
          evidence: '',
          allocations: [],
        },
        async (c) => {
          const fresh = await this.sources.fresh(c, s, access);
          await this.consume(c, access, initial, fresh, input);
        },
      );
    else if (s.kind === 'purchases' && (last || input.action === 'reject'))
      await this.sources.procurement.act(
        access,
        'requests',
        s.id,
        {
          action: last ? 'approve' : 'return',
          requestId: input.requestId,
          expectedVersion: initial.sourceVersion,
          note: input.comment,
        },
        {
          before: async (c) => {
            await this.consume(
              c,
              access,
              initial,
              await this.sources.fresh(c, s, access),
              input,
            );
          },
        },
      );
    else
      await this.hyl.db.transaction(async (c) => {
        await this.sources.lock(c, s);
        const fresh = await this.sources.fresh(c, s, access);
        await this.consume(c, access, initial, fresh, input);
        if (last && s.kind === 'contracts')
          await this.activate(c, access, fresh);
      });
    return this.detail(access, id);
  }
  async activate(c: DatabaseConnection, access: Access, s: Source) {
    const r = await this.hyl.get(
      access,
      'contracts',
      s.id,
      'write',
      c,
      s.policy,
    );
    if (r.status !== 'draft') refuse('APPROVAL_SOURCE_STATE');
    const merchant = await c
      .repository<Contract>('hylMerchants')
      .findOne({ filter: { id: r.merchantId } });
    if (!merchant || merchant.status !== 'active') refuse('MERCHANT_INACTIVE');
    for (const other of await c
      .repository<Contract>('hylContracts')
      .findMany({ filter: { merchantId: r.merchantId, status: 'active' } })) {
      if (
        other.id !== r.id &&
        String(other.payload.start) <= String(r.payload.end) &&
        (await effectiveEnd(c, other)) >= String(r.payload.start)
      )
        refuse('CONTRACT_OVERLAP');
    }
    // Reserve the source version through this reviewer's actual update policy before any lifecycle effect.
    const changed = await c
      .repository<Contract>('hylContracts')
      .withPolicy(s.policy)
      .updateMany({
        filter: { id: r.id, version: r.version, status: 'draft' },
        values: { version: r.version + 1, updatedAt: at() },
      });
    if (changed.updatedCount !== 1) refuse('APPROVAL_CHANGED', 'ABORTED');
    await saveContractAssets(
      c,
      r,
      Array.isArray(r.payload.assetIds) ? r.payload.assetIds.map(String) : [],
      s.assetsPolicy,
      access.actor,
    );
    await this.hyl.runtime.fire('hylContracts', r.id, 'activate', {
      actor: { id: access.actor },
      transaction: c,
      expect: { version: r.lifecycleVersion },
    });
    await this.hyl.runtime.create(
      'hylLeases',
      {
        id: r.id,
        merchantId: r.merchantId,
        version: 0,
        actualEnd: '',
        payload: {},
      },
      { actor: { id: access.actor }, transaction: c },
    );
  }
}
