import { createHash, randomUUID } from 'node:crypto';
import { ApiError } from '@nocobase/app-server/router';
import type { DatabaseConnection, RepositoryPolicy } from '@nocobase/db';
import { buildFilter } from '@nocobase/repository-input';
import { assetPolicy } from '../providers/assets.js';
import { getAsset, lockProjects, available } from '../assets/transactions.js';
import type { Asset } from '../assets/schema.js';
import { fail, type Access, type HylService } from '../hyl/service.js';
import type { Row } from '../hyl/schema.js';
import { getLease, effectiveEnd } from '../leases/model.js';
import { BillingService } from '../billing/service.js';
import type { BillValues } from '../billing/model.js';
import { activeLines, configs } from '../billing/accounting.js';
import { previewBill } from '../billing/engine.js';
import { nextDay, fixedDecimal, covered } from '../billing/calculation.js';
import { flushInvoices } from '../invoicing/queue.js';
import { syncContract } from '../profit-sharing/projection.js';
import { str, assertAssignment, assertChain } from './registry.js';
import { usageSortKey } from './calculation.js';
import {
  tables,
  energyActions,
  type EnergyRecord,
  type MeterValues,
  type AssignmentValues,
  type ReadingValues,
  type HandoverValues,
  type StopValues,
  type AdoptValues,
  type BillingValues,
  type Operation,
  type ListInput,
} from './model.js';
const fingerprint = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
const now = () => new Date().toISOString();
function lifecycleValues(r: EnergyRecord) {
  const {
    status: _status,
    lifecycleVersion: _version,
    statusChangedAt: _at,
    ...values
  } = r;
  return values;
}
export function energyRow(values: Partial<EnergyRecord>): EnergyRecord {
  const id = values.id ?? randomUUID(),
    at = now();
  return {
    id,
    number: 'NH-' + id.slice(0, 8).toUpperCase(),
    assetId: '',
    projectId: '',
    meterId: '',
    contractId: '',
    merchantId: '',
    status: '',
    version: 0,
    lifecycleVersion: 0,
    statusChangedAt: at,
    code: null,
    start: '',
    end: '',
    usageKey: usageSortKey('0'),
    activeReadingId: null,
    billId: '',
    actor: '',
    searchText: '',
    payload: {},
    createdAt: at,
    updatedAt: at,
    ...values,
  };
}
export async function energyPolicy(access: Access, action: string) {
  const decision = await access.authorization.authorize({
      resource: { type: 'composite', id: 'hyl.energy' },
      action,
    }),
    policy = decision.conditions?.database?.hylAssets;
  if (decision.effect === 'deny' || !policy)
    fail('ACCESS_DENIED', 'PERMISSION_DENIED');
  return policy;
}
export class EnergyService {
  constructor(readonly hyl: HylService) {}
  c() {
    return this.hyl.db.connection();
  }
  async row(table: string, id: string, c = this.c()) {
    const r = await c
      .repository<EnergyRecord>(table)
      .findOne({ filter: { id } });
    if (!r) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    return r;
  }
  async prepare(
    access: Access,
    action: string,
    assetIds: string[],
    contractIds: string[] = [],
    assetWrite = false,
    contractActions = ['read'],
  ) {
    const ep = await energyPolicy(access, action),
      ap = await assetPolicy(access, assetWrite ? 'write' : 'read'),
      assets = new Map<string, Asset>(),
      policies = new Map<string, RepositoryPolicy>(),
      contracts = new Map<string, Row>();
    for (const id of new Set(assetIds)) {
      await getAsset(this.c(), id, ep);
      assets.set(id, await getAsset(this.c(), id, ap));
    }
    for (const a of contractIds.some(Boolean) ? contractActions : [])
      policies.set(a, await this.hyl.policy(access, 'contracts', a));
    for (const id of new Set(contractIds.filter(Boolean)))
      for (const [a, p] of policies)
        contracts.set(
          id,
          await this.hyl.get(access, 'contracts', id, a, this.c(), p),
        );
    return { ep, ap, assets, policies, contracts };
  }
  async checked(access: Access, table: string, id: string, action: string) {
    const r = await this.row(table, id);
    await this.prepare(access, action, [r.assetId], [r.contractId]);
    return r;
  }
  async atomic<T>(
    access: Access,
    action: string,
    body: { requestId: string },
    prepared: Awaited<ReturnType<EnergyService['prepare']>>,
    intent: unknown,
    fn: (c: DatabaseConnection) => Promise<T>,
  ) {
    const hash = fingerprint({ actor: access.actor, action, intent });
    return this.hyl.db.transaction(async (c) => {
      for (const id of [
        ...new Set([...prepared.contracts.values()].map((r) => r.merchantId)),
      ].sort())
        await this.hyl.lockMerchant(c, id);
      await lockProjects(
        c,
        [...prepared.assets.values()].map((a) => a.projectId),
      );
      for (const [id, old] of prepared.assets) {
        const a = await getAsset(c, id, prepared.ap);
        await getAsset(c, id, prepared.ep);
        if (a.projectId !== old.projectId) fail('ENERGY_CHANGED', 'ABORTED');
      }
      for (const [id] of prepared.contracts)
        for (const [a, p] of prepared.policies)
          prepared.contracts.set(
            id,
            await this.hyl.get(access, 'contracts', id, a, c, p),
          );
      const prior = await c
        .repository<EnergyRecord>('hylEnergyOperations')
        .findOne({ filter: { id: body.requestId } });
      if (prior) {
        if (prior.actor !== access.actor || prior.payload.hash !== hash)
          fail('ENERGY_CHANGED', 'ALREADY_EXISTS');
        return prior.payload.result as T;
      }
      const result = await fn(c);
      await flushInvoices(c, this.hyl, access.actor);
      await c.repository<EnergyRecord>('hylEnergyOperations').createOne({
        values: energyRow({
          id: body.requestId,
          number: body.requestId,
          actor: access.actor,
          status: 'complete',
          payload: { hash, result },
        }),
      });
      return result;
    });
  }
  version(r: EnergyRecord, v: number) {
    if (r.version !== v) fail('ENERGY_CHANGED', 'ABORTED');
  }
  async save(
    c: DatabaseConnection,
    table: string,
    r: EnergyRecord,
    patch: Partial<EnergyRecord>,
    actor: string,
    action: string,
    reason = '',
  ) {
    const value = { ...r, ...patch, version: r.version + 1, updatedAt: now() };
    const out = await c
      .repository<EnergyRecord>(table)
      .updateMany({ filter: { id: r.id, version: r.version }, values: value });
    if (out.updatedCount !== 1) fail('ENERGY_CHANGED', 'ABORTED');
    await this.audit(c, value, actor, action, reason);
    return value;
  }
  async audit(
    c: DatabaseConnection,
    r: EnergyRecord,
    actor: string,
    action: string,
    reason = '',
  ) {
    await c.repository<EnergyRecord>('hylEnergyAudit').createOne({
      values: energyRow({
        assetId: r.assetId,
        projectId: r.projectId,
        meterId: r.meterId,
        contractId: r.contractId,
        merchantId: r.merchantId,
        actor,
        status: action,
        payload: { recordId: r.id, action, reason, version: r.version },
      }),
    });
  }
  async createMeter(access: Access, values: MeterValues, op: Operation) {
    const p = await this.prepare(
      access,
      'meterWrite',
      [values.assetId],
      [],
      true,
    );
    return this.atomic(
      access,
      'meterWrite',
      op,
      p,
      { createMeter: values },
      async (c) => {
        const asset = await getAsset(c, values.assetId, p.ap);
        await available(c, asset);
        const code = values.code.trim().toUpperCase();
        if (await c.repository('hylEnergyMeters').exists({ filter: { code } }))
          fail('ENERGY_METER_DUPLICATE', 'ALREADY_EXISTS');
        const id = randomUUID(),
          r = energyRow({
            id,
            number: code,
            code,
            assetId: asset.id,
            projectId: asset.projectId,
            meterId: id,
            start: values.installedOn,
            status: 'active',
            actor: access.actor,
            payload: {
              ...values,
              code,
              assetName: asset.name,
              unit: values.type === 'water' ? 'm³' : 'kWh',
            },
            searchText: [code, values.name, asset.name].join(' '),
          });
        const created = await this.hyl.runtime.create(
          'hylEnergyMeters',
          lifecycleValues(r),
          {
            actor: { id: access.actor },
            transaction: c,
          },
        );
        await this.audit(c, r, access.actor, 'createMeter');
        return created.record;
      },
    );
  }
  async editMeter(
    access: Access,
    id: string,
    values: MeterValues,
    op: Operation,
  ) {
    const old = await this.checked(access, tables.meters, id, 'meterWrite'),
      p = await this.prepare(access, 'meterWrite', [old.assetId], [], true);
    return this.atomic(
      access,
      'meterWrite',
      op,
      p,
      { editMeter: id, values, op },
      async (c) => {
        const r = await this.row(tables.meters, id, c);
        this.version(r, op.expectedVersion);
        // Identity and physical calibration changes use a replacement meter. Keeping this strict also protects legacy adoption.
        for (const key of [
          'code',
          'type',
          'assetId',
          'installedOn',
          'openingReading',
          'multiplier',
          'openingEvidence',
        ] as const)
          if (str(values[key]) !== str(r.payload[key]))
            fail('ENERGY_IDENTITY_LOCKED');
        return this.save(
          c,
          tables.meters,
          r,
          {
            payload: { ...r.payload, name: values.name, notes: values.notes },
            searchText: [r.code, values.name, r.payload.assetName].join(' '),
          },
          access.actor,
          'editMeter',
        );
      },
    );
  }
  async assignmentDraft(
    c: DatabaseConnection,
    m: EnergyRecord,
    input: AssignmentValues,
    contract: Row,
    except = '',
  ) {
    if (
      m.status !== 'active' ||
      input.start < m.start ||
      (await getLease(c, contract)).status !== 'active'
    )
      fail('ENERGY_ASSIGNMENT_CONFLICT');
    const a = energyRow({
      assetId: m.assetId,
      projectId: m.projectId,
      meterId: m.id,
      contractId: contract.id,
      merchantId: contract.merchantId,
      start: input.start,
      status: 'active',
      payload: {
        openingReading: input.openingReading,
        evidence: input.evidence,
        notes: input.notes,
        contractNumber: contract.number,
        meterCode: m.code,
        assetName: m.payload.assetName,
        feeType: m.payload.type,
      },
    });
    await assertAssignment(c, a, m, contract);
    const existing = await c
        .repository<EnergyRecord>(tables.assignments)
        .findMany({ filter: { meterId: m.id } }),
      end = await effectiveEnd(c, contract);
    if (
      existing.some(
        (x) =>
          x.id !== except && x.start <= end && (!x.end || x.end >= a.start),
      )
    )
      fail('ENERGY_ASSIGNMENT_CONFLICT');
    const readings = await c
        .repository<EnergyRecord>(tables.readings)
        .findMany({ filter: { meterId: m.id, status: 'approved' } }),
      last = readings
        .filter((r) => r.end < input.start)
        .sort((a, b) => a.end.localeCompare(b.end))
        .at(-1);
    if (
      fixedDecimal(input.openingReading) <
      fixedDecimal(
        last ? str(last.payload.current) : str(m.payload.openingReading),
      )
    )
      fail('ENERGY_READING_CHAIN_CONFLICT');
    if (
      last &&
      nextDay(last.end) === input.start &&
      fixedDecimal(input.openingReading) !==
        fixedDecimal(str(last.payload.current))
    )
      fail('ENERGY_READING_CHAIN_CONFLICT');
    return a;
  }
  async assign(
    access: Access,
    id: string,
    input: AssignmentValues,
    op: Operation,
    write = false,
  ) {
    const m = await this.checked(access, tables.meters, id, 'meterWrite'),
      p = await this.prepare(
        access,
        'meterWrite',
        [m.assetId],
        [input.contractId],
        true,
        ['read', 'billingConfigure'],
      );
    await energyPolicy(access, 'readingWrite');
    const make = async (c: DatabaseConnection) => {
      const current = await this.row(tables.meters, id, c),
        contract = p.contracts.get(input.contractId)!,
        a = await this.assignmentDraft(c, current, input, contract);
      return {
        current,
        a,
        previewHash: fingerprint({
          input,
          meter: current.version,
          contractVersion: contract.version,
        }),
      };
    };
    if (!write) {
      const d = await make(this.c());
      return { ...d.a, previewHash: d.previewHash };
    }
    return this.atomic(
      access,
      'meterWrite',
      op,
      p,
      { assign: id, input, op },
      async (c) => {
        const d = await make(c);
        this.version(d.current, op.expectedVersion);
        if (d.previewHash !== op.previewHash) fail('ENERGY_CHANGED', 'ABORTED');
        d.a.actor = access.actor;
        await c
          .repository<EnergyRecord>(tables.assignments)
          .createOne({ values: d.a });
        await this.save(
          c,
          tables.meters,
          d.current,
          {},
          access.actor,
          'assign',
        );
        await this.audit(c, d.a, access.actor, 'assign');
        return d.a;
      },
    );
  }
  async readingDraft(c: DatabaseConnection, input: ReadingValues) {
    const m = await this.row(tables.meters, input.meterId, c),
      a = input.assignmentId
        ? await this.row(tables.assignments, input.assignmentId, c)
        : undefined;
    if (a && a.meterId !== m.id) fail('ENERGY_ASSIGNMENT_CONFLICT');
    const assigned = await c
      .repository<EnergyRecord>(tables.assignments)
      .findMany({ filter: { meterId: m.id } });
    if (
      !a &&
      assigned.some(
        (x) => x.start <= input.end && (!x.end || x.end >= input.start),
      )
    )
      fail('ENERGY_ASSIGNMENT_CONFLICT');
    const r = energyRow({
      assetId: m.assetId,
      projectId: m.projectId,
      meterId: m.id,
      contractId: a?.contractId ?? '',
      merchantId: a?.merchantId ?? '',
      start: input.start,
      end: input.end,
      status: 'draft',
      payload: {
        ...input,
        meterCode: m.code,
        feeType: m.payload.type,
        assetName: m.payload.assetName,
        contractNumber: a?.payload.contractNumber ?? '',
        unit: m.payload.unit,
      },
    });
    return { m, a, r };
  }
  async saveReading(
    access: Access,
    input: ReadingValues,
    op: Operation,
    id = '',
  ) {
    const draft = await this.readingDraft(this.c(), input),
      old = id
        ? await this.checked(access, tables.readings, id, 'readingWrite')
        : undefined,
      p = await this.prepare(
        access,
        'readingWrite',
        [draft.m.assetId, ...(old ? [old.assetId] : [])],
        [draft.r.contractId, ...(old ? [old.contractId] : [])],
      );
    return this.atomic(
      access,
      'readingWrite',
      op,
      p,
      { saveReading: id, input, op },
      async (c) => {
        const d = await this.readingDraft(c, input);
        if (
          d.r.contractId &&
          (await getLease(c, p.contracts.get(d.r.contractId)!)).status ===
            'closed'
        )
          fail('LEASE_CLOSED');
        if (op.expectedMeterVersion !== undefined)
          this.version(d.m, op.expectedMeterVersion);
        let r = d.r;
        if (id) {
          r = await this.row(tables.readings, id, c);
          this.version(r, op.expectedVersion);
          if (
            !['draft', 'rejected'].includes(r.status) ||
            r.meterId !== input.meterId ||
            str(r.payload.assignmentId) !== input.assignmentId
          )
            fail('ENERGY_READING_REQUIRED');
          r = {
            ...r,
            start: input.start,
            end: input.end,
            payload: { ...d.r.payload },
          };
        }
        await assertChain(c, d.m, d.a, r, false);
        r.usageKey = usageSortKey(str(r.payload.usage) || '0');
        if (id)
          return this.save(
            c,
            tables.readings,
            await this.row(tables.readings, id, c),
            r,
            access.actor,
            'editReading',
          );
        r.actor = access.actor;
        r.number = 'CB-' + r.id.slice(0, 8).toUpperCase();
        r.searchText = [
          r.number,
          d.m.code,
          r.payload.assetName,
          r.payload.contractNumber,
        ].join(' ');
        const created = await this.hyl.runtime.create(
          tables.readings,
          lifecycleValues(r),
          {
            actor: { id: access.actor },
            transaction: c,
          },
        );
        await this.audit(c, r, access.actor, 'createReading');
        return created.record;
      },
    );
  }
  async readingAction(
    access: Access,
    id: string,
    action: string,
    op: Operation,
    input?: ReadingValues,
  ) {
    const permission = ['approve', 'reject'].includes(action)
        ? 'readingReview'
        : 'readingWrite',
      old = await this.checked(access, tables.readings, id, permission),
      p = await this.prepare(
        access,
        permission,
        [old.assetId],
        [old.contractId],
      );
    return this.atomic(
      access,
      permission,
      op,
      p,
      { readingAction: id, action, op, input },
      async (c) => {
        let r = await this.row(tables.readings, id, c);
        this.version(r, op.expectedVersion);
        const m = await this.row(tables.meters, r.meterId, c),
          a = r.payload.assignmentId
            ? await this.row(tables.assignments, str(r.payload.assignmentId), c)
            : undefined;
        if (op.expectedMeterVersion !== undefined)
          this.version(m, op.expectedMeterVersion);
        if (action === 'submit' || action === 'approve') {
          if (input) {
            if (
              input.meterId !== r.meterId ||
              input.assignmentId !== str(r.payload.assignmentId)
            )
              fail('ENERGY_CHANGED', 'ABORTED');
            r = {
              ...r,
              start: input.start,
              end: input.end,
              payload: { ...r.payload, ...input },
            };
          }
          if (a)
            await assertAssignment(c, a, m, p.contracts.get(r.contractId)!);
          await assertChain(c, m, a, r, true);
          if (r.contractId) {
            const contract = p.contracts.get(r.contractId)!,
              boundary = await effectiveEnd(c, contract);
            if (
              r.end > boundary ||
              (await getLease(c, contract)).status === 'closed'
            )
              fail('LEASE_CLOSED');
          }
          await c.repository<EnergyRecord>(tables.readings).updateOne({
            filter: { id },
            values: {
              start: r.start,
              end: r.end,
              payload: r.payload,
              usageKey: usageSortKey(str(r.payload.usage)),
            },
          });
        }
        if (['reject', 'void'].includes(action) && !op.reason)
          fail('REASON_REQUIRED', 'INVALID_ARGUMENT');
        if (action === 'void') {
          if (
            await c
              .repository('hylEnergyBillLinks')
              .exists({ filter: { activeReadingId: id } })
          )
            fail('ENERGY_SOURCE_ALREADY_BILLED');
          const later = await c
            .repository<EnergyRecord>(tables.readings)
            .findMany({ filter: { meterId: r.meterId } });
          if (
            later.some(
              (x) =>
                x.id !== id &&
                ['submitted', 'approved'].includes(x.status) &&
                x.start > r.end,
            )
          )
            fail('ENERGY_READING_DEPENDENCY');
        }
        await this.hyl.runtime.fire(tables.readings, id, action, {
          actor: { id: access.actor },
          transaction: c,
          expect: { version: r.lifecycleVersion },
        });
        const current = await this.row(tables.readings, id, c);
        r = await this.save(
          c,
          tables.readings,
          current,
          {
            payload: {
              ...current.payload,
              ...(action === 'approve'
                ? { reviewer: access.actor, approvedAt: now() }
                : {}),
              reason: op.reason,
            },
          },
          access.actor,
          action,
          op.reason,
        );
        await this.save(
          c,
          tables.meters,
          m,
          {},
          access.actor,
          'reading.' + action,
        );
        return r;
      },
    );
  }
  async handover(
    access: Access,
    id: string,
    input: HandoverValues,
    op: Operation,
    write = false,
  ) {
    const m = await this.checked(access, tables.meters, id, 'meterWrite'),
      a = await this.row(tables.assignments, input.assignmentId),
      p = await this.prepare(
        access,
        'meterWrite',
        [m.assetId],
        [a.contractId, input.nextContractId],
        true,
        ['read', 'billingConfigure'],
      );
    await energyPolicy(access, 'readingWrite');
    const make = async (c: DatabaseConnection) => {
      const meter = await this.row(tables.meters, id, c),
        assignment = await this.row(tables.assignments, a.id, c),
        r = await this.row(tables.readings, input.readingId, c);
      if (
        assignment.meterId !== id ||
        assignment.end ||
        r.payload.assignmentId !== a.id ||
        r.status !== 'approved' ||
        r.end !== input.end ||
        input.end < assignment.start
      )
        fail('ENERGY_READING_REQUIRED');
      const all = await c
        .repository<EnergyRecord>(tables.readings)
        .findMany({ filter: { meterId: id } });
      if (
        all.some(
          (x) =>
            x.id !== r.id &&
            ['submitted', 'approved'].includes(x.status) &&
            x.end > input.end,
        )
      )
        fail('ENERGY_READING_DEPENDENCY');
      if (
        (await activeLines(c, assignment.contractId)).some(
          (l) => l.meterCode === meter.code && l.end > input.end,
        )
      )
        fail('ENERGY_SOURCE_ALREADY_BILLED');
      let next: EnergyRecord | undefined;
      if (input.nextContractId) {
        const contract = await this.hyl.get(
          access,
          'contracts',
          input.nextContractId,
          'read',
          c,
          p.policies.get('read'),
        );
        if (input.nextContractId === assignment.contractId)
          fail('ENERGY_ASSIGNMENT_CONFLICT');
        next = await this.assignmentDraft(
          c,
          meter,
          {
            contractId: input.nextContractId,
            start: nextDay(input.end),
            openingReading: str(r.payload.current),
            evidence: input.evidence,
            notes: input.notes,
          },
          contract,
          assignment.id,
        );
      }
      const issuedReadingIds = new Set(
        (
          await c
            .repository<EnergyRecord>('hylEnergyBillLinks')
            .findMany({ filter: { meterId: id, status: 'issued' } })
        ).map((x) => x.activeReadingId),
      );
      return {
        meter,
        assignment,
        r,
        next,
        finalBilled: covered(
          assignment.start,
          input.end,
          all.filter(
            (x) =>
              x.status === 'approved' &&
              x.payload.assignmentId === assignment.id &&
              x.end <= input.end &&
              issuedReadingIds.has(x.id),
          ),
        ),
        nextContractNumber: input.nextContractId
          ? p.contracts.get(input.nextContractId)?.number
          : '',
        previewHash: fingerprint({
          input,
          meterVersion: meter.version,
          assignmentVersion: assignment.version,
          readingVersion: r.version,
          contracts: [...p.contracts.values()].map((x) => [x.id, x.version]),
        }),
      };
    };
    // Preview must remain read-only: next-assignment validation can exclude the closing assignment without temporary writes.
    if (!write) {
      return make(this.c());
    }
    return this.atomic(
      access,
      'meterWrite',
      op,
      p,
      { handover: id, input, op },
      async (c) => {
        const d = await make(c);
        this.version(d.meter, op.expectedVersion);
        if (d.previewHash !== op.previewHash) fail('ENERGY_CHANGED', 'ABORTED');
        const closed = await this.save(
          c,
          tables.assignments,
          d.assignment,
          {
            end: input.end,
            status: 'closed',
            payload: {
              ...d.assignment.payload,
              closingReading: d.r.payload.current,
              closingEvidence: input.evidence,
            },
          },
          access.actor,
          'handover',
        );
        if (d.next) {
          d.next.actor = access.actor;
          await c
            .repository<EnergyRecord>(tables.assignments)
            .createOne({ values: d.next });
          await this.audit(c, d.next, access.actor, 'assign');
        }
        await this.save(
          c,
          tables.meters,
          d.meter,
          {},
          access.actor,
          'handover',
        );
        return { assignment: closed, next: d.next ?? null };
      },
    );
  }
  async stop(
    access: Access,
    id: string,
    input: StopValues,
    op: Operation,
    write = false,
  ) {
    const m = await this.checked(access, tables.meters, id, 'meterWrite'),
      assignments = await this.c()
        .repository<EnergyRecord>(tables.assignments)
        .findMany({ filter: { meterId: id } }),
      p = await this.prepare(
        access,
        'meterWrite',
        [m.assetId],
        assignments.map((a) => a.contractId),
        true,
      );
    const check = async (c: DatabaseConnection) => {
      const meter = await this.row(tables.meters, id, c),
        all = await c
          .repository<EnergyRecord>(tables.assignments)
          .findMany({ filter: { meterId: id } }),
        readings = await c
          .repository<EnergyRecord>(tables.readings)
          .findMany({ filter: { meterId: id } });
      if (
        meter.status !== 'active' ||
        input.end < meter.start ||
        all.some((a) => !a.end || a.end > input.end) ||
        readings.some(
          (r) =>
            r.status === 'submitted' ||
            (r.status === 'approved' && r.end > input.end),
        )
      )
        fail('ENERGY_READING_REQUIRED');
      if (all.length || readings.some((r) => r.status === 'approved')) {
        const last = readings
          .filter((r) => r.status === 'approved')
          .sort((a, b) => a.end.localeCompare(b.end))
          .at(-1);
        if (!last || last.end !== input.end) fail('ENERGY_READING_REQUIRED');
        const links = await c
          .repository<EnergyRecord>('hylEnergyBillLinks')
          .findMany({ filter: { meterId: id } });
        if (
          readings.some(
            (r) =>
              r.status === 'approved' &&
              r.contractId &&
              !links.some(
                (l) => l.activeReadingId === r.id && l.status === 'issued',
              ),
          )
        )
          fail('ENERGY_READING_REQUIRED');
      }
      return {
        meter,
        previewHash: fingerprint({
          input,
          version: meter.version,
          assignments: all.map((a) => [a.id, a.version]),
          readings: readings.map((r) => [r.id, r.version]),
        }),
      };
    };
    if (!write) return check(this.c());
    return this.atomic(
      access,
      'meterWrite',
      op,
      p,
      { stop: id, input, op },
      async (c) => {
        const d = await check(c);
        this.version(d.meter, op.expectedVersion);
        if (d.previewHash !== op.previewHash) fail('ENERGY_CHANGED', 'ABORTED');
        await this.hyl.runtime.fire(tables.meters, id, 'stop', {
          actor: { id: access.actor },
          transaction: c,
          expect: { version: d.meter.lifecycleVersion },
        });
        return this.save(
          c,
          tables.meters,
          await this.row(tables.meters, id, c),
          {
            end: input.end,
            payload: {
              ...d.meter.payload,
              stopEvidence: input.evidence,
              stopReason: input.reason,
            },
          },
          access.actor,
          'stop',
          input.reason,
        );
      },
    );
  }
  async adopt(
    access: Access,
    input: AdoptValues,
    op: Operation,
    write = false,
  ) {
    const p = await this.prepare(
      access,
      'meterWrite',
      [input.assetId],
      [input.contractId],
      true,
      ['read', 'billingConfigure'],
    );
    await energyPolicy(access, 'readingWrite');
    const check = async (c: DatabaseConnection) => {
      const history = await configs(c, input.contractId),
        last = history.at(-1),
        meter = last?.payload.meters.find(
          (m) =>
            m.assetId === input.assetId &&
            m.feeType === input.feeType &&
            m.meterCode.toUpperCase() === input.meterCode.toUpperCase(),
        );
      if (!meter) fail('BILLING_METER_REQUIRED');
      if (
        await c
          .repository('hylEnergyMeters')
          .exists({ filter: { code: input.meterCode.toUpperCase() } })
      )
        fail('ENERGY_METER_DUPLICATE', 'ALREADY_EXISTS');
      const lines = await activeLines(c, input.contractId),
        own = lines
          .filter(
            (l) =>
              l.assetId === input.assetId &&
              l.feeType === input.feeType &&
              l.meterCode.toUpperCase() === input.meterCode.toUpperCase(),
          )
          .sort((a, b) => a.end.localeCompare(b.end)),
        bills = await c.repository('hylBills').findMany({
          filter: { contractId: input.contractId, status: 'draft' },
        });
      if (own.some((l) => bills.some((b) => b.id === l.billId)))
        fail('ENERGY_SOURCE_ALREADY_BILLED');
      const previous = own.at(-1),
        start = previous ? nextDay(previous.end) : meter.activeFrom,
        reading = previous
          ? str(previous.payload.current)
          : meter.openingReading;
      if (
        previous &&
        fixedDecimal(input.multiplier) !==
          fixedDecimal(str(previous.payload.multiplier) || '1')
      )
        fail('ENERGY_IDENTITY_LOCKED');
      if (
        start !== input.start ||
        fixedDecimal(reading) !== fixedDecimal(input.openingReading)
      )
        fail('ENERGY_READING_CHAIN_CONFLICT');
      return {
        configVersion: last!.version,
        previewHash: fingerprint({
          input,
          config: last!.version,
          lines: own.map((l) => [l.id, l.amountCents]),
        }),
      };
    };
    if (!write) return check(this.c());
    return this.atomic(
      access,
      'meterWrite',
      op,
      p,
      { adopt: input, op },
      async (c) => {
        const d = await check(c);
        if (d.previewHash !== op.previewHash) fail('ENERGY_CHANGED', 'ABORTED');
        const asset = p.assets.get(input.assetId)!,
          id = randomUUID(),
          m = energyRow({
            id,
            number: input.meterCode.toUpperCase(),
            code: input.meterCode.toUpperCase(),
            assetId: asset.id,
            projectId: asset.projectId,
            meterId: id,
            status: 'active',
            start: input.start,
            actor: access.actor,
            searchText: [input.meterCode, input.name, asset.name].join(' '),
            payload: {
              code: input.meterCode.toUpperCase(),
              name: input.name,
              type: input.feeType,
              assetId: asset.id,
              assetName: asset.name,
              installedOn: input.start,
              openingReading: input.openingReading,
              openingEvidence: input.evidence,
              multiplier: input.multiplier,
              unit: input.feeType === 'water' ? 'm³' : 'kWh',
              notes: '',
              adoptionConfigVersion: d.configVersion,
            },
          });
        await this.hyl.runtime.create(tables.meters, lifecycleValues(m), {
          actor: { id: access.actor },
          transaction: c,
        });
        const a = await this.assignmentDraft(
          c,
          m,
          {
            contractId: input.contractId,
            start: input.start,
            openingReading: input.openingReading,
            evidence: input.evidence,
            notes: '',
          },
          p.contracts.get(input.contractId)!,
        );
        a.actor = access.actor;
        await c
          .repository<EnergyRecord>(tables.assignments)
          .createOne({ values: a });
        await this.audit(c, m, access.actor, 'adopt');
        return m;
      },
    );
  }
  async legacyCandidates(access: Access, input: ListInput) {
    await this.hyl.get(access, 'contracts', input.contractId, 'billingRead');
    await this.hyl.get(
      access,
      'contracts',
      input.contractId,
      'billingConfigure',
    );
    await energyPolicy(access, 'meterWrite');
    const c = this.c(),
      last = (await configs(c, input.contractId)).at(-1),
      lines = await activeLines(c, input.contractId),
      bills = await c
        .repository<{
          id: string;
          contractId: string;
          number: string;
          status: string;
        }>('hylBills')
        .findMany({ filter: { contractId: input.contractId } }),
      result = [];
    for (const meter of last?.payload.meters ?? []) {
      if (!['water', 'electricity'].includes(meter.feeType)) continue;
      let assetName: string;
      try {
        const candidateAccess = await this.prepare(
          access,
          'meterWrite',
          [meter.assetId],
          [input.contractId],
          true,
          ['read', 'billingConfigure', 'billingRead'],
        );
        assetName = candidateAccess.assets.get(meter.assetId)?.name ?? '';
      } catch (e) {
        if (e instanceof ApiError) continue;
        throw e;
      }
      if (
        await c
          .repository('hylEnergyMeters')
          .exists({ filter: { code: meter.meterCode.toUpperCase() } })
      )
        continue;
      const own = lines
        .filter(
          (l) =>
            l.assetId === meter.assetId &&
            l.feeType === meter.feeType &&
            l.meterCode.toUpperCase() === meter.meterCode.toUpperCase(),
        )
        .sort((a, b) => a.end.localeCompare(b.end));
      const issued = own.filter((l) =>
          bills.some((b) => b.id === l.billId && b.status === 'issued'),
        ),
        previous = issued.at(-1),
        drafts = own.filter((l) =>
          bills.some((b) => b.id === l.billId && b.status === 'draft'),
        );
      const item = {
        id: meter.assetId + ':' + meter.feeType + ':' + meter.meterCode,
        meterCode: meter.meterCode,
        assetName,
        assetId: meter.assetId,
        feeType: meter.feeType,
        start: previous ? nextDay(previous.end) : meter.activeFrom,
        openingReading: previous
          ? str(previous.payload.current)
          : meter.openingReading,
        multiplier: previous ? str(previous.payload.multiplier) || '1' : '1',
        configVersion: last!.version,
        lastBillNumber:
          bills.find((b) => b.id === previous?.billId)?.number ?? '',
        lastBillEnd: previous?.end ?? '',
        draftCount: drafts.length,
        historyTotal: own.length,
        history: own
          .slice(-10)
          .reverse()
          .map((l) => ({
            id: l.id,
            billNumber: bills.find((b) => b.id === l.billId)?.number ?? '',
            start: l.start,
            end: l.end,
            current: l.payload.current,
            amountCents: l.amountCents,
            status: bills.find((b) => b.id === l.billId)?.status ?? '',
          })),
      };
      if (
        input.q &&
        !JSON.stringify(item).toLowerCase().includes(input.q.toLowerCase())
      )
        continue;
      result.push(item);
    }
    return {
      data: result.slice(
        (input.page - 1) * input.pageSize,
        input.page * input.pageSize,
      ),
      meta: {
        page: input.page,
        pageSize: input.pageSize,
        total: result.length,
      },
    };
  }

