import {
  editable as approvalEditable,
  approved as approvalApproved,
} from '../approvals/gate.js';
import {
  reserveSources,
  syncEnergyBill,
  registry,
} from '../energy/registry.js';
import { prepareEnergyBillAccess } from '../energy/access.js';
import { flushInvoices } from '../invoicing/queue.js';
import { syncContract } from '../profit-sharing/projection.js';
import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseConnection, RepositoryPolicy } from '@nocobase/db';
import { ApiError } from '@nocobase/app-server/router';
import { buildFilter } from '@nocobase/repository-input';
import type { Row } from '../hyl/schema.js';
import { fail, type Access, type HylService } from '../hyl/service.js';
import { cents, money } from '../hyl/calculation.js';
import {
  depositBalance,
  effectiveEnd,
  getLease,
  type Entry,
} from '../leases/model.js';
import type { ContractAsset } from '../assets/schema.js';
import {
  configs,
  configAt,
  activeLines,
  closingBlockers,
  recalculateBill,
} from './accounting.js';
import { businessDay, fixedDecimal } from './calculation.js';
import { assertConfigExpenses, previewBill } from './engine.js';
import {
  billingActions,
  billStatus,
  receiptStatus,
  type Bill,
  type BillLine,
  type BillingAction,
  type BillingConfig,
  type BillingList,
  type BillingOperation,
  type BillValues,
  type Receipt,
  type ReceiptEntry,
  type configSchema,
  type billCreateSchema,
  type billEditSchema,
} from './model.js';
import { recordReceipt, operateReceipt } from './cash.js';
import type { z } from 'zod';

