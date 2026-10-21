import { randomUUID, createHash } from 'node:crypto';
import { ApiError } from '@nocobase/app-server/router';
import type { DatabaseConnection, JsonValue } from '@nocobase/db';
import type { AppAuthorization } from '@nocobase/app-plugin-authorization/server';
import { assetPolicy } from '../providers/assets.js';
import { getAsset, lockProjects } from '../assets/transactions.js';
import { fail, type Access, type HylService } from '../hyl/service.js';
import { RepairService } from '../repairs/service.js';
import { createValues as repairValues } from '../repairs/model.js';
import {
  tables,
  stageActions,
  permission,
  type Kind,
  type RecordRow,
  type Event,
  type PlanValues,
  type Input,
  type ListInput,
} from './model.js';
import { today, addDays, isDue, dispatchWindow } from './calendar.js';
const now = () => new Date().toISOString();
export const str = (v: unknown) => (typeof v === 'string' ? v : '');
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as JsonValue;
const missing = (e: unknown) =>
  e instanceof ApiError &&
  ['PERMISSION_DENIED', 'NOT_FOUND'].includes(e.status);
export type CheckItem = { id: string; name: string; standard: string };
export type Answer = { itemId: string; result: string; note: string };
const items = (r: RecordRow) => r.payload.items as CheckItem[];
const answers = (r: RecordRow) => (r.payload.results ?? []) as Answer[];
const assetIds = (kind: Kind, r: RecordRow) =>
  kind === 'plans' ? (r.payload.assetIds as string[]) : [r.assetId];