  async billingPrepared(access: Access, input: BillingValues) {
    const rows = await Promise.all(
      input.readingIds.map((id) => this.row(tables.readings, id)),
    );
    if (rows.some((r) => r.contractId !== input.contractId))
      fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    return this.prepare(
      access,
      'billGenerate',
      rows.map((r) => r.assetId),
      [input.contractId],
      false,
      ['read', 'billingRead', 'billWrite'],
    );
  }
  async billingDraft(_access: Access, input: BillingValues, c = this.c()) {
    const contract = (await c
      .repository<Row>('hylContracts')
      .findOne({ filter: { id: input.contractId } }))!;
    if ((await getLease(c, contract)).status === 'closed') fail('LEASE_CLOSED');
    const rows = await Promise.all(
        input.readingIds.map((id) => this.row(tables.readings, id, c)),
      ),
      fees = [...new Set(rows.map((r) => str(r.payload.feeType)))] as (
        'water' | 'electricity'
      )[];
    const values: BillValues = {
      month: input.month,
      part: input.part,
      dueDate: input.dueDate,
      fees,
      readingIds: input.readingIds,
      readings: [],
      others: [],
      acknowledgeGaps: false,
      zeroReason: input.zeroReason,
      zeroEvidence: input.zeroEvidence,
      notes: input.notes,
    };
    let result;
    try {
      result = await previewBill(c, contract, values);
    } catch (e) {
      if (
        e instanceof ApiError &&
        e.reason === 'BILLING_ZERO_EVIDENCE_REQUIRED'
      ) {
        return {
          canGenerate: false,
          requiresZeroEvidence: true,
          previewHash: null,
          amountCents: '0',
          contractVersion: contract.version,
          configVersion: 0,
          lines: (
            await previewBill(c, contract, {
              ...values,
              zeroReason: 'preview',
              zeroEvidence: 'preview',
            })
          ).lines,
          values,
        };
      }
      throw e;
    }
    const expected = [];
    for (const r of rows) {
      const m = await this.row(tables.meters, r.meterId, c),
        a = await this.row(tables.assignments, str(r.payload.assignmentId), c);
      expected.push([r.id, r.version, m.version, a.version]);
    }
    return {
      ...result,
      canGenerate: true,
      requiresZeroEvidence: result.lines.some((l) => l.amountCents === '0'),
      contractVersion: contract.version,
      configVersion: result.config.version,
      previewHash: fingerprint({
        input,
        contractVersion: contract.version,
        configVersion: result.config.version,
        expected,
      }),
      values,
    };
  }
  async generate(
    access: Access,
    input: BillingValues,
    op: Operation,
    write = false,
  ) {
    const p = await this.billingPrepared(access, input);
    if (!write) return this.billingDraft(access, input);
    return this.atomic(
      access,
      'billGenerate',
      op,
      p,
      { generate: input, op },
      async (c) => {
        const draft = await this.billingDraft(access, input, c);
        if (!draft.canGenerate || draft.previewHash !== op.previewHash)
          fail('ENERGY_CHANGED', 'ABORTED');
        const contract = p.contracts.get(input.contractId)!,
          billing = new BillingService(this.hyl, {
            connection: c,
            policies: p.policies,
            actor: access.actor,
            merchantId: contract.merchantId,
          });
        const bill = await billing.createBill(access, {
          ...draft.values,
          requestId: op.requestId,
          contractId: contract.id,
          expectedContractVersion: draft.contractVersion,
          configVersion: draft.configVersion,
        });
        await syncContract(c, this.hyl, contract.id, access.actor);
        return bill;
      },
    );
  }
  async allowed(access: Access, r: EnergyRecord) {
    const result = [];
    for (const a of energyActions)
      try {
        await this.prepare(access, a, [r.assetId], [r.contractId]);
        result.push(a);
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
      }
    return result;
  }
  async view(
    r: EnergyRecord,
    c = this.c(),
    access?: Access,
  ): Promise<EnergyRecord & Record<string, unknown>> {
    const meter = r.meterId
      ? await c
          .repository<EnergyRecord>(tables.meters)
          .findOne({ filter: { id: r.meterId } })
      : undefined;
    const links = await c
        .repository<EnergyRecord>('hylEnergyBillLinks')
        .findMany({ filter: { activeReadingId: r.id } }),
      link = links[0];
    const released =
      !link &&
      r.status === 'approved' &&
      (
        await c
          .repository<EnergyRecord>('hylEnergyBillLinks')
          .findMany({ filter: { meterId: r.meterId, status: 'released' } })
      ).some((x) => x.payload.readingId === r.id);
    let latest: EnergyRecord | undefined;
    if (r.id === r.meterId && access) {
      const candidates = (
        await c
          .repository<EnergyRecord>(tables.readings)
          .findMany({ filter: { meterId: r.id, status: 'approved' } })
      ).sort((a, b) => b.end.localeCompare(a.end));
      for (const candidate of candidates) {
        try {
          await this.prepare(
            access,
            'readingRead',
            [candidate.assetId],
            [candidate.contractId],
          );
          latest = candidate;
          break;
        } catch (e) {
          if (!(e instanceof ApiError)) throw e;
        }
      }
    }
    const contract =
      r.contractId && access
        ? await this.hyl.get(access, 'contracts', r.contractId, 'read', c)
        : undefined;
    return {
      ...r,
      ...r.payload,
      contractTitle: contract?.payload.title ?? '',
      contractMerchantName: contract?.name ?? '',
      meterCode: meter?.code ?? r.code,
      feeType: r.payload.feeType ?? meter?.payload.type,
      type: r.payload.type ?? r.payload.feeType ?? meter?.payload.type,
      meterVersion: meter?.version,
      ...(r.id === r.meterId
        ? {
            latestReading: latest?.payload.current,
            latestReadingEnd: latest?.end ?? '',
          }
        : {}),
      actor: r.actor ? ((await this.hyl.users.get(r.actor))?.name ?? '') : '',
      reviewer: r.payload.reviewer
        ? ((await this.hyl.users.get(str(r.payload.reviewer)))?.name ?? '')
        : '',
      billNumber:
        link?.billId || r.billId
          ? (
              await c
                .repository('hylBills')
                .findOne({ filter: { id: link?.billId || r.billId } })
            )?.number
          : '',
      billingStatus: link
        ? link.status === 'issued'
          ? 'issued'
          : 'reserved'
        : released
          ? 'released'
          : 'unbilled',
      billId: link?.billId || r.billId || '',
      amountCents: link?.payload.amountCents ?? r.payload.amountCents ?? '0',
    };
  }
  async list(access: Access, kind: keyof typeof tables, input: ListInput) {
    const action =
        kind === 'meters' || kind === 'assignments'
          ? 'meterRead'
          : kind === 'billing'
            ? 'billGenerate'
            : 'readingRead',
      ep = await energyPolicy(access, action),
      ap = await assetPolicy(access, 'read');
    const energyAssets = await this.c()
        .repository<Asset>('hylAssets')
        .withPolicy(ep)
        .findMany(),
      assets = await this.c()
        .repository<Asset>('hylAssets')
        .withPolicy(ap)
        .findMany(),
      allowed = new Set<string>(
        energyAssets
          .filter((a) => assets.some((x) => x.id === a.id))
          .map((a) => str(a.id)),
      );
    const repo = this.c().repository<EnergyRecord>(tables[kind]),
      base = allowed.size
        ? await repo.findMany({
            filter: buildFilter((f) =>
              f.or([...allowed].map((id) => f.string('assetId').eq(id))),
            ),
          })
        : [],
      visible = [];
    for (const r of allowed.size ? base : []) {
      try {
        if (r.contractId)
          await this.hyl.get(access, 'contracts', r.contractId, 'read');
      } catch (e) {
        if (e instanceof ApiError) continue;
        throw e;
      }
      const v = await this.view(r, this.c(), access);
      if (kind === 'billing' && r.status !== 'approved') continue;
      if (
        input.q &&
        ![
          r.searchText,
          r.number,
          v.meterCode,
          v.contractNumber,
          v.contractTitle,
          v.contractMerchantName,
          v.assetName,
        ]
          .map(str)
          .join(' ')
          .toLowerCase()
          .includes(input.q.toLowerCase())
      )
        continue;
      if (input.type && input.type !== str(v.type ?? v.feeType)) continue;
      if (input.assetId && r.assetId !== input.assetId) continue;
      if (input.contractId && r.contractId !== input.contractId) {
        if (
          kind !== 'meters' ||
          !(await this.c()
            .repository('hylEnergyAssignments')
            .exists({
              filter: { meterId: r.id, contractId: input.contractId },
            }))
        )
          continue;
      }
      if (input.meterId && r.meterId !== input.meterId) continue;
      if (input.assignmentId && r.payload.assignmentId !== input.assignmentId)
        continue;
      if (input.billId && v.billId !== input.billId) continue;
      if (input.status && r.status !== input.status) continue;
      if (
        input.billingStatus &&
        (input.billingStatus === 'unbilled'
          ? !['unbilled', 'released'].includes(str(v.billingStatus))
          : v.billingStatus !== input.billingStatus)
      )
        continue;
      if (input.from && r.end < input.from) continue;
      if (input.to && r.start > input.to) continue;
      visible.push({ ...v, allowedActions: await this.allowed(access, r) });
    }
    return this.page(visible, input.page, input.pageSize, input.orderBy);
  }
  page<T extends Record<string, unknown>>(
    rows: T[],
    page = 1,
    pageSize = 20,
    order = '-updatedAt',
  ) {
    const key = order.replace(/^-/, '');
    if (
      ![
        'updatedAt',
        'createdAt',
        'start',
        'end',
        'usageKey',
        'version',
        'number',
        'amountCents',
        'current',
        'multiplier',
        'installedOn',
        'latestReading',
        'latestReadingEnd',
        'openingReading',
        'closingReading',
      ].includes(key)
    )
      fail('INVALID_SORT', 'INVALID_ARGUMENT');
    rows.sort((a, b) => {
      const av = [
          'multiplier',
          'current',
          'latestReading',
          'openingReading',
          'closingReading',
        ].includes(key)
          ? usageSortKey(str(a[key]) || '0')
          : str(a[key]),
        bv = [
          'multiplier',
          'current',
          'latestReading',
          'openingReading',
          'closingReading',
        ].includes(key)
          ? usageSortKey(str(b[key]) || '0')
          : str(b[key]);
      const result =
        key === 'amountCents'
          ? BigInt(av || '0') < BigInt(bv || '0')
            ? -1
            : BigInt(av || '0') > BigInt(bv || '0')
              ? 1
              : 0
          : av.localeCompare(bv);
      return (
        (order.startsWith('-') ? -result : result) ||
        str(a.id).localeCompare(str(b.id))
      );
    });
    return {
      data: rows.slice((page - 1) * pageSize, page * pageSize),
      meta: { page, pageSize, total: rows.length },
    };
  }
  async detail(
    access: Access,
    kind: 'meters' | 'readings',
    id: string,
    pages: Record<string, string> = {},
  ) {
    const r = await this.checked(
        access,
        tables[kind],
        id,
        kind === 'meters' ? 'meterRead' : 'readingRead',
      ),
      result = {
        ...(await this.view(r, this.c(), access)),
        allowedActions: await this.allowed(access, r),
      },
      c = this.c();
    const blocks: Record<string, unknown> = {};
    for (const [name, table] of [
      ['assignments', tables.assignments],
      ['readings', tables.readings],
      ['bills', 'hylEnergyBillLinks'],
      ['audit', 'hylEnergyAudit'],
    ]) {
      const rows = await c
          .repository<EnergyRecord>(table)
          .findMany({ filter: { meterId: r.meterId } }),
        visible = [];
      let restricted = false;
      for (const x of rows) {
        if (
          kind === 'readings' &&
          (name === 'readings'
            ? x.id !== id
            : name === 'bills'
              ? x.payload.readingId !== id
              : name === 'audit'
                ? x.payload.recordId !== id
                : x.id !== str(r.payload.assignmentId))
        )
          continue;
        try {
          await this.prepare(
            access,
            name === 'assignments' ? 'meterRead' : 'readingRead',
            [x.assetId],
            [x.contractId],
          );
          if (name === 'bills')
            await this.hyl.get(
              access,
              'contracts',
              x.contractId,
              'billingRead',
            );
          visible.push(await this.view(x, c, access));
        } catch (e) {
          if (!(e instanceof ApiError)) throw e;
          restricted = true;
        }
      }
      blocks[name] = {
        ...this.page(
          visible,
          Number(pages[name] ?? 1),
          20,
          pages[name + 'Order'] ?? '-createdAt',
        ),
        restricted,
      };
    }
    return { ...result, ...blocks };
  }
}
