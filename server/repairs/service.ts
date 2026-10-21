import { linkPhotos, readPhotos, photoIds } from './photos.js';
import { procurementRepairBlock } from '../procurement/repair-guard.js';
import { randomUUID, createHash } from 'node:crypto';
import { ApiError } from '@nocobase/app-server/router';
import type { DatabaseConnection, JsonValue } from '@nocobase/db';
import { assetPolicy } from '../providers/assets.js';
import { getAsset, lockProjects } from '../assets/transactions.js';
import type { Binding } from '../assets/schema.js';
import { fail, type HylService, type Access } from '../hyl/service.js';
import { cents } from '../hyl/calculation.js';
import { effectiveEnd } from '../leases/model.js';
import {
  actionPermission,
  transitions,
  type Action,
  type CreateValues,
  type ListInput,
  type RepairOrder,
  type RepairEvent,
} from './model.js';
const now = () => new Date().toISOString();
export const repairToday = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const s = (v: unknown) => (typeof v === 'string' ? v : '');
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as JsonValue;
export class RepairService {
  constructor(
    readonly hyl: HylService,
    readonly basePath = '',
  ) {}
  c() {
    return this.hyl.db.connection();
  }
  async permission(access: Access, action: string) {
    const d = await access.authorization.authorize({
      resource: { type: 'composite', id: 'hyl.repairs' },
      action,
    });
    const p = d.conditions?.database?.hylAssets;
    if (d.effect === 'deny' || !p) fail('ACCESS_DENIED', 'PERMISSION_DENIED');
    return p;
  }
  async prepare(
    access: Access,
    action: string,
    ids: { assetId: string; merchantId: string; contractId: string },
  ) {
    const rp = await this.permission(access, action),
      ap = await assetPolicy(access, 'read');
    const asset = await getAsset(this.c(), ids.assetId, ap);
    await getAsset(this.c(), ids.assetId, rp);
    const mp = ids.merchantId
      ? await this.hyl.policy(access, 'merchants', 'read')
      : undefined;
    const cp = ids.contractId
      ? await this.hyl.policy(access, 'contracts', 'read')
      : undefined;
    const merchant = mp
      ? await this.hyl.get(
          access,
          'merchants',
          ids.merchantId,
          'read',
          this.c(),
          mp,
        )
      : undefined;
    const contract = cp
      ? await this.hyl.get(
          access,
          'contracts',
          ids.contractId,
          'read',
          this.c(),
          cp,
        )
      : undefined;
    return { rp, ap, asset, mp, cp, merchant, contract };
  }
  async row(id: string, c = this.c()) {
    const r = await c
      .repository<RepairOrder>('hylRepairOrders')
      .findOne({ filter: { id } });
    if (!r) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    return r;
  }
  async scoped(access: Access, r: RepairOrder, action = 'read') {
    return this.prepare(access, action, r);
  }
  async atomic(
    access: Access,
    requestId: string,
    intent: unknown,
    p: Awaited<ReturnType<RepairService['prepare']>>,
    fn: (c: DatabaseConnection) => Promise<RepairOrder>,
  ) {
    const hash = createHash('sha256')
      .update(JSON.stringify({ actor: access.actor, intent }))
      .digest('hex');
    return this.hyl.db.transaction(async (c) => {
      if (p.merchant) await this.hyl.lockMerchant(c, p.merchant.id);
      await lockProjects(c, [p.asset.projectId]);
      const a = await getAsset(c, p.asset.id, p.ap);
      await getAsset(c, p.asset.id, p.rp);
      if (a.projectId !== p.asset.projectId) fail('REPAIR_CHANGED', 'ABORTED');
      if (p.mp && p.merchant)
        await this.hyl.get(access, 'merchants', p.merchant.id, 'read', c, p.mp);
      if (p.cp && p.contract)
        await this.hyl.get(access, 'contracts', p.contract.id, 'read', c, p.cp);
      const repo = c.repository<{
        id: string;
        actor: string;
        hash: string;
        result: RepairOrder;
        createdAt: string;
      }>('hylRepairOperations');
      const prior = await repo.findOne({ filter: { id: requestId } });
      if (prior) {
        if (prior.actor !== access.actor || prior.hash !== hash)
          fail('REPAIR_REQUEST_CONFLICT', 'ALREADY_EXISTS');
        return prior.result;
      }
      const result = await fn(c);
      await repo.createOne({
        values: {
          id: requestId,
          actor: access.actor,
          hash,
          result,
          createdAt: now(),
        },
      });
      return result;
    });
  }
  async event(
    c: DatabaseConnection,
    r: RepairOrder,
    actor: string,
    action: string,
    fromState: string,
    details: Record<string, unknown>,
  ) {
    const user = await this.hyl.users.withConnection(c).get(actor);
    await c.repository('hylRepairEvents').createOne({
      values: {
        id: randomUUID(),
        orderId: r.id,
        actor,
        action,
        fromState,
        toState: r.status,
        payload: json({
          ...details,
          actorName: user?.name ?? '',
          assigneeName: r.payload.assigneeName ?? '',
          dueOn: r.dueOn,
          version: r.version,
        }),
        createdAt: now(),
      },
    });
  }
  async create(access: Access, values: CreateValues, requestId: string) {
    // Contract determines merchant identity; caller cannot attach a mismatched merchant.
    if (values.contractId) {
      const contract = await this.hyl.get(
        access,
        'contracts',
        values.contractId,
      );
      if (values.merchantId && values.merchantId !== contract.merchantId)
        fail('REPAIR_LINK_INVALID');
      values = { ...values, merchantId: contract.merchantId };
    }
    const p = await this.prepare(access, 'report', values);
    const result = await this.atomic(
      access,
      requestId,
      { create: values },
      p,
      (c) => this.createPrepared(c, access, values, p),
    );
    return this.view(access, result);
  }
  /** Internal transaction-bound creation; callers resolve permissions and lock the asset first. */
  async createPrepared(
    c: DatabaseConnection,
    access: Access,
    values: CreateValues,
    p: Awaited<ReturnType<RepairService['prepare']>>,
    origin: Record<string, string> = {},
  ) {
    await getAsset(c, values.assetId, p.rp);

    const asset = await getAsset(c, values.assetId, p.ap);
    if (asset.state === 'inactive' || values.occurredOn > repairToday())
      fail('REPAIR_LINK_INVALID');
    if (values.merchantId) {
      const bindings = await c
        .repository<Binding>('hylAssetBindings')
        .findMany({
          filter: { assetId: asset.id, merchantId: values.merchantId },
        });
      if (
        !bindings.some(
          (b) =>
            b.start <= values.occurredOn &&
            (!b.end || b.end >= values.occurredOn),
        )
      )
        fail('REPAIR_LINK_INVALID');
    }
    if (p.contract) {
      const contract = await this.hyl.get(
        access,
        'contracts',
        p.contract.id,
        'read',
        c,
        p.cp,
      );
      const links = await c
        .repository<{
          contractId: string;
          assetId: string;
          start: string;
          end: string;
        }>('hylContractAssets')
        .findMany({ filter: { contractId: contract.id } });
      if (
        values.occurredOn < s(contract.payload.start) ||
        values.occurredOn > (await effectiveEnd(c, contract)) ||
        !links.some(
          (l) =>
            l.assetId === asset.id &&
            l.start <= values.occurredOn &&
            l.end >= values.occurredOn,
        )
      )
        fail('REPAIR_LINK_INVALID');
    }
    const id = randomUUID(),
      at = now();
    const record = {
      id,
      number: 'BX-' + id.slice(0, 8).toUpperCase(),
      assetId: asset.id,
      projectId: asset.projectId,
      merchantId: values.merchantId,
      contractId: values.contractId,
      title: values.title,
      category: values.category,
      priority: values.priority,
      occurredOn: values.occurredOn,
      dueOn: '',
      assigneeId: '',
      costCents: '0',
      actor: access.actor,
      version: 0,
      payload: {
        ...values,
        assetName: asset.name,
        assetNumber: asset.number,
        merchantName: s(p.merchant?.payload.name),
        contractNumber: p.contract?.number ?? '',
        assigneeName: '',
        ...origin,
      },
      createdAt: at,
      updatedAt: at,
    };
    await linkPhotos(
      c,
      values.reportPhotoIds ?? [],
      access.actor,
      asset.id,
      id,
      'report',
    );
    await this.hyl.runtime.create('hylRepairOrders', record, {
      actor: { id: access.actor },
      transaction: c,
    });
    const r = await this.row(id, c);
    await this.event(c, r, access.actor, 'create', '', {
      values,
      assetName: asset.name,
      merchantName: p.merchant?.payload.name ?? '',
      contractNumber: p.contract?.number ?? '',
    });
    return r;
  }
  async act(access: Access, id: string, input: Action) {
    const initial = await this.row(id);
    await this.scoped(access, initial);
    const p = await this.scoped(
      access,
      initial,
      actionPermission[input.action],
    );
    const result = await this.atomic(
      access,
      input.requestId,
      { id, input },
      p,
      async (c) => {
        const r = await this.row(id, c);
        if (r.version !== input.expectedVersion)
          fail('REPAIR_CHANGED', 'ABORTED');
        if (
          !(transitions[input.action] as readonly string[]).includes(r.status)
        )
          fail('REPAIR_STAGE_INVALID');
        if (
          ['start', 'progress', 'complete'].includes(input.action) &&
          r.assigneeId !== access.actor
        )
          fail('REPAIR_ASSIGNEE_ONLY', 'PERMISSION_DENIED');
        const procurementBlock = await procurementRepairBlock(
          c,
          r.id,
          input.action,
        );
        if (procurementBlock) fail(procurementBlock);
        let patch: Partial<RepairOrder> = {};
        const payload = { ...r.payload };
        if (input.action === 'edit') {
          patch = {
            title: input.values.title,
            category: input.values.category,
            priority: input.values.priority,
          };
          if (input.values.reportPhotoIds !== undefined)
            await linkPhotos(
              c,
              input.values.reportPhotoIds,
              access.actor,
              r.assetId,
              r.id,
              'report',
            );
          Object.assign(payload, input.values);
        }
        if (input.action === 'assign' || input.action === 'reassign') {
          const user = await this.hyl.users
            .withConnection(c)
            .get(input.assigneeId);
          if (!user || user.disabledAt || user.kind !== 'person')
            fail('REPAIR_ASSIGNEE_INVALID');
          if (input.dueOn < r.occurredOn) fail('REPAIR_DUE_INVALID');
          patch = { assigneeId: user.id, dueOn: input.dueOn };
          payload.assigneeName = user.name;
        }
        if (
          ['progress', 'complete', 'accept', 'reject'].includes(input.action)
        ) {
          const ids = photoIds('photoIds' in input ? input.photoIds : []);
          const stage = ['accept', 'reject'].includes(input.action)
            ? 'acceptance'
            : 'processing';
          await linkPhotos(c, ids, access.actor, r.assetId, r.id, stage);
          const key = stage + 'PhotoIds';
          payload[key] = [...new Set([...photoIds(payload[key]), ...ids])];
        }
        if (input.action === 'complete') {
          patch.costCents = String(cents(input.cost));
          payload.result = input.note;
          payload.completionEvidence = input.evidence;
          payload.completedAt = now();
        }
        if (input.action === 'accept') {
          payload.acceptance = input.note;
          payload.acceptedAt = now();
          payload.acceptedBy = access.actor;
        }
        if (input.action === 'reject') {
          payload.acceptance = '';
          payload.acceptedAt = '';
          payload.lastReturnReason = input.note;
        }
        if (input.action === 'close') {
          payload.closure = input.note;
          payload.closedAt = now();
        }
        if (input.action === 'cancel') {
          payload.cancellation = input.note;
          payload.closedAt = now();
        }
        const at = now();
        await this.hyl.runtime.fire('hylRepairOrders', id, input.action, {
          actor: { id: access.actor },
          expect: { version: r.lifecycleVersion },
          transaction: c,
        });
        const update = await c.repository('hylRepairOrders').updateMany({
          filter: { id, version: r.version },
          values: {
            ...patch,
            payload: json(payload),
            version: r.version + 1,
            updatedAt: at,
          },
        });
        if (update.updatedCount !== 1) fail('REPAIR_CHANGED', 'ABORTED');
        const after = await this.row(id, c);
        const {
          requestId: _request,
          expectedVersion: _version,
          ...details
        } = input;
        await this.event(
          c,
          after,
          access.actor,
          input.action,
          r.status,
          details,
        );
        return after;
      },
    );
    return this.view(access, result);
  }
  async allowed(access: Access, r: RepairOrder) {
    const actions: string[] = [];
    for (const [action, stages] of Object.entries(transitions)) {
      if (!(stages as readonly string[]).includes(r.status)) continue;
      try {
        await this.scoped(
          access,
          r,
          actionPermission[action as keyof typeof actionPermission],
        );
        actions.push(action);
      } catch (e) {
        if (
          !(e instanceof ApiError) ||
          !['PERMISSION_DENIED', 'NOT_FOUND'].includes(e.status)
        )
          throw e;
      }
    }
    return actions;
  }
  async view(access: Access, r: RepairOrder) {
    const procurementBlocks: Record<string, string> = {};
    for (const action of ['complete', 'close', 'cancel']) {
      const reason = await procurementRepairBlock(this.c(), r.id, action);
      if (reason) procurementBlocks[action] = reason;
    }
    return {
      ...r,
      blockedReasons: procurementBlocks,
      allowedActions: await this.allowed(access, r),
      blockedActions: [
        ...(r.assigneeId !== access.actor
          ? ['start', 'progress', 'complete']
          : []),
        ...Object.keys(procurementBlocks),
      ],
      overdue:
        !!r.dueOn &&
        r.dueOn < repairToday() &&
        !['closed', 'cancelled', 'accepted'].includes(r.status),
    };
  }
  async detail(access: Access, id: string, eventPage = 1) {
    const r = await this.row(id);
    await this.scoped(access, r);
    const repo = this.c().repository<RepairEvent>('hylRepairEvents');
    // Event version is the authoritative order even when multiple transitions share a millisecond.
    const allEvents = await repo.findMany({ filter: { orderId: id } });
    allEvents.sort(
      (a, b) =>
        Number(b.payload.version) - Number(a.payload.version) ||
        b.createdAt.localeCompare(a.createdAt),
    );
    const events = await Promise.all(
      allEvents
        .slice((eventPage - 1) * 20, eventPage * 20)
        .map(async (event) => {
          if (
            ['assign', 'reassign'].includes(event.action) &&
            !event.payload.assigneeName
          ) {
            const user = await this.hyl.users.get(s(event.payload.assigneeId));
            return {
              ...event,
              payload: { ...event.payload, assigneeName: user?.name ?? '' },
            };
          }
          return event;
        }),
    );
    const photos = {
      report: await readPhotos(
        this.c(),
        id,
        photoIds(r.payload.reportPhotoIds),
        this.basePath,
      ),
      processing: await readPhotos(
        this.c(),
        id,
        photoIds(r.payload.processingPhotoIds),
        this.basePath,
      ),
      acceptance: await readPhotos(
        this.c(),
        id,
        photoIds(r.payload.acceptancePhotoIds),
        this.basePath,
      ),
    };
    const photoEvents = await Promise.all(
      events.map(async (event) => ({
        ...event,
        photos: await readPhotos(
          this.c(),
          id,
          photoIds(
            event.payload.photoIds ??
              (event.payload.values as Record<string, unknown> | undefined)
                ?.reportPhotoIds,
          ),
          this.basePath,
        ),
      })),
    );
    return {
      ...(await this.view(access, r)),
      photos,
      events: {
        data: photoEvents,
        meta: {
          page: eventPage,
          pageSize: 20,
          total: allEvents.length,
        },
      },
    };
  }
  async list(access: Access, input: ListInput) {
    await this.permission(access, 'read');
    const matches: RepairOrder[] = [];
    const raw = await this.c()
      .repository<RepairOrder>('hylRepairOrders')
      .findMany({});
    for (const r of raw) {
      if (
        [
          'assetId',
          'merchantId',
          'contractId',
          'status',
          'priority',
          'category',
        ].some(
          (k) =>
            input[k as keyof ListInput] &&
            r[k as keyof RepairOrder] !== input[k as keyof ListInput],
        )
      )
        continue;
      if (
        input.mine &&
        (r.assigneeId !== access.actor ||
          ['closed', 'cancelled', 'accepted'].includes(r.status))
      )
        continue;
      if (
        input.q &&
        ![
          r.number,
          r.title,
          r.payload.reporterName,
          r.payload.reporterPhone,
          r.payload.assetName,
          r.payload.merchantName,
        ]
          .join(' ')
          .toLocaleLowerCase()
          .includes(input.q.toLocaleLowerCase())
      )
        continue;
      try {
        await this.scoped(access, r);
        matches.push(r);
      } catch (e) {
        if (
          !(e instanceof ApiError) ||
          !['PERMISSION_DENIED', 'NOT_FOUND'].includes(e.status)
        )
          throw e;
      }
    }
    const field = input.order.replace(/^-/, '') as keyof RepairOrder,
      dir = input.order.startsWith('-') ? -1 : 1;
    matches.sort((a, b) => {
      const result =
        field === 'costCents'
          ? BigInt(a.costCents) < BigInt(b.costCents)
            ? -1
            : BigInt(a.costCents) > BigInt(b.costCents)
              ? 1
              : 0
          : s(a[field]).localeCompare(s(b[field]));
      return dir * result || a.id.localeCompare(b.id);
    });
    return {
      data: await Promise.all(
        matches
          .slice((input.page - 1) * input.pageSize, input.page * input.pageSize)
          .map((r) => this.view(access, r)),
      ),
      meta: {
        page: input.page,
        pageSize: input.pageSize,
        total: matches.length,
      },
    };
  }
  async assignees(
    access: Access,
    input: { q: string; page: number; pageSize: number },
  ) {
    await this.permission(access, 'dispatch');
    const page = await this.hyl.users.list({
      page: input.page,
      pageSize: input.pageSize,
      search: input.q,
      status: 'enabled',
      kind: 'person',
    });
    return {
      data: page.items.map((u) => ({ id: u.id, name: u.name })),
      meta: { page: page.page, pageSize: page.pageSize, total: page.total },
    };
  }
}