export class InspectionService {
  readonly repairs: RepairService;
  private dispatchAfter = '';
  constructor(readonly hyl: HylService) {
    this.repairs = new RepairService(hyl);
  }
  c() {
    return this.hyl.db.connection();
  }
  async policy(access: Access, action: string) {
    const d = await access.authorization.authorize({
      resource: { type: 'composite', id: 'hyl.inspections' },
      action,
    });
    const p = d.conditions?.database?.hylAssets;
    if (d.effect === 'deny' || !p) fail('ACCESS_DENIED', 'PERMISSION_DENIED');
    return p;
  }
  async prepare(access: Access, action: string, ids: string[]) {
    const policy = await this.policy(access, action),
      ap = await assetPolicy(access, 'read'),
      assets = [];
    for (const id of new Set(ids)) {
      await getAsset(this.c(), id, policy);
      assets.push(await getAsset(this.c(), id, ap));
    }
    return { policy, ap, assets };
  }
  async scoped(access: Access, kind: Kind, r: RecordRow, action = 'read') {
    return this.prepare(access, action, assetIds(kind, r));
  }
  async row(kind: Kind, id: string, c = this.c()) {
    const r = await c
      .repository<RecordRow>(tables[kind])
      .findOne({ filter: { id } });
    if (!r) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    return r;
  }
  async person(id: string, c = this.c()) {
    const u = await this.hyl.users.withConnection(c).get(id);
    if (!u || u.disabledAt || u.kind !== 'person')
      fail('INSPECTION_PERSON_INVALID');
    return u;
  }
  async atomic(
    access: Access,
    id: string,
    intent: unknown,
    p: Awaited<ReturnType<InspectionService['prepare']>>,
    fn: (c: DatabaseConnection) => Promise<RecordRow>,
  ) {
    const hash = createHash('sha256')
      .update(JSON.stringify({ actor: access.actor, intent }))
      .digest('hex');
    return this.hyl.db.transaction(async (c) => {
      await lockProjects(
        c,
        p.assets.map((a) => a.projectId),
      );
      for (const a of p.assets) {
        const fresh = await getAsset(c, a.id, p.ap);
        await getAsset(c, a.id, p.policy);
        if (fresh.projectId !== a.projectId)
          fail('INSPECTION_CHANGED', 'ABORTED');
      }
      const ops = c.repository<{
          id: string;
          actor: string;
          hash: string;
          result: RecordRow;
          createdAt: string;
        }>('hylInspectionOperations'),
        prior = await ops.findOne({ filter: { id } });
      if (prior) {
        if (prior.actor !== access.actor || prior.hash !== hash)
          fail('INSPECTION_REQUEST_CONFLICT', 'ALREADY_EXISTS');
        return prior.result;
      }
      const result = await fn(c);
      await ops.createOne({
        values: { id, actor: access.actor, hash, result, createdAt: now() },
      });
      return result;
    });
  }
  base(v: Partial<RecordRow>) {
    const id = v.id ?? randomUUID(),
      at = now();
    return {
      id,
      number: 'XJ-' + id.slice(0, 8).toUpperCase(),
      assetId: '',
      projectId: '',
      planId: '',
      taskId: '',
      repairId: '',
      type: 'inspection',
      title: '',
      day: '',
      dueOn: '',
      assigneeId: '',
      actor: '',
      version: 0,
      generationKey: null,
      activeItemKey: null,
      payload: {},
      createdAt: at,
      updatedAt: at,
      ...v,
    };
  }
  async createRow(
    c: DatabaseConnection,
    kind: Kind,
    values: ReturnType<InspectionService['base']>,
    actor: string,
  ) {
    await this.hyl.runtime.create(tables[kind], values, {
      actor: { id: actor },
      transaction: c,
    });
    const r = await this.row(kind, values.id, c);
    await this.audit(c, kind, r, actor, 'create', '', r.payload);
    return r;
  }
  async audit(
    c: DatabaseConnection,
    kind: Kind,
    r: RecordRow,
    actor: string,
    action: string,
    fromState: string,
    details: unknown,
  ) {
    const u = await this.hyl.users.withConnection(c).get(actor);
    await c.repository('hylInspectionEvents').createOne({
      values: {
        id: randomUUID(),
        recordId: r.id,
        kind,
        version: r.version,
        actor,
        action,
        fromState,
        toState: r.status,
        payload: json({
          details,
          actorName: u?.name ?? '',
          assigneeName: r.payload.assigneeName ?? '',
        }),
        createdAt: now(),
      },
    });
  }
  async save(
    c: DatabaseConnection,
    kind: Kind,
    r: RecordRow,
    action: string,
    actor: string,
    patch: Partial<RecordRow>,
    details: unknown,
  ) {
    await this.hyl.runtime.fire(tables[kind], r.id, action, {
      actor: { id: actor },
      transaction: c,
      expect: { version: r.lifecycleVersion },
    });
    const u = await c.repository(tables[kind]).updateMany({
      filter: { id: r.id, version: r.version },
      values: { ...patch, version: r.version + 1, updatedAt: now() },
    });
    if (u.updatedCount !== 1) fail('INSPECTION_CHANGED', 'ABORTED');
    const out = await this.row(kind, r.id, c);
    await this.audit(c, kind, out, actor, action, r.status, details);
    return out;
  }
  checkVersion(r: RecordRow, expected: number) {
    if (r.version !== expected) fail('INSPECTION_CHANGED', 'ABORTED');
  }
  async create(access: Access, values: PlanValues, requestId: string) {
    const p = await this.prepare(access, 'manage', values.assetIds);
    const r = await this.atomic(
      access,
      requestId,
      { create: values },
      p,
      async (c) => {
        const user = await this.person(values.assigneeId, c);
        for (const a of p.assets)
          if ((await getAsset(c, a.id, p.ap)).state === 'inactive')
            fail('INSPECTION_ASSET_INVALID');
        return this.createRow(
          c,
          'plans',
          this.base({
            title: values.title,
            type: values.type,
            assetId: values.assetIds[0],
            projectId: p.assets[0].projectId,
            assigneeId: values.assigneeId,
            actor: access.actor,
            day: values.start,
            dueOn: values.end,
            payload: {
              ...values,
              items: values.items.map((i, n) => ({
                ...i,
                id: 'item-' + (n + 1),
              })),
              assets: p.assets.map((a) => ({
                id: a.id,
                name: a.name,
                number: a.number,
              })),
              assigneeName: user.name,
              cursor: '',
            },
          }),
          access.actor,
        );
      },
    );
    return this.view(access, 'plans', r);
  }
  async issues(c: DatabaseConnection, taskId: string) {
    return c
      .repository<RecordRow>(tables.issues)
      .findMany({ filter: { taskId } });
  }
  async repairState(access: Access, r: RecordRow) {
    if (!r.repairId) return '';
    await this.repairs.scoped(access, await this.repairs.row(r.repairId));
    return (await this.repairs.row(r.repairId)).status;
  }
  async act(access: Access, kind: Kind, id: string, input: Input) {
    const initial = await this.row(kind, id);
    await this.scoped(access, kind, initial);
    const p = await this.prepare(access, permission(kind, input.action), [
      ...assetIds(kind, initial),
      ...(input.action === 'edit' ? input.values.assetIds : []),
    ]);
    let repairPrepared:
        Awaited<ReturnType<RepairService['prepare']>> | undefined,
      repairStatus = '';
    if (
      kind === 'issues' &&
      ['toRepair', 'rectify', 'pass'].includes(input.action) &&
      initial.repairId
    )
      repairStatus = await this.repairState(access, initial);
    if (input.action === 'report' && input.assigneeId !== initial.assigneeId)
      await this.scoped(access, kind, initial, 'manage');
    if (input.action === 'toRepair') {
      repairPrepared = await this.repairs.prepare(access, 'report', {
        assetId: initial.assetId,
        merchantId: '',
        contractId: '',
      });
      await this.repairs.prepare(access, 'read', {
        assetId: initial.assetId,
        merchantId: '',
        contractId: '',
      });
    }
    const r = await this.atomic(
      access,
      input.requestId,
      { kind, id, input },
      p,
      async (c) => {
        const r = await this.row(kind, id, c);
        this.checkVersion(r, input.expectedVersion);
        if (
          !(
            (stageActions[kind] as Record<string, readonly string[]>)[
              input.action
            ] ?? []
          ).includes(r.status)
        )
          fail('INSPECTION_STAGE_INVALID');
        if (
          ((kind === 'tasks' &&
            ['start', 'save', 'report', 'submit'].includes(input.action)) ||
            (kind === 'issues' && input.action === 'rectify')) &&
          r.assigneeId !== access.actor
        )
          fail('INSPECTION_ASSIGNEE_ONLY', 'PERMISSION_DENIED');
        let patch: Partial<RecordRow> = {};
        const payload = { ...r.payload };
        if (kind === 'plans') {
          if (input.action === 'edit') {
            const u = await this.person(input.values.assigneeId, c);
            for (const assetId of input.values.assetIds)
              if ((await getAsset(c, assetId, p.ap)).state === 'inactive')
                fail('INSPECTION_ASSET_INVALID');
            Object.assign(payload, input.values, {
              items: input.values.items.map((i, n) => ({
                ...i,
                id: 'item-' + (n + 1),
              })),
              assets: p.assets
                .filter((a) => input.values.assetIds.includes(a.id))
                .map((a) => ({ id: a.id, name: a.name, number: a.number })),
              assigneeName: u.name,
            });
            patch = {
              assetId: input.values.assetIds[0],
              projectId: p.assets.find(
                (a) => a.id === input.values.assetIds[0],
              )!.projectId,
              title: input.values.title,
              type: input.values.type,
              day: input.values.start,
              dueOn: input.values.end,
              assigneeId: input.values.assigneeId,
            };
          }
          if (input.action === 'activate') {
            await this.person(r.assigneeId, c);
            if (r.status === 'paused')
              payload.cursor = [str(payload.cursor), addDays(today(), -1)]
                .sort()
                .at(-1);
          }
          if (input.action === 'generate') {
            if (
              input.day > today() ||
              !isDue(
                str(payload.start),
                str(payload.end),
                str(payload.frequency),
                input.day,
              )
            )
              fail('INSPECTION_NOT_DUE');
            payload.generated = await this.generate(
              c,
              r,
              [input.day],
              access.actor,
              p.ap,
            );
          }
        } else if (kind === 'tasks') {
          if (input.action === 'save') {
            const known = items(r).map((i) => i.id),
              old = answers(r),
              issues = await this.issues(c, id);
            for (const a of input.results) {
              if (
                !known.includes(a.itemId) ||
                (a.result === 'notApplicable' && !a.note)
              )
                fail('INSPECTION_RESULTS_INVALID');
              if (
                a.result === 'abnormal' &&
                !issues.some((i) => i.payload.itemId === a.itemId)
              )
                fail('INSPECTION_RESULTS_INVALID');
              if (
                old.some(
                  (o) => o.itemId === a.itemId && o.result === 'abnormal',
                ) &&
                a.result !== 'abnormal'
              )
                fail('INSPECTION_RESULTS_INVALID');
            }
            if (
              old.some(
                (o) =>
                  o.result === 'abnormal' &&
                  !input.results.some((a) => a.itemId === o.itemId),
              )
            )
              fail('INSPECTION_RESULTS_INVALID');
            payload.results = input.results;
          }
          if (input.action === 'report') {
            const item = items(r).find((i) => i.id === input.itemId);
            if (!item) fail('INSPECTION_RESULTS_INVALID');
            const existing = await c
              .repository<RecordRow>(tables.issues)
              .findOne({ filter: { activeItemKey: id + ':' + item.id } });
            if (existing) fail('INSPECTION_ISSUE_EXISTS', 'ALREADY_EXISTS');
            const u = await this.person(input.assigneeId, c);
            if (input.dueOn < today()) fail('INSPECTION_DATE_INVALID');
            const issue = await this.createRow(
              c,
              'issues',
              this.base({
                title: item.name,
                assetId: r.assetId,
                projectId: r.projectId,
                planId: r.planId,
                taskId: id,
                type: r.type,
                day: today(),
                dueOn: input.dueOn,
                assigneeId: u.id,
                actor: access.actor,
                activeItemKey: id + ':' + item.id,
                payload: {
                  itemId: item.id,
                  standard: item.standard,
                  description: input.description,
                  evidence: input.evidence,
                  severity: input.severity,
                  assigneeName: u.name,
                  assetName: r.payload.assetName,
                  planTitle: r.payload.planTitle,
                  taskNumber: r.number,
                  repairHistory: [],
                },
              }),
              access.actor,
            );
            payload.results = [
              ...answers(r).filter((a) => a.itemId !== item.id),
              { itemId: item.id, result: 'abnormal', note: input.description },
            ];
            payload.lastIssueId = issue.id;
          }
          if (
            input.action === 'submit' &&
            items(r).some((i) => !answers(r).some((a) => a.itemId === i.id))
          )
            fail('INSPECTION_RESULTS_INCOMPLETE');
          if (
            ['pass', 'cancel'].includes(input.action) &&
            (await this.issues(c, id)).some((i) => i.status !== 'closed')
          )
            fail('INSPECTION_OPEN_ISSUES');
        } else {
          if (
            ['rectify', 'pass', 'toRepair'].includes(input.action) &&
            r.repairId
          ) {
            const repair = await this.repairs.row(r.repairId, c);
            if (repair.status !== repairStatus)
              fail('INSPECTION_CHANGED', 'ABORTED');
            if (
              input.action === 'toRepair' &&
              !['closed', 'cancelled'].includes(repair.status)
            )
              fail('INSPECTION_REPAIR_PENDING');
            if (input.action !== 'toRepair' && repair.status !== 'closed')
              fail('INSPECTION_REPAIR_PENDING');
          }
          if (input.action === 'rectify') {
            payload.rectification = input.note;
            payload.rectificationEvidence = input.evidence;
          }
          if (input.action === 'pass') {
            payload.recheck = 'note' in input ? input.note : '';
            patch.activeItemKey = null;
          }
          if (input.action === 'return')
            payload.recheck = 'note' in input ? input.note : '';
          if (input.action === 'toRepair') {
            const user = await this.person(access.actor, c),
              values = repairValues.parse({
                title: r.title,
                description: str(payload.description),
                category: r.type === 'cleaning' ? 'other' : 'facility',
                priority: str(payload.severity) || 'normal',
                assetId: r.assetId,
                merchantId: '',
                contractId: '',
                occurredOn: today(),
                reporterName: user.name,
                reporterPhone: '—',
                location: str(payload.assetName),
                evidence: str(payload.evidence),
              });
            const repair = await this.repairs.createPrepared(
              c,
              access,
              values,
              repairPrepared!,
              {
                inspectionIssueId: r.id,
                inspectionTaskId: r.taskId,
                inspectionIssueNumber: r.number,
              },
            );
            patch.repairId = repair.id;
            payload.repairHistory = [
              ...((payload.repairHistory ?? []) as string[]),
              repair.id,
            ];
            payload.repairNumber = repair.number;
          }
        }
        if (input.action === 'assign') {
          const user = await this.person(input.assigneeId, c);
          if (input.dueOn < r.day) fail('INSPECTION_DATE_INVALID');
          patch.assigneeId = user.id;
          patch.dueOn = input.dueOn;
          payload.assigneeName = user.name;
        }
        if (
          ['pass', 'return', 'cancel', 'pause', 'archive', 'activate'].includes(
            input.action,
          ) &&
          'note' in input
        )
          payload.lastDecision = input.note;
        return this.save(
          c,
          kind,
          r,
          input.action,
          access.actor,
          { ...patch, payload: json(payload) as Record<string, unknown> },
          input,
        );
      },
    );
    return this.view(access, kind, r);
  }
  async generate(
    c: DatabaseConnection,
    plan: RecordRow,
    days: string[],
    actor: string,
    ap: Awaited<ReturnType<typeof assetPolicy>>,
  ) {
    const generated: string[] = [];
    await this.person(plan.assigneeId, c);
    for (const day of days) {
      if (
        !isDue(
          str(plan.payload.start),
          str(plan.payload.end),
          str(plan.payload.frequency),
          day,
        )
      )
        continue;
      for (const assetId of assetIds('plans', plan)) {
        const key = plan.id + ':' + day + ':' + assetId,
          old = await c
            .repository<RecordRow>(tables.tasks)
            .findOne({ filter: { generationKey: key } });
        if (old) {
          generated.push(old.id);
          continue;
        }
        const a = await getAsset(c, assetId, ap);
        if (a.state === 'inactive') fail('INSPECTION_ASSET_INVALID');
        const task = await this.createRow(
          c,
          'tasks',
          this.base({
            title: plan.title,
            assetId: a.id,
            projectId: a.projectId,
            planId: plan.id,
            type: plan.type,
            day,
            dueOn: day,
            assigneeId: plan.assigneeId,
            actor,
            generationKey: key,
            payload: {
              assetName: a.name,
              assetNumber: a.number,
              planTitle: plan.title,
              planVersion: plan.version,
              items: plan.payload.items,
              results: [],
              assigneeName: plan.payload.assigneeName,
            },
          }),
          actor,
        );
        generated.push(task.id);
      }
    }
    return generated;
  }
  async tick(authz: AppAuthorization) {
    const pending = (
      await this.c()
        .repository<RecordRow>(tables.plans)
        .findMany({ filter: { status: 'active' } })
    )
      .filter(
        (p) =>
          str(p.payload.start) <= today() &&
          str(p.payload.cursor) < [today(), str(p.payload.end)].sort()[0],
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    // Fair batches: permanently invalid plans must not starve healthy ones. The
    // schedule runs in this process; durable per-plan date cursors recover restarts.
    const start = pending.findIndex((p) => p.id > this.dispatchAfter);
    const ordered =
      start < 0
        ? pending
        : [...pending.slice(start), ...pending.slice(0, start)];
    const plans = ordered.slice(0, 5);
    let count = 0,
      failed = 0;
    for (const plan of plans) {
      if (count >= 100) break;
      this.dispatchAfter = plan.id;
      try {
        await this.person(plan.actor);
        const access: Access = {
          actor: plan.actor,
          authorization: authz.for({
            principal: { type: 'user', id: plan.actor },
            subjects: [
              { type: 'authenticated', id: '*' },
              ...(await authz.subjects.resolveFor({
                type: 'user',
                id: plan.actor,
              })),
            ],
          }),
        };
        const p = await this.scoped(access, 'plans', plan, 'manage');
        const days = dispatchWindow(
          str(plan.payload.cursor),
          str(plan.payload.start),
          str(plan.payload.end),
          today(),
          Math.min(
            31,
            Math.floor((100 - count) / assetIds('plans', plan).length),
          ),
        );
        if (!days.length) continue;
        const result = await this.atomic(
          access,
          randomUUID(),
          { tick: plan.id, version: plan.version, days },
          p,
          async (c) => {
            const fresh = await this.row('plans', plan.id, c);
            this.checkVersion(fresh, plan.version);
            if (fresh.status !== 'active') fail('INSPECTION_STAGE_INVALID');
            const generated = await this.generate(
              c,
              fresh,
              days,
              access.actor,
              p.ap,
            );
            return this.save(
              c,
              'plans',
              fresh,
              'generate',
              access.actor,
              { payload: { ...fresh.payload, cursor: days.at(-1), generated } },
              { automatic: true, days, generated },
            );
          },
        );
        count += ((result.payload.generated ?? []) as string[]).length;
      } catch {
        failed++;
      }
    }
    return { plans: plans.length, tasks: count, failed };
  }
  async view(access: Access, kind: Kind, r: RecordRow) {
    const allowedActions: string[] = [],
      blockedActions: Record<string, string> = {};
    for (const [action, stages] of Object.entries(stageActions[kind]))
      if ((stages as readonly string[]).includes(r.status)) {
        try {
          await this.scoped(access, kind, r, permission(kind, action));
          if (action === 'toRepair') {
            await this.repairs.prepare(access, 'report', {
              assetId: r.assetId,
              merchantId: '',
              contractId: '',
            });
            await this.repairs.prepare(access, 'read', {
              assetId: r.assetId,
              merchantId: '',
              contractId: '',
            });
          }
          allowedActions.push(action);
          if (
            ((kind === 'tasks' &&
              ['start', 'save', 'report', 'submit'].includes(action)) ||
              (kind === 'issues' && action === 'rectify')) &&
            r.assigneeId !== access.actor
          )
            blockedActions[action] = 'INSPECTION_ASSIGNEE_ONLY';
          if (
            kind === 'tasks' &&
            action === 'submit' &&
            items(r).some((i) => !answers(r).some((a) => a.itemId === i.id))
          )
            blockedActions[action] = 'INSPECTION_RESULTS_INCOMPLETE';
          if (
            kind === 'tasks' &&
            ['pass', 'cancel'].includes(action) &&
            (await this.issues(this.c(), r.id)).some(
              (i) => i.status !== 'closed',
            )
          )
            blockedActions[action] = 'INSPECTION_OPEN_ISSUES';
          if (
            kind === 'issues' &&
            ['rectify', 'pass', 'toRepair'].includes(action) &&
            r.repairId
          ) {
            try {
              const status = await this.repairState(access, r);
              if (
                action === 'toRepair'
                  ? !['closed', 'cancelled'].includes(status)
                  : status !== 'closed'
              )
                blockedActions[action] = 'INSPECTION_REPAIR_PENDING';
            } catch (e) {
              if (!missing(e)) throw e;
              blockedActions[action] = 'ACCESS_DENIED';
            }
          }
        } catch (e) {
          if (!missing(e)) throw e;
        }
      }
    return {
      ...r,
      allowedActions,
      blockedActions,
      overdue:
        !!r.dueOn &&
        r.dueOn < today() &&
        !['completed', 'closed', 'cancelled', 'archived'].includes(r.status),
    };
  }
  async detail(access: Access, kind: Kind, id: string, eventPage = 1) {
    const r = await this.row(kind, id);
    await this.scoped(access, kind, r);
    const repo = this.c().repository<Event>('hylInspectionEvents');
    const events = await repo.findMany({
      filter: { recordId: id },
      sort: (s) => [s.field('version').desc()],
      limit: 20,
      offset: (eventPage - 1) * 20,
    });
    return {
      ...(await this.view(access, kind, r)),
      events: {
        data: events,
        meta: {
          page: eventPage,
          pageSize: 20,
          total: await repo.count({ filter: { recordId: id } }),
        },
      },
    };
  }
  async list(access: Access, kind: Kind, input: ListInput) {
    await this.policy(access, 'read');
    const raw = await this.c().repository<RecordRow>(tables[kind]).findMany({}),
      rows: RecordRow[] = [];
    for (const r of raw) {
      if (
        ['status', 'type', 'planId', 'taskId'].some(
          (k) =>
            input[k as keyof ListInput] &&
            r[k as keyof RecordRow] !== input[k as keyof ListInput],
        )
      )
        continue;
      if (input.assetId && !assetIds(kind, r).includes(input.assetId)) continue;
      if (
        input.repairId &&
        r.repairId !== input.repairId &&
        !((r.payload.repairHistory ?? []) as string[]).includes(input.repairId)
      )
        continue;
      if (
        input.mine &&
        (r.assigneeId !== access.actor ||
          ['completed', 'closed', 'cancelled', 'archived'].includes(r.status))
      )
        continue;
      if (
        input.q &&
        ![
          r.number,
          r.title,
          r.payload.assetName,
          ...((r.payload.assets ?? []) as { name: string }[]).map(
            (a) => a.name,
          ),
        ]
          .join(' ')
          .toLowerCase()
          .includes(input.q.toLowerCase())
      )
        continue;
      try {
        await this.scoped(access, kind, r);
        rows.push(r);
      } catch (e) {
        if (!missing(e)) throw e;
      }
    }
    const field = input.order.replace(/^-/, '') as keyof RecordRow,
      dir = input.order.startsWith('-') ? -1 : 1;
    rows.sort(
      (a, b) =>
        dir * str(a[field]).localeCompare(str(b[field])) ||
        a.id.localeCompare(b.id),
    );
    return {
      data: await Promise.all(
        rows
          .slice((input.page - 1) * input.pageSize, input.page * input.pageSize)
          .map((r) => this.view(access, kind, r)),
      ),
      meta: { page: input.page, pageSize: input.pageSize, total: rows.length },
    };
  }
  async assets(access: Access, q: string, page: number) {
    await this.policy(access, 'manage');
    const all = await this.c()
      .repository<{ id: string; number: string; name: string; state: string }>(
        'hylAssets',
      )
      .findMany({});
    const rows = [];
    for (const a of all) {
      if (
        a.state === 'inactive' ||
        ![a.number, a.name].join(' ').toLowerCase().includes(q.toLowerCase())
      )
        continue;
      try {
        await this.prepare(access, 'manage', [a.id]);
        rows.push({ id: a.id, name: a.name, number: a.number });
      } catch (e) {
        if (!missing(e)) throw e;
      }
    }
    rows.sort((a, b) => a.number.localeCompare(b.number));
    return {
      data: rows.slice((page - 1) * 20, page * 20),
      meta: { page, pageSize: 20, total: rows.length },
    };
  }
  async assignees(access: Access, q: string, page: number) {
    await this.policy(access, 'manage');
    const users = await this.hyl.users.list({
      search: q,
      page,
      pageSize: 20,
      status: 'enabled',
      kind: 'person',
    });
    return {
      data: users.items.map((u) => ({ id: u.id, name: u.name })),
      meta: { page: users.page, pageSize: users.pageSize, total: users.total },
    };
  }
}
