import type { Row } from '../hyl/schema.js';
import { effectiveEnd } from '../leases/model.js';
import { assetBusinessDay } from '../assets/dates.js';
import type { ContractAsset } from '../assets/schema.js';
import { randomUUID, randomBytes } from 'node:crypto';
import type { RepositoryPolicy } from '@nocobase/db';
import { buildFilter } from '@nocobase/repository-input';
import { ApiError } from '@nocobase/app-server/router';
import type { Access, HylService } from '../hyl/service.js';
import { fail } from '../hyl/service.js';
import { cents } from '../hyl/calculation.js';
import {
  assetSchema,
  bindingSchema,
  parents,
  isLeaf,
  type Asset,
  type Binding,
} from '../assets/schema.js';
import {
  getAsset,
  audit,
  lockProjects,
  available,
  assetSummary,
} from '../assets/transactions.js';
export async function assetPolicy(
  access: Access,
  action: 'read' | 'write',
): Promise<RepositoryPolicy> {
  const decision = await access.authorization.authorize({
    resource: { type: 'composite', id: 'hyl.assets' },
    action,
  });
  const policy = decision.conditions?.database?.hylAssets;
  if (decision.effect === 'deny' || !policy)
    fail('ACCESS_DENIED', 'PERMISSION_DENIED');
  return policy;
}
const today = assetBusinessDay;
export class AssetService {
  constructor(readonly hyl: HylService) {}
  async get(access: Access, id: string, action: 'read' | 'write' = 'read') {
    return getAsset(
      this.hyl.db.connection(),
      id,
      await assetPolicy(access, action),
    );
  }
  async occupied(ids: string[], c = this.hyl.db.connection()) {
    const bound = await c.repository<Binding>('hylAssetBindings').findMany();
    const contracted = await c
      .repository<ContractAsset>('hylContractAssets')
      .findMany();
    const day = today();
    return new Set(
      [...bound, ...contracted]
        .filter(
          (b) =>
            String(b.start) <= day &&
            (!b.end || String(b.end) >= day) &&
            ids.includes(String(b.assetId)),
        )
        .map((b) => String(b.assetId)),
    );
  }
  async list(
    access: Access,
    input: {
      q: string;
      type: string;
      state: string;
      parentId?: string;
      occupancy: string;
      page: number;
      pageSize: number;
      orderBy: string;
    },
    tree = false,
  ) {
    const repo = this.hyl.db
      .repository<Asset>('hylAssets')
      .withPolicy(await assetPolicy(access, 'read'));
    const [sort, direction] = input.orderBy.split(':');
    if (
      !['number', 'name', 'area', 'updatedAt'].includes(sort ?? '') ||
      !['asc', 'desc'].includes(direction ?? '')
    )
      fail('INVALID_SORT', 'INVALID_ARGUMENT');
    const occupied = input.occupancy
      ? await this.occupied((await repo.findMany()).map((a) => String(a.id)))
      : new Set<string>();
    const filter = buildFilter((f) =>
      f.and([
        ...(input.q
          ? [
              f.or([
                f.string('name').includes(input.q),
                f.string('number').includes(input.q),
              ]),
            ]
          : []),
        ...(input.type ? [f.string('type').eq(input.type)] : []),
        ...(input.state ? [f.string('state').eq(input.state)] : []),
        ...(input.parentId !== undefined
          ? [
              input.parentId
                ? f.string('parentId').eq(input.parentId)
                : f.string('parentId').eq(null),
            ]
          : []),
        ...(input.occupancy && occupied.size
          ? [
              input.occupancy === 'occupied'
                ? f.or([...occupied].map((id) => f.string('id').eq(id)))
                : f.and([...occupied].map((id) => f.string('id').ne(id))),
            ]
          : []),
      ]),
    );
    if (input.occupancy === 'occupied' && occupied.size === 0)
      return {
        data: [],
        meta: { total: 0, page: input.page, pageSize: input.pageSize },
      };
    const total = await repo.count({ filter });
    let rows = (await repo.findMany({
      filter,
      sort: (s) => [
        direction === 'asc' ? s.field(sort).asc() : s.field(sort).desc(),
        s.field('id').asc(),
      ],
      offset: (input.page - 1) * input.pageSize,
      limit: input.pageSize,
    })) as Asset[];
    if (sort === 'area') {
      rows = ((await repo.findMany({ filter })) as Asset[])
        .sort(
          (a, b) =>
            (cents(a.area) < cents(b.area)
              ? -1
              : cents(a.area) > cents(b.area)
                ? 1
                : a.id.localeCompare(b.id)) * (direction === 'desc' ? -1 : 1),
        )
        .slice((input.page - 1) * input.pageSize, input.page * input.pageSize);
    }
    if (tree)
      return {
        data: rows.map((a) => ({
          id: a.id,
          name: a.name,
          number: a.number,
          type: a.type,
          parentId: a.parentId,
          projectId: a.projectId,
        })),
        meta: { total, page: input.page, pageSize: input.pageSize },
      };
    const usage = await this.occupied(rows.map((a) => a.id));
    return {
      data: rows.map((a) => ({ ...a, occupied: usage.has(a.id) })),
      meta: { total, page: input.page, pageSize: input.pageSize },
    };
  }
  async save(
    access: Access,
    input: unknown,
    id?: string,
    expectedVersion?: number,
    reason = '',
  ) {
    const values = assetSchema.parse(input),
      policy = await assetPolicy(access, 'write');
    if (id && !reason.trim()) fail('REASON_REQUIRED', 'INVALID_ARGUMENT');
    return this.hyl.db.transaction(async (c) => {
      const old = id ? await getAsset(c, id, policy) : undefined;
      if (old && (old.version !== expectedVersion || old.type !== values.type))
        fail(
          old.type !== values.type
            ? 'ASSET_TYPE_IMMUTABLE'
            : 'VERSION_CONFLICT',
          old.type !== values.type ? 'INVALID_ARGUMENT' : 'ABORTED',
        );
      const parent = values.parentId
        ? await getAsset(c, values.parentId, policy)
        : undefined;
      if (
        parent &&
        (!parents[values.type]?.includes(parent.type) ||
          parent.state !== 'normal')
      )
        fail('ASSET_PARENT', 'INVALID_ARGUMENT');
      if (parent) await available(c, parent);
      if (id && values.parentId === id)
        fail('ASSET_PARENT', 'INVALID_ARGUMENT');
      const projectId = parent?.projectId ?? id ?? randomUUID();
      // Lock roots before validating usage or descendants; every binding/contract writer uses these roots too.
      await lockProjects(
        c,
        [old?.projectId, parent?.projectId].filter((x): x is string => !!x),
      );
      const current = old ? await getAsset(c, old.id, policy) : undefined;
      // A root lock advances its version; the expected version was checked before that internal lock.
      if (current && current.projectId !== old?.projectId)
        fail('VERSION_CONFLICT', 'ABORTED');
      if (parent) {
        const freshParent = await getAsset(c, parent.id, policy);
        if (freshParent.projectId !== parent.projectId)
          fail('VERSION_CONFLICT', 'ABORTED');
        await available(c, freshParent);
      }
      const version = current?.version ?? 0;
      const children = old
        ? await c
            .repository<Asset>('hylAssets')
            .findMany({ filter: { parentId: id } })
        : [];
      if (old && old.parentId !== values.parentId && children.length)
        fail('ASSET_MOVE_CHILDREN');
      if (
        old &&
        ((values.state === 'inactive' && old.state !== 'inactive') ||
          old.parentId !== values.parentId) &&
        (await c
          .repository('hylEnergyMeters')
          .exists({ filter: { assetId: old.id, status: 'active' } }))
      )
        fail('ENERGY_METER_IN_USE');
      if (values.state === 'inactive' && old) {
        if (children.some((child) => child.state !== 'inactive'))
          fail('ASSET_ACTIVE_CHILDREN');
        if ((await this.occupied([old.id], c)).has(old.id))
          fail('ASSET_IN_USE');
        const future = await c
          .repository<ContractAsset>('hylContractAssets')
          .findMany({ filter: { assetId: old.id } });
        const bindings = await c
          .repository<Binding>('hylAssetBindings')
          .findMany({ filter: { assetId: old.id } });
        if (
          future.some((r) => String(r.end) >= today()) ||
          bindings.some((r) => !r.end || r.end >= today())
        )
          fail('ASSET_IN_USE');
      }
      if (old && cents(values.lettableArea) < cents(old.lettableArea)) {
        const bindings = await c
          .repository<Binding>('hylAssetBindings')
          .findMany({ filter: { assetId: old.id } });
        if (
          bindings.some(
            (b) =>
              (!b.end || b.end >= today()) &&
              cents(b.area) > cents(values.lettableArea),
          )
        )
          fail('ASSET_AREA', 'INVALID_ARGUMENT');
      }
      const at = new Date().toISOString();
      const repo = c
        .repository<Asset>('hylAssets')
        .withPolicy(policy)
        .narrow({
          create:
            policy.read === false
              ? false
              : policy.read === true
                ? true
                : { scope: policy.read.scope },
        });
      let row: Asset;
      if (old)
        row = (
          await repo.updateOne({
            filter: { id, version },
            values: {
              ...values,
              projectId,
              version: version + 1,
              updatedAt: at,
            },
          })
        ).record as Asset;
      else {
        const assetId = values.type === 'project' ? projectId : randomUUID();
        row = (
          await repo.createOne({
            values: {
              ...values,
              id: assetId,
              projectId,
              number: `ZC${randomBytes(10).toString('hex').toUpperCase()}`,
              version: 0,
              createdAt: at,
              updatedAt: at,
            },
          })
        ).record as Asset;
      }
      await audit(
        c,
        row.id,
        access.actor,
        old ? 'edit' : 'create',
        reason.trim(),
        old ?? null,
        row,
      );
      return row;
    });
  }
  async history(access: Access, id: string, page: number, pageSize: number) {
    const visible = await this.get(access, id);
    const repo = this.hyl.db.repository('hylAssetHistory'),
      filter = { assetId: id };
    const rows = await repo.findMany({
      filter,
      sort: (s) => [s.field('createdAt').desc(), s.field('id').desc()],
      offset: (page - 1) * pageSize,
      limit: pageSize,
    });
    const redact = (value: unknown) =>
      value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value).filter(
              ([key]) =>
                Object.hasOwn(visible, key) ||
                ['start', 'end', 'title', 'category'].includes(key),
            ),
          )
        : null;
    return {
      data: rows.map((row) => ({
        ...row,
        before: redact(row.before),
        after: redact(row.after) ?? {},
      })),
      meta: { total: await repo.count({ filter }), page, pageSize },
    };
  }
  async bindings(access: Access, merchantId: string) {
    await this.hyl.get(access, 'merchants', merchantId);
    const rows = await this.hyl.db
      .repository<Binding>('hylAssetBindings')
      .findMany({
        filter: { merchantId },
        sort: (s) => [s.field('start').desc()],
      });
    return Promise.all(
      rows.map(async (row) => {
        const asset = await this.hyl.db
          .repository<Asset>('hylAssets')
          .findOne({ filter: { id: row.assetId } });
        return { ...row, asset: asset ? assetSummary(asset) : null };
      }),
    );
  }
  async bind(access: Access, merchantId: string, input: unknown) {
    const values = bindingSchema.parse(input),
      merchantPolicy = await this.hyl.policy(access, 'merchants', 'write'),
      policy = await assetPolicy(access, 'write');
    return this.hyl.db.transaction(async (c) => {
      await this.hyl.get(
        access,
        'merchants',
        merchantId,
        'write',
        c,
        merchantPolicy,
      );
      await this.hyl.lockMerchant(c, merchantId);
      const asset = await getAsset(c, values.assetId, policy);
      await lockProjects(c, [asset.projectId]);
      if (!isLeaf(asset.type)) fail('ASSET_LEAF_REQUIRED', 'INVALID_ARGUMENT');
      const fresh = await getAsset(c, asset.id, policy);
      if (fresh.projectId !== asset.projectId)
        fail('VERSION_CONFLICT', 'ABORTED');
      const previous = await c
        .repository<Binding>('hylAssetBindings')
        .findOne({ filter: { merchantId, requestId: values.requestId } });
      if (previous) {
        if (
          previous.actor !== access.actor ||
          JSON.stringify(
            bindingSchema.parse(
              Object.fromEntries(
                Object.keys(values).map((key) => [
                  key,
                  previous[key as keyof Binding],
                ]),
              ),
            ),
          ) !== JSON.stringify(values)
        )
          fail('PROFILE_RETRY_CONFLICT', 'ALREADY_EXISTS');
        return previous;
      }
      await available(c, fresh);
      if (cents(values.area) > cents(fresh.lettableArea))
        fail('ASSET_AREA', 'INVALID_ARGUMENT');
      const all = await c
        .repository<Binding>('hylAssetBindings')
        // Occupancy is exclusive across all merchants, even outside this actor's read scope.
        // The project lock above serializes competing allocations for the same asset.
        .findMany({ filter: { assetId: asset.id } });
      if (
        all.some(
          (b) =>
            b.start <= (values.end || '9999-12-31') &&
            (!b.end || b.end >= values.start),
        )
      )
        fail('ASSET_BINDING_OVERLAP', 'ALREADY_EXISTS');
      const row = {
        ...values,
        id: randomUUID(),
        merchantId,
        actor: access.actor,
        version: 0,
        createdAt: new Date().toISOString(),
      };
      await c.repository('hylAssetBindings').createOne({ values: row });
      await audit(c, asset.id, access.actor, 'bind', '', null, row);
      return row;
    });
  }
  async closeBinding(
    access: Access,
    merchantId: string,
    bindingId: string,
    end: string,
    reason: string,
    expectedVersion: number,
  ) {
    const merchantPolicy = await this.hyl.policy(access, 'merchants', 'write'),
      policy = await assetPolicy(access, 'write');
    return this.hyl.db.transaction(async (c) => {
      await this.hyl.get(
        access,
        'merchants',
        merchantId,
        'write',
        c,
        merchantPolicy,
      );
      await this.hyl.lockMerchant(c, merchantId);
      const row = await c
        .repository<Binding>('hylAssetBindings')
        .findOne({ filter: { id: bindingId, merchantId } });
      if (!row) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
      const asset = await getAsset(c, row.assetId, policy);
      await lockProjects(c, [asset.projectId]);
      if ((await getAsset(c, asset.id, policy)).projectId !== asset.projectId)
        fail('VERSION_CONFLICT', 'ABORTED');
      if (row.version !== expectedVersion) fail('VERSION_CONFLICT', 'ABORTED');
      if (end < row.start || (row.end && end > row.end))
        fail('INVALID_PERIOD', 'INVALID_ARGUMENT');
      const contracts = await c
        .repository<ContractAsset>('hylContractAssets')
        .findMany({ filter: { merchantId, assetId: row.assetId } });
      for (const link of contracts) {
        const contract = await c
          .repository<Row>('hylContracts')
          .findOne({ filter: { id: link.contractId } });
        if (
          contract &&
          String(link.start) >= row.start &&
          String(link.start) <= (row.end || '9999-12-31') &&
          (await effectiveEnd(c, contract)) > end
        )
          fail('ASSET_CONTRACT_IN_USE');
      }
      const managed = await c
        .repository<{
          start: string;
          end: string;
          assetId: string;
          merchantId: string;
        }>('hylEnergyAssignments')
        .findMany({ filter: { assetId: row.assetId, merchantId } });
      if (
        managed.some(
          (a) =>
            a.start <= (row.end || '9999-12-31') && (!a.end || a.end > end),
        )
      )
        fail('ENERGY_ASSIGNMENT_CONFLICT');
      const result = await c.repository('hylAssetBindings').updateOne({
        filter: { id: bindingId, version: expectedVersion },
        values: { end, version: expectedVersion + 1 },
      });
      await audit(
        c,
        asset.id,
        access.actor,
        'unbind',
        reason,
        row,
        result.record,
      );
      return result.record;
    });
  }
  async contractAssets(access: Access, id: string) {
    await this.hyl.get(access, 'contracts', id);
    return this.hyl.db
      .repository<ContractAsset>('hylContractAssets')
      .findMany({ filter: { contractId: id } });
  }
  async associations(access: Access, id: string) {
    await this.get(access, id);
    const merchants = [],
      contracts = [];
    for (const b of await this.hyl.db
      .repository<Binding>('hylAssetBindings')
      .findMany({ filter: { assetId: id } })) {
      try {
        const row = await this.hyl.get(access, 'merchants', b.merchantId);
        merchants.push({
          ...b,
          merchant: { id: row.id, name: row.name, number: row.number },
        });
      } catch (e) {
        if (
          !(e instanceof ApiError) ||
          !['NOT_FOUND', 'PERMISSION_DENIED'].includes(e.status)
        )
          throw e;
      }
    }
    for (const link of await this.hyl.db
      .repository<ContractAsset>('hylContractAssets')
      .findMany({ filter: { assetId: id } })) {
      try {
        const row = await this.hyl.get(
          access,
          'contracts',
          String(link.contractId),
        );
        contracts.push({
          id: row.id,
          number: row.number,
          start: link.start,
          end: link.end,
        });
      } catch (e) {
        if (
          !(e instanceof ApiError) ||
          !['NOT_FOUND', 'PERMISSION_DENIED'].includes(e.status)
        )
          throw e;
      }
    }
    const merchantAccess = await access.authorization.authorize({
      resource: { type: 'composite', id: 'hyl.merchants' },
      action: 'read',
    });
    const contractAccess = await access.authorization.authorize({
      resource: { type: 'composite', id: 'hyl.contracts' },
      action: 'read',
    });
    const reads = [
      merchantAccess.conditions?.database?.hylMerchants?.read,
      contractAccess.conditions?.database?.hylContracts?.read,
    ];
    return {
      merchants,
      contracts,
      restricted:
        merchantAccess.effect === 'deny' ||
        contractAccess.effect === 'deny' ||
        reads.some(
          (read) =>
            read === false ||
            (typeof read === 'object' &&
              read.scope !== undefined &&
              read.scope !== true),
        ),
    };
  }
}