export class BillingService {
  constructor(
    readonly hyl: HylService,
    readonly transactionScope?: {
      connection: DatabaseConnection;
      policies: ReadonlyMap<string, RepositoryPolicy>;
      actor: string;
      merchantId: string;
    },
  ) {}
  connection() {
    return this.transactionScope?.connection ?? this.hyl.db.connection();
  }
  async resolvedPolicy(access: Access, action: string) {
    if (!this.transactionScope)
      return this.hyl.policy(access, 'contracts', action);
    if (access.actor !== this.transactionScope.actor)
      fail('ACCESS_DENIED', 'PERMISSION_DENIED');
    const policy = this.transactionScope.policies.get(action);
    if (!policy) fail('ACCESS_DENIED', 'PERMISSION_DENIED');
    return policy;
  }
  async parent(
    access: Access,
    id: string,
    action: string,
    c = this.connection(),
    policy?: RepositoryPolicy,
  ) {
    const row = await this.hyl.get(
      access,
      'contracts',
      id,
      action,
      c,
      policy ?? (await this.resolvedPolicy(access, action)),
    );
    if (
      this.transactionScope &&
      row.merchantId !== this.transactionScope.merchantId
    )
      fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    return row;
  }
  /** Policies resolve before the SQLite transaction; every cash/deposit/lease writer takes this merchant lock. */
  async mutate<T>(
    access: Access,
    id: string,
    action: BillingAction,
    body: { requestId: string },
    fn: (c: DatabaseConnection, row: Row) => Promise<T>,
  ): Promise<T> {
    const policy = await this.resolvedPolicy(access, action);
    const original = await this.parent(access, id, action, undefined, policy);
    if (this.transactionScope) {
      if ((await getLease(this.connection(), original)).status === 'closed')
        fail('LEASE_CLOSED');
      const result = await fn(this.connection(), original);
      await syncContract(this.connection(), this.hyl, id, access.actor);
      return result;
    }
    const hash = createHash('sha256')
      .update(JSON.stringify({ action, id, body, actor: access.actor }))
      .digest('hex');
    return this.hyl.db.transaction(async (c) => {
      await this.hyl.lockMerchant(c, original.merchantId);
      const row = await this.parent(access, id, action, c, policy);
      const old = await c
        .repository('hylBillingOperations')
        .findOne({ filter: { id: body.requestId } });
      if (old) {
        if (
          old.actor !== access.actor ||
          old.contractId !== id ||
          old.hash !== hash
        )
          fail('BILLING_REQUEST_REUSED', 'ALREADY_EXISTS');
        return (old.payload as { result: T }).result;
      }
      if ((await getLease(c, row)).status === 'closed') fail('LEASE_CLOSED');
      const result = await fn(c, row);
      await syncContract(c, this.hyl, id, access.actor);
      await flushInvoices(c, this.hyl, access.actor);
      await c.repository('hylBillingOperations').createOne({
        values: {
          id: body.requestId,
          contractId: id,
          actor: access.actor,
          hash,
          payload: { result },
          createdAt: new Date().toISOString(),
        },
      });
      return result;
    });
  }
  async allowed(access: Access, id: string) {
    const result: string[] = [];
    for (const action of billingActions) {
      try {
        await this.parent(access, id, action);
        result.push(action);
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
      }
    }
    for (const action of ['depositRead', 'depositDeduct', 'depositReverse']) {
      try {
        await this.hyl.get(access, 'contracts', id, action);
        result.push(action);
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
      }
    }
    return result;
  }
  async configuration(access: Access, id: string, configure = false) {
    let contract: Row | undefined;
    for (const action of (configure
      ? ['billingConfigure', 'billingRead', 'billWrite']
      : ['billingRead']) as BillingAction[]) {
      try {
        contract = await this.parent(access, id, action);
        break;
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
      }
    }
    if (!contract) fail('ACCESS_DENIED', 'PERMISSION_DENIED');
    const c = this.connection(),
      history = await configs(c, id),
      lease = await getLease(c, contract);
    const assets = await c
      .repository<ContractAsset>('hylContractAssets')
      .findMany({ filter: { contractId: id } });
    const settlements = await c
      .repository<Row>('hylSettlements')
      .findMany({ filter: { merchantId: contract.merchantId } });
    const used =
      (await c.repository<Bill>('hylBills').exists({
        filter: buildFilter((f) =>
          f.and([
            f.string('contractId').eq(id),
            f.string('status').ne('voided'),
          ]),
        ),
      })) ||
      settlements.some(
        (s) => s.payload.contractId === id && s.status !== 'cancelled',
      );
    return {
      contract: {
        id,
        number: contract.number,
        merchantId: contract.merchantId,
        version: contract.version,
        title: contract.payload.title,
        start: contract.payload.start,
        end: await effectiveEnd(c, contract),
        cycle: contract.payload.cycle,
        rent: contract.payload.rent,
      },
      lease,
      history,
      version: history.at(-1)?.version ?? 0,
      assets,
      channelLocked: used,
      allowedActions: await this.allowed(access, id),
    };
  }
  async saveConfiguration(
    access: Access,
    id: string,
    body: z.infer<typeof configSchema>,
  ) {
    return this.mutate(
      access,
      id,
      'billingConfigure',
      body,
      async (c, contract) => {
        const history = await configs(c, id),
          last = history.at(-1),
          version = last?.version ?? 0;
        if (version !== body.expectedVersion)
          fail('VERSION_CONFLICT', 'ABORTED');
        const { requestId: _r, expectedVersion: _v, ...payload } = body;
        void _r;
        void _v;
        const end = await effectiveEnd(c, contract),
          start = String(contract.payload.start);
        if (
          body.effectiveFrom < start ||
          body.effectiveFrom > end ||
          (!last && body.effectiveFrom !== start)
        )
          fail('INVALID_PERIOD', 'INVALID_ARGUMENT');
        const bills = await c
          .repository<Bill>('hylBills')
          .findMany({ filter: { contractId: id } });
        const active = bills.filter((b) => b.status !== 'voided');
        const cash = await c
          .repository<Receipt>('hylReceipts')
          .findMany({ filter: { contractId: id } });
        const activeCash = cash.some(
          (r) =>
            r.status !== 'voided' &&
            (BigInt(r.unusedCents) > 0n || BigInt(r.allocatedCents) > 0n),
        );
        const settlements = (
          await c
            .repository<Row>('hylSettlements')
            .findMany({ filter: { merchantId: contract.merchantId } })
        ).filter(
          (s) => s.payload.contractId === id && s.status !== 'cancelled',
        );
        if (
          (active.length || settlements.length || activeCash) &&
          body.rentChannel !== (last?.payload.rentChannel ?? 'settlement')
        )
          fail('BILLING_CHANNEL_LOCKED');
        const replacing = last?.effectiveFrom === body.effectiveFrom;
        if (
          last &&
          !replacing &&
          (body.effectiveFrom <= last.effectiveFrom ||
            ![
              ...(contract.payload.cycle === 'half' ? ['01', '16'] : ['01']),
            ].includes(body.effectiveFrom.slice(8)))
        )
          fail('INVALID_PERIOD', 'INVALID_ARGUMENT');
        if (
          active.some((b) => b.cycleEnd >= body.effectiveFrom) ||
          (replacing &&
            settlements.some(
              (s) => String(s.payload.end) >= body.effectiveFrom,
            ))
        )
          fail('BILLING_CONFIG_LOCKED');
        const links = await c
          .repository<ContractAsset>('hylContractAssets')
          .findMany({ filter: { contractId: id } });
        if (
          body.property.enabled &&
          (fixedDecimal(body.property.price) <= 0n ||
            (body.property.method === 'area' &&
              links.reduce(
                (n, l) =>
                  n + fixedDecimal(String(l.snapshot.lettableArea ?? '0')),
                0n,
              ) <= 0n))
        )
          fail('BILLING_AREA_REQUIRED', 'INVALID_ARGUMENT');
        const keys = new Set<string>();
        const managedRegistry = await registry(c, id);
        for (const type of Object.keys(body.utilities)) {
          if (
            fixedDecimal(
              body.utilities[type as keyof typeof body.utilities]!,
            ) <= 0n ||
            (!managedRegistry.some(
              ({ a, m }) =>
                m.payload.type === type &&
                (!a.end || a.end >= body.effectiveFrom),
            ) &&
              !body.meters.some(
                (m) =>
                  m.feeType === type &&
                  (!m.activeTo || m.activeTo >= body.effectiveFrom),
              ))
          )
            fail('BILLING_METER_REQUIRED', 'INVALID_ARGUMENT');
        }
        for (const m of body.meters) {
          const managed = managedRegistry.find(
            (x) =>
              x.m.assetId === m.assetId &&
              x.m.payload.type === m.feeType &&
              x.m.code === m.meterCode.toUpperCase(),
          );
          if (managed) {
            const old = last?.payload.meters.find(
              (x) =>
                x.assetId === m.assetId &&
                x.feeType === m.feeType &&
                x.meterCode.toUpperCase() === managed.m.code,
            );
            if (!old || JSON.stringify(old) !== JSON.stringify(m))
              fail('ENERGY_MANAGED_METER_REQUIRED');
          }
          const key = `${m.assetId}:${m.feeType}:${m.meterCode}`;
          if (
            keys.has(key) ||
            !links.some((l) => l.assetId === m.assetId) ||
            (!Object.hasOwn(body.utilities, m.feeType) &&
              !(
                m.activeTo &&
                m.activeTo < body.effectiveFrom &&
                m.stopEvidence &&
                m.stopReading !== undefined
              )) ||
            m.activeFrom < start ||
            m.activeFrom > end ||
            (m.activeTo &&
              (m.activeTo < m.activeFrom ||
                m.activeTo > String(contract.payload.end) ||
                !m.stopEvidence ||
                m.stopReading === undefined ||
                fixedDecimal(m.stopReading) < fixedDecimal(m.openingReading)))
          )
            fail('BILLING_METER_REQUIRED', 'INVALID_ARGUMENT');
          keys.add(key);
        }
        // A future tariff version cannot make an old, active meter vanish without its final evidence.
        for (const old of last?.payload.meters ?? []) {
          const next = body.meters.find(
            (m) =>
              m.assetId === old.assetId &&
              m.feeType === old.feeType &&
              m.meterCode === old.meterCode,
          );
          if (
            next &&
            (next.activeFrom !== old.activeFrom ||
              next.openingReading !== old.openingReading)
          )
            fail('BILLING_READING_CONFLICT');
          if (
            !next &&
            (!old.activeTo ||
              old.activeTo >= body.effectiveFrom ||
              !old.stopEvidence ||
              old.stopReading === undefined)
          )
            fail('BILLING_METER_STOP_REQUIRED');
        }
        for (const meter of body.meters.filter(
          (m) => m.activeTo && m.stopReading !== undefined,
        )) {
          const ending = (await activeLines(c, id)).find(
            (line) =>
              line.assetId === meter.assetId &&
              line.meterCode === meter.meterCode &&
              line.feeType === meter.feeType &&
              line.end === meter.activeTo,
          );
          if (
            ending &&
            fixedDecimal(String(ending.payload.current)) !==
              fixedDecimal(meter.stopReading!)
          )
            fail('BILLING_READING_CONFLICT');
        }
        await assertConfigExpenses(c, contract, payload, end);
        const values: BillingConfig = {
          id: replacing ? last.id : randomUUID(),
          contractId: id,
          merchantId: contract.merchantId,
          version: version + 1,
          effectiveFrom: body.effectiveFrom,
          payload,
          createdAt: new Date().toISOString(),
        };
        if (replacing)
          await c
            .repository<BillingConfig>('hylBillingConfigs')
            .updateOne({ filter: { id: last.id, version }, values });
        else
          await c
            .repository<BillingConfig>('hylBillingConfigs')
            .createOne({ values });
        await this.audit(c, id, access, 'configure', {
          version: values.version,
          effectiveFrom: values.effectiveFrom,
        });
        return values;
      },
    );
  }
  async preview(access: Access, id: string, input: BillValues, billId = '') {
    const row = await this.parent(access, id, 'billWrite');
    if ((await getLease(this.hyl.db.connection(), row)).status === 'closed')
      fail('LEASE_CLOSED');
    if (billId && (await this.findBill(billId)).contractId !== id)
      fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    if (input.readingIds?.length)
      await prepareEnergyBillAccess(this.hyl, access, id, input.readingIds);
    return previewBill(this.hyl.db.connection(), row, input, billId);
  }
  async createBill(access: Access, body: z.infer<typeof billCreateSchema>) {
    if (!this.transactionScope && body.readingIds?.length)
      await prepareEnergyBillAccess(
        this.hyl,
        access,
        body.contractId,
        body.readingIds,
      );
    return this.mutate(
      access,
      body.contractId,
      'billWrite',
      body,
      async (c, row) => {
        if (row.version !== body.expectedContractVersion)
          fail('VERSION_CONFLICT', 'ABORTED');
        const result = await previewBill(c, row, body, '', body.requestId);
        if (result.config.version !== body.configVersion)
          fail('VERSION_CONFLICT', 'ABORTED');
        if (result.warnings.length && !body.acknowledgeGaps)
          fail('BILLING_READING_GAP');
        const id = randomUUID(),
          now = new Date().toISOString();
        const created = await this.hyl.runtime.create(
          'hylBills',
          {
            id,
            number: `ZD-${body.month.replace('-', '')}-${id.slice(0, 8)}`,
            contractId: row.id,
            merchantId: row.merchantId,
            version: 0,
            cycleStart: result.cycleStart,
            cycleEnd: result.cycleEnd,
            start: result.start,
            end: result.end,
            date: result.start,
            dueDate: body.dueDate,
            amountCents: result.amountCents,
            depositCents: '0',
            allocatedCents: '0',
            remainingCents: result.amountCents,
            payload: this.snapshot(
              row,
              { ...body, others: result.others },
              result.config,
              access.actor,
            ),
            createdAt: now,
            updatedAt: now,
          },
          { actor: { id: access.actor }, transaction: c },
        );
        for (const line of result.lines)
          await c
            .repository<BillLine>('hylBillLines')
            .createOne({ values: { ...line, billId: id } });
        await reserveSources(
          c,
          id,
          result.lines.map((l) => ({ ...l, billId: id })),
          access.actor,
        );
        await this.audit(c, row.id, access, 'createBill', { billId: id });
        return created.record as unknown as Bill;
      },
    );
  }
  snapshot(
    row: Row,
    input: BillValues,
    config: BillingConfig,
    actor: string,
  ): Bill['payload'] {
    // Whitelist signed pricing data; the deposit target/bank details are not bill read data.
    const { title, rent, start, end, cycle, number } = row.payload;
    const {
      month,
      part,
      dueDate,
      fees,
      readings,
      readingIds,
      others,
      acknowledgeGaps,
      zeroReason,
      zeroEvidence,
      notes,
    } = input;
    return {
      input: {
        month,
        part,
        dueDate,
        fees,
        readings,
        ...(readingIds?.length ? { readingIds } : {}),
        others,
        acknowledgeGaps,
        zeroReason,
        zeroEvidence,
        notes,
      },
      configVersion: config.version,
      config: config.payload,
      contract: { title, rent, start, end, cycle, number },
      actor,
      notes,
    };
  }
  async findBill(id: string, c = this.connection()) {
    const row = await c
      .repository<Bill>('hylBills')
      .findOne({ filter: { id } });
    if (!row) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    return row;
  }
  async findReceipt(id: string, c = this.connection()) {
    const row = await c
      .repository<Receipt>('hylReceipts')
      .findOne({ filter: { id } });
    if (!row) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    return row;
  }
  async editBill(
    access: Access,
    id: string,
    body: z.infer<typeof billEditSchema>,
  ) {
    const original = await this.findBill(id);
    return this.mutate(
      access,
      original.contractId,
      'billWrite',
      Object.assign({}, body, { billId: id, operation: 'edit' }),
      async (c, row) => {
        const bill = await this.findBill(id, c);
        await approvalEditable(c, 'bills', id);
        this.version(bill, body.expectedVersion);
        if (bill.status !== 'draft') fail('BILLING_NOT_DRAFT');
        const managed = await c
          .repository('hylEnergyBillLinks')
          .exists({ filter: { billId: id, status: 'reserved' } });
        if (managed) {
          const original = bill.payload.input;
          for (const key of [
            'month',
            'part',
            'readingIds',
            'zeroReason',
            'zeroEvidence',
          ] as const)
            if (
              JSON.stringify(body[key] ?? '') !==
              JSON.stringify(original[key] ?? '')
            )
              fail('ENERGY_MANAGED_METER_REQUIRED');
        }
        const result = await previewBill(c, row, body, id, body.requestId);
        if (result.config.version !== body.configVersion)
          fail('VERSION_CONFLICT', 'ABORTED');
        if (result.warnings.length && !body.acknowledgeGaps)
          fail('BILLING_READING_GAP');
        const oldLines = await c
          .repository<BillLine>('hylBillLines')
          .findMany({ filter: { billId: id } });
        // Keep managed rows and their source-link IDs stable; other draft fees remain editable.
        for (const line of result.lines) {
          if (managed && line.payload.readingId) {
            const old = oldLines.find(
              (l) => l.payload.readingId === line.payload.readingId,
            );
            if (
              !old ||
              old.amountCents !== line.amountCents ||
              old.start !== line.start ||
              old.end !== line.end ||
              old.sourceKey !== line.sourceKey ||
              [
                'previous',
                'current',
                'multiplier',
                'usage',
                'unitPrice',
                'configVersion',
                'readingVersion',
                'assignmentVersion',
              ].some(
                (k) =>
                  JSON.stringify(old.payload[k]) !==
                  JSON.stringify(line.payload[k]),
              )
            )
              fail('ENERGY_CHANGED', 'ABORTED');
          }
        }
        for (const line of oldLines)
          if (!managed || !line.payload.readingId)
            await c
              .repository<BillLine>('hylBillLines')
              .deleteMany({ filter: { id: line.id } });
        for (const line of result.lines)
          if (!managed || !line.payload.readingId)
            await c
              .repository<BillLine>('hylBillLines')
              .createOne({ values: { ...line, billId: id } });
        const values = {
          cycleStart: result.cycleStart,
          cycleEnd: result.cycleEnd,
          start: result.start,
          end: result.end,
          date: result.start,
          dueDate: body.dueDate,
          amountCents: result.amountCents,
          remainingCents: result.amountCents,
          version: bill.version + 1,
          updatedAt: new Date().toISOString(),
          payload: this.snapshot(
            row,
            { ...body, others: result.others },
            result.config,
            access.actor,
          ),
        };
        await c
          .repository<Bill>('hylBills')
          .updateOne({ filter: { id, version: bill.version }, values });
        await this.audit(c, row.id, access, 'editBill', { billId: id });
        return { ...bill, ...values };
      },
    );
  }
  version(row: { version: number }, expected: number) {
    if (row.version !== expected) fail('VERSION_CONFLICT', 'ABORTED');
  }
  async billAction(
    access: Access,
    id: string,
    action: string,
    body: BillingOperation,
    approvalCommit?: (c: DatabaseConnection, bill: Bill) => Promise<void>,
  ) {
    const original = await this.findBill(id);
    const permission =
      action === 'issue'
        ? 'billIssue'
        : action === 'void'
          ? 'billVoid'
          : 'billingRead';
    if (action === 'applyDeposit') {
      await this.parent(access, original.contractId, 'depositRead');
      await this.parent(access, original.contractId, 'depositDeduct');
    }
    return this.mutate(
      access,
      original.contractId,
      permission,
      Object.assign({}, body, { billId: id, operation: action }),
      async (c, contract) => {
        let bill = await this.findBill(id, c);
        if (approvalCommit) await approvalCommit(c, bill);
        await approvalEditable(c, 'bills', id);
        this.version(bill, body.expectedVersion);
        if (action === 'issue') {
          await approvalApproved(this.hyl.db, c, 'bills', id, bill.version);
          if (bill.status !== 'draft') fail('BILLING_NOT_DRAFT');
          const checked = await previewBill(
            c,
            contract,
            bill.payload.input,
            id,
          );
          if (
            checked.config.version !== bill.payload.configVersion ||
            checked.amountCents !== bill.amountCents ||
            checked.start !== bill.start ||
            checked.end !== bill.end
          )
            fail('VERSION_CONFLICT', 'ABORTED');
          await this.hyl.runtime.fire('hylBills', id, 'issue', {
            actor: { id: access.actor },
            transaction: c,
            expect: { version: bill.lifecycleVersion },
          });
        } else if (action === 'void') {
          this.reason(body);
          if (
            bill.status === 'voided' ||
            BigInt(bill.depositCents) ||
            BigInt(bill.allocatedCents)
          )
            fail('BILLING_HAS_ALLOCATIONS');
          await this.hyl.runtime.fire('hylBills', id, 'void', {
            actor: { id: access.actor },
            transaction: c,
            expect: { version: bill.lifecycleVersion },
          });
        } else if (action === 'applyDeposit') {
          this.reason(body);
          if (!body.date || cents(body.amount) <= 0n)
            fail('PAYMENT_REQUIRED', 'INVALID_ARGUMENT');
          if (bill.status !== 'issued') fail('BILLING_NOT_ISSUED');
          let lease = await getLease(c, contract);
          this.version(lease, body.expectedLeaseVersion ?? -1);
          const entries = await c
            .repository<Entry>('hylLeaseEntries')
            .findMany({ filter: { contractId: contract.id } });
          if (cents(body.amount) > depositBalance(entries))
            fail('DEPOSIT_OVERDRAW');
          if (cents(body.amount) > BigInt(bill.remainingCents))
            fail('OVERPAYMENT');
          if (
            !(await c
              .repository('hylLeases')
              .exists({ filter: { id: contract.id } }))
          ) {
            await this.hyl.runtime.create(
              'hylLeases',
              {
                id: contract.id,
                merchantId: contract.merchantId,
                version: 0,
                actualEnd: '',
                payload: {},
              },
              { actor: { id: access.actor }, transaction: c },
            );
            lease = await getLease(c, contract);
          }
          await c.repository<Entry>('hylLeaseEntries').createOne({
            values: {
              id: randomUUID(),
              contractId: contract.id,
              merchantId: contract.merchantId,
              requestId: body.requestId,
              reference: null,
              kind: 'deduct',
              amountCents: cents(body.amount).toString(),
              sourceId: id,
              reverseOf: null,
              pairId: '',
              payload: { ...body, sourceType: 'bill', actor: access.actor },
              createdAt: new Date().toISOString(),
            },
          });
          await c.repository('hylLeases').updateOne({
            filter: { id: contract.id, version: lease.version },
            values: { version: lease.version + 1 },
          });
        } else fail('INVALID_ACTION', 'INVALID_ARGUMENT');
        bill = await recalculateBill(c, id);
        await syncEnergyBill(c, id, bill.status);
        await this.audit(c, contract.id, access, action, {
          billId: id,
          ...body,
        });
        return bill;
      },
    );
  }
  reason(body: { reason: string; evidence: string }) {
    if (!body.reason || !body.evidence)
      fail('CONFIRMATION_EVIDENCE_REQUIRED', 'INVALID_ARGUMENT');
  }
  async audit(
    c: DatabaseConnection,
    id: string,
    access: Access,
    action: string,
    detail: unknown,
  ) {
    await c.repository('hylEvents').createOne({
      values: {
        id: randomUUID(),
        recordId: id,
        payload: {
          action: `billing.${action}`,
          actor: access.actor,
          at: new Date().toISOString(),
          detail,
        },
      },
    });
  }
  recordReceipt = recordReceipt;
  operateReceipt = operateReceipt;
  async billDetail(
    access: Access,
    id: string,
    linePage = 1,
    ledgerPage = 1,
    auditPage = 1,
  ) {
    const bill = await this.findBill(id);
    await this.parent(access, bill.contractId, 'billingRead');
    const allowedActions = await this.allowed(access, bill.contractId),
      c = this.connection();
    const lines = await this.page(c, 'hylBillLines', { billId: id }, linePage);
    const cash = allowedActions.includes('receiptRead')
      ? await c.repository<ReceiptEntry>('hylReceiptEntries').findMany({
          filter: { billId: id },
          sort: (s) => [s.field('createdAt').desc()],
        })
      : [];
    const deposit = allowedActions.includes('depositRead')
      ? (
          await c
            .repository<Entry>('hylLeaseEntries')
            .findMany({ filter: { contractId: bill.contractId } })
        ).filter((e) => e.sourceId === id)
      : [];
    const allEntries = allowedActions.includes('depositRead')
      ? await c
          .repository<Entry>('hylLeaseEntries')
          .findMany({ filter: { contractId: bill.contractId } })
      : [];
    const ids = new Set(deposit.map((e) => e.id));
    const receiptNames = new Map(
      (allowedActions.includes('receiptRead')
        ? await c
            .repository<Receipt>('hylReceipts')
            .findMany({ filter: { contractId: bill.contractId } })
        : []
      ).map((r) => [r.id, r.number]),
    );
    const ledger = [
      ...cash.map((e) => ({
        ...e,
        sourceType: 'receipt',
        sourceNumber: receiptNames.get(e.receiptId) ?? null,
        reversed: cash.some((x) => x.reverseOf === e.id),
      })),
      ...allEntries
        .filter((e) => e.sourceId === id || ids.has(e.reverseOf ?? ''))
        .map((e) => ({
          ...e,
          sourceType: 'deposit',
          reversed: allEntries.some((x) => x.reverseOf === e.id),
        })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const lease = await getLease(
      c,
      await this.parent(access, bill.contractId, 'billingRead'),
    );
    const balance = allowedActions.includes('depositRead')
      ? money(depositBalance(allEntries))
      : null;
    return {
      ...bill,
      merchantName: await this.merchantName(access, bill.merchantId),
      displayStatus: billStatus(bill),
      overdue:
        bill.status === 'issued' &&
        BigInt(bill.remainingCents) > 0n &&
        bill.dueDate < businessDay(),
      lines: lines.data,
      linesMeta: lines.meta,
      ledger: ledger.slice((ledgerPage - 1) * 20, ledgerPage * 20),
      ledgerMeta: { page: ledgerPage, pageSize: 20, total: ledger.length },
      allowedActions,
      lease,
      depositBalance: balance,
      ...(await this.history(
        c,
        bill.contractId,
        id,
        auditPage,
        allowedActions.includes('depositRead'),
      )),
    };
  }
  async receiptDetail(access: Access, id: string, page = 1, auditPage = 1) {
    const row = await this.findReceipt(id);
    const parentContract = await this.parent(
      access,
      row.contractId,
      'receiptRead',
    );
    const allowedActions = await this.allowed(access, row.contractId),
      c = this.connection();
    const entries = await this.page(
      c,
      'hylReceiptEntries',
      { receiptId: id },
      page,
    );
    const all = await c
      .repository<ReceiptEntry>('hylReceiptEntries')
      .findMany({ filter: { receiptId: id } });
    const billNames = new Map(
      (allowedActions.includes('billingRead')
        ? await c
            .repository<Bill>('hylBills')
            .findMany({ filter: { contractId: row.contractId } })
        : []
      ).map((b) => [b.id, b.number]),
    );
    return {
      ...row,
      merchantName: await this.merchantName(access, row.merchantId),
      displayStatus: receiptStatus(row),
      contractNumber: parentContract.number,
      ...(await this.history(c, row.contractId, id, auditPage)),
      entries: entries.data.map((e) => ({
        ...e,
        reversed: all.some((x) => x.reverseOf === e.id),
        sourceNumber:
          typeof e.billId === 'string'
            ? (billNames.get(e.billId) ?? null)
            : null,
      })),
      entriesMeta: entries.meta,
      allowedActions,
      lease: await getLease(
        c,
        await this.parent(access, row.contractId, 'receiptRead'),
      ),
    };
  }
  async merchantName(access: Access, id: string) {
    try {
      return (await this.hyl.get(access, 'merchants', id)).name;
    } catch (e) {
      if (e instanceof ApiError) return null;
      throw e;
    }
  }
  async history(
    c: DatabaseConnection,
    contractId: string,
    recordId: string,
    page: number,
    depositVisible = false,
  ) {
    const records = await c
      .repository('hylEvents')
      .findMany({ filter: { recordId: contractId } });
    const data = records
      .map(
        (e) =>
          e.payload as {
            action: string;
            actor: string;
            at: string;
            detail: Record<string, unknown>;
          },
      )
      .filter(
        (e) =>
          e.action.startsWith('billing.') &&
          (e.detail.billId === recordId || e.detail.receiptId === recordId),
      )
      .map(({ action, actor, at, detail }) => ({
        action,
        actor,
        at,
        reason:
          action === 'billing.applyDeposit' && !depositVisible
            ? ''
            : typeof detail.reason === 'string'
              ? detail.reason
              : '',
        evidence:
          action === 'billing.applyDeposit' && !depositVisible
            ? ''
            : typeof detail.evidence === 'string'
              ? detail.evidence
              : '',
      }))
      .sort((a, b) => b.at.localeCompare(a.at));
    return {
      events: data.slice((page - 1) * 20, page * 20),
      eventsMeta: { page, pageSize: 20, total: data.length },
    };
  }
  async page(
    c: DatabaseConnection,
    table: string,
    filter: Record<string, string>,
    page = 1,
  ) {
    const repo = c.repository(table);
    return {
      data: await repo.findMany({
        filter,
        sort: (s) => [s.field('id').asc()],
        offset: (page - 1) * 20,
        limit: 20,
      }),
      meta: { page, pageSize: 20, total: await repo.count({ filter }) },
    };
  }
  async list(access: Access, kind: 'bills' | 'receipts', input: BillingList) {
    if (input.from && input.to && input.from > input.to)
      fail('INVALID_PERIOD', 'INVALID_ARGUMENT');
    const action = kind === 'bills' ? 'billingRead' : 'receiptRead';
    const policy = await this.resolvedPolicy(access, action);
    const contracts = (await this.hyl.db
      .repository<Row>('hylContracts')
      .withPolicy(policy)
      .findMany({
        ...(input.contractId ? { filter: { id: input.contractId } } : {}),
      })) as Row[];
    const merchantPolicy = await this.hyl
      .policy(access, 'merchants', 'read')
      .catch((e: unknown) => {
        if (e instanceof ApiError) return undefined;
        throw e;
      });
    const merchants = merchantPolicy
      ? await this.hyl.db
          .repository<Row>('hylMerchants')
          .withPolicy(merchantPolicy)
          .findMany({})
      : [];
    const names = new Map(merchants.map((m) => [m.id, m.name]));
    const scoped = contracts.filter(
      (c) => !input.merchantId || c.merchantId === input.merchantId,
    );
    const searchedIds = scoped
      .filter((c) =>
        `${c.number} ${typeof c.payload.title === 'string' ? c.payload.title : ''} ${names.get(c.merchantId) ?? ''}`
          .toLocaleLowerCase()
          .includes(input.q.toLocaleLowerCase()),
      )
      .map((c) => c.id);
    const ids = scoped.map((r) => r.id),
      table = kind === 'bills' ? 'hylBills' : 'hylReceipts';
    const snapshotIds =
      kind === 'bills' && input.q && ids.length
        ? (
            await this.hyl.db.repository<Bill>('hylBills').findMany({
              filter: buildFilter((f) =>
                f.or(ids.map((id) => f.string('contractId').eq(id))),
              ),
              select: (fields) => fields.fields('id', 'payload'),
            })
          )
            .filter((row) => {
              const snapshot = row.payload?.contract;
              return (
                typeof snapshot?.title === 'string' &&
                snapshot.title
                  .toLocaleLowerCase()
                  .includes(input.q.toLocaleLowerCase())
              );
            })
            .map((row) => String(row.id))
        : [];
    const filter = buildFilter((f) => {
      const parts = [
        ids.length
          ? f.or(ids.map((id) => f.string('contractId').eq(id)))
          : f.string('id').eq('__none__'),
      ];
      if (input.q)
        parts.push(
          f.or([
            f.string('number').includes(input.q),
            ...(kind === 'receipts'
              ? [f.string('reference').includes(input.q)]
              : []),
            ...searchedIds.map((id) => f.string('contractId').eq(id)),
            ...snapshotIds.map((id) => f.string('id').eq(id)),
          ]),
        );
      if (input.from)
        parts.push(
          f.date(kind === 'bills' ? 'end' : 'date').notBefore(input.from),
        );
      if (input.to)
        parts.push(
          f.date(kind === 'bills' ? 'start' : 'date').notAfter(input.to),
        );
      if (kind === 'bills') {
        const status = input.status;
        if (['draft', 'voided'].includes(status))
          parts.push(f.string('status').eq(status));
        else if (status) {
          parts.push(f.string('status').eq('issued'));
          if (status === 'open') parts.push(f.number('remainingCents').gt(0));
          else if (status === 'paid')
            parts.push(f.number('remainingCents').eq(0));
          else if (status === 'unpaid')
            parts.push(
              f.number('remainingCents').gt(0),
              f.number('allocatedCents').eq(0),
              f.number('depositCents').eq(0),
            );
          else if (status === 'partial')
            parts.push(
              f.number('remainingCents').gt(0),
              f.or([
                f.number('allocatedCents').gt(0),
                f.number('depositCents').gt(0),
              ]),
            );
          else fail('INVALID_FIELD', 'INVALID_ARGUMENT');
        }
        if (input.overdue)
          parts.push(
            input.overdue === 'true'
              ? f.and([
                  f.string('status').eq('issued'),
                  f.number('remainingCents').gt(0),
                  f.date('dueDate').before(businessDay()),
                ])
              : f.or([
                  f.string('status').ne('issued'),
                  f.number('remainingCents').eq(0),
                  f.date('dueDate').notBefore(businessDay()),
                ]),
          );
      } else if (input.status) {
        if (input.status === 'voided')
          parts.push(f.string('status').eq('voided'));
        else {
          parts.push(f.string('status').eq('received'));
          if (input.status === 'allocated')
            parts.push(
              f.number('unusedCents').eq(0),
              f.number('allocatedCents').gt(0),
            );
          else if (input.status === 'unallocated')
            parts.push(
              f.number('allocatedCents').eq(0),
              f.number('refundedCents').eq(0),
            );
          else if (input.status === 'refunded')
            parts.push(
              f.number('unusedCents').eq(0),
              f.number('allocatedCents').eq(0),
              f.number('refundedCents').gt(0),
            );
          else if (input.status === 'partial')
            parts.push(
              f.number('unusedCents').gt(0),
              f.or([
                f.number('allocatedCents').gt(0),
                f.number('refundedCents').gt(0),
              ]),
            );
          else fail('INVALID_FIELD', 'INVALID_ARGUMENT');
        }
      }
      return f.and(parts);
    });
    const repo = this.hyl.db.repository<Bill & Receipt>(table);
    let finalFilter = filter;
    if (input.feeType && kind === 'bills') {
      const lines = await this.hyl.db
        .repository<BillLine>('hylBillLines')
        .findMany({ filter: { feeType: input.feeType } });
      const billIds = [...new Set(lines.map((l) => l.billId))];
      finalFilter = buildFilter((f) =>
        f.and([
          filter.root,
          billIds.length
            ? f.or(billIds.map((id) => f.string('id').eq(id)))
            : f.string('id').eq('__none__'),
        ]),
      );
    }
    const [column = 'updatedAt', direction = 'desc'] = input.orderBy.split(':');
    if (
      ![
        'updatedAt',
        'date',
        'amountCents',
        'allocatedCents',
        ...(kind === 'bills'
          ? ['start', 'end', 'dueDate', 'depositCents', 'remainingCents']
          : ['refundedCents', 'unusedCents']),
      ].includes(column) ||
      !['asc', 'desc'].includes(direction)
    )
      fail('INVALID_SORT', 'INVALID_ARGUMENT');
    const rows = await repo.findMany({
      filter: finalFilter,
      sort: (s) =>
        direction === 'asc'
          ? [s.field(column).asc(), s.field('id').asc()]
          : [s.field(column).desc(), s.field('id').desc()],
      offset: (input.page - 1) * input.pageSize,
      limit: input.pageSize,
    });
    const totals = {
      amount: 0n,
      deposit: 0n,
      allocated: 0n,
      remaining: 0n,
      refunded: 0n,
      unused: 0n,
    };
    // Complete the scoped stream before performing any dependent reads (SQLite single connection).
    for await (const row of repo.findMany({ filter: finalFilter })) {
      if (row.status === 'voided' || row.status === 'draft') continue;
      totals.amount += BigInt(row.amountCents);
      totals.allocated += BigInt(row.allocatedCents);
      if (kind === 'bills') {
        totals.deposit += BigInt(row.depositCents);
        totals.remaining += BigInt(row.remainingCents);
      } else {
        totals.refunded += BigInt(row.refundedCents);
        totals.unused += BigInt(row.unusedCents);
      }
    }
    const contractMap = new Map(contracts.map((r) => [r.id, r]));
    return {
      data: rows.map((row) => ({
        ...row,
        displayStatus: kind === 'bills' ? billStatus(row) : receiptStatus(row),
        merchantName: names.get(row.merchantId) ?? null,
        contractNumber: contractMap.get(row.contractId)?.number ?? null,
        contractTitle: contractMap.get(row.contractId)?.payload.title ?? null,
        overdue:
          kind === 'bills' &&
          row.status === 'issued' &&
          BigInt(row.remainingCents) > 0n &&
          row.dueDate < businessDay(),
      })),
      meta: {
        total: await repo.count({ filter: finalFilter }),
        page: input.page,
        pageSize: input.pageSize,
      },
      totals: Object.fromEntries(
        Object.entries(totals).map(([k, n]) => [k, money(n)]),
      ),
    };
  }
  async summary(access: Access, id: string) {
    const contract = await this.parent(access, id, 'billingRead'),
      allowedActions = await this.allowed(access, id),
      c = this.connection();
    const bills = await this.list(access, 'bills', {
      q: '',
      status: '',
      page: 1,
      pageSize: 5,
      orderBy: 'updatedAt:desc',
      contractId: id,
    });
    const receipts = allowedActions.includes('receiptRead')
      ? await this.list(access, 'receipts', {
          q: '',
          status: '',
          page: 1,
          pageSize: 5,
          orderBy: 'updatedAt:desc',
          contractId: id,
        })
      : null;
    const lease = await getLease(c, contract);
    const blockers =
      lease.status === 'terminated'
        ? (await closingBlockers(c, contract, lease.actualEnd, true)).filter(
            (b) =>
              b.kind !== 'receipts' || allowedActions.includes('receiptRead'),
          )
        : [];
    return {
      blockers,
      config: await configAt(c, id, await effectiveEnd(c, contract)),
      bills,
      receipts,
      allowedActions,
      lease: await getLease(c, contract),
    };
  }
  async overview(access: Access) {
    const result: Record<string, unknown> = {};
    for (const kind of ['bills', 'receipts'] as const) {
      try {
        const list = await this.list(access, kind, {
          q: '',
          status: kind === 'bills' ? '' : '',
          page: 1,
          pageSize: 1,
          orderBy: 'updatedAt:desc',
        });
        result[kind] = {
          total: list.meta.total,
          ...(kind === 'bills'
            ? { amount: list.totals.remaining }
            : { amount: list.totals.unused }),
        };
      } catch (e) {
        if (e instanceof ApiError && e.status === 'PERMISSION_DENIED')
          result[kind] = null;
        else throw e;
      }
    }
    if (result.bills === null && result.receipts === null)
      fail('ACCESS_DENIED', 'PERMISSION_DENIED');
    return result;
  }
}
