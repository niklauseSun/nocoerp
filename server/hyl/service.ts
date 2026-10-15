import { assetPolicy } from '../providers/assets.js';
import { saveContractAssets } from '../assets/contracts.js';
import { businessFilter, type BusinessFilters } from './filters.js';
import { loadDashboard } from './dashboard.js';
import type { UserAdministrationService } from '@nocobase/app-plugin-authentication';
import { creationRuntime } from './policy-lifecycle.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type {
  DatabaseManager,
  DatabaseConnection,
  RepositoryPolicy,
} from '@nocobase/db';
import type { AuthorizationContext } from '@nocobase/app-plugin-authorization/server';
import { ApiError } from '@nocobase/app-server/router';
import { buildFilter } from '@nocobase/repository-input';
import { LifecycleRuntime } from '@nocobase/lifecycle';
import { calculateSettlement, cents, periodFor } from './calculation.js';
import {
  schemas,
  tables,
  type Kind,
  type Row,
  type ActionInput,
} from './schema.js';

export function fail(
  reason: string,
  status:
    | 'INVALID_ARGUMENT'
    | 'FAILED_PRECONDITION'
    | 'NOT_FOUND'
    | 'ABORTED'
    | 'PERMISSION_DENIED'
    | 'ALREADY_EXISTS' = 'FAILED_PRECONDITION',
): never {
  throw new ApiError({
    status,
    reason,
    domain: 'hyl',
    message: `Business operation refused: ${reason}.`,
  });
}
export interface Access {
  actor: string;
  authorization: AuthorizationContext;
}
export interface ListInput extends BusinessFilters {
  q: string;
  status: string;
  merchantId: string;
  page: number;
  pageSize: number;
  orderBy: string;
}
export class HylService {
  constructor(
    readonly db: DatabaseManager,
    readonly runtime: LifecycleRuntime,
    readonly users: UserAdministrationService,
  ) {}
  async policy(
    access: Access,
    kind: Kind,
    action: string,
  ): Promise<RepositoryPolicy> {
    const decision = await access.authorization.authorize({
      resource: { type: 'composite', id: `hyl.${kind}` },
      action,
    });
    const policy = decision.conditions?.database?.[tables[kind]];
    if (decision.effect === 'deny' || !policy)
      fail('ACCESS_DENIED', 'PERMISSION_DENIED');
    return policy;
  }
  async get(
    access: Access,
    kind: Kind,
    id: string,
    action = 'read',
    connection = this.db.connection(),
    resolvedPolicy?: RepositoryPolicy,
  ): Promise<Row> {
    const policy = resolvedPolicy ?? (await this.policy(access, kind, action));
    const row = await connection
      .repository<Row>(tables[kind])
      .withPolicy(policy)
      .findOne({ filter: { id } });
    if (!row) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    return row as Row;
  }
  async list(access: Access, kind: Kind, input: ListInput) {
    const repo = this.db
      .repository<Row>(tables[kind])
      .withPolicy(await this.policy(access, kind, 'read'));
    const filter = businessFilter(kind, input);
    const [column = 'updatedAt', direction = 'desc'] = input.orderBy.split(':');
    if (
      !['updatedAt', 'date', 'amountCents'].includes(column) ||
      !['asc', 'desc'].includes(direction)
    )
      fail('INVALID_SORT', 'INVALID_ARGUMENT');
    const total = await repo.count({ filter });
    const rows = await repo.findMany({
      filter,
      sort: (s) =>
        direction === 'asc'
          ? [s.field(column).asc(), s.field('id').asc()]
          : [s.field(column).desc(), s.field('id').desc()],
      offset: (input.page - 1) * input.pageSize,
      limit: input.pageSize,
    });
    return {
      data: rows,
      meta: { total, page: input.page, pageSize: input.pageSize },
    };
  }
  async dashboard(access: Access, month?: string) {
    return loadDashboard(
      this.db,
      async (kind) => {
        const decision = await access.authorization.authorize({
          resource: { type: 'composite', id: `hyl.${kind}` },
          action: 'read',
        });
        return decision.effect === 'deny'
          ? null
          : (decision.conditions?.database?.[tables[kind]] ?? null);
      },
      new Date(),
      month,
    );
  }
  async detail(access: Access, kind: Kind, id: string) {
    const record = await this.get(access, kind, id);
    const events = await this.db
      .repository('hylEvents')
      .findMany({ filter: { recordId: id } });
    const payments =
      kind === 'settlements'
        ? await this.db
            .repository('hylPayments')
            .findMany({ filter: { settlementId: id } })
        : [];
    const confirmationModes: string[] = [];
    if (kind === 'settlements') {
      const merchant = await this.get(access, 'merchants', record.merchantId);
      if (merchant.userId === access.actor) confirmationModes.push('online');
      const review = await access.authorization.authorize({
        resource: { type: 'composite', id: 'hyl.settlements' },
        action: 'review',
      });
      const reviewPolicy = review.conditions?.database?.[tables.settlements];
      if (
        review.effect !== 'deny' &&
        reviewPolicy &&
        (await this.db
          .repository<Row>(tables.settlements)
          .withPolicy(reviewPolicy)
          .findOne({ filter: { id } }))
      )
        confirmationModes.push('offline');
    }
    return {
      ...record,
      confirmationModes,
      events: events
        .map((e) => e.payload)
        .sort((a, b) =>
          scalar((a as Record<string, unknown>).at).localeCompare(
            scalar((b as Record<string, unknown>).at),
          ),
        ),
      payments: payments.map((p) => p.payload),
    };
  }
  private async event(
    c: DatabaseConnection,
    row: Row,
    access: Access,
    action: string,
    detail: unknown = null,
  ) {
    await c.repository('hylEvents').createOne({
      values: {
        id: randomUUID(),
        recordId: row.id,
        payload: {
          action,
          actor: access.actor,
          at: new Date().toISOString(),
          version: row.version,
          detail,
        },
      },
    });
  }
  /** Every merchant mutation performs this CAS first. It serializes source approval, contract changes and settlement claims without dialect-specific SQL. */
  async lockMerchant(c: DatabaseConnection, id: string): Promise<Row> {
    const repo = c.repository(tables.merchants);
    const row = (await repo.findOne({
      filter: { id },
    })) as unknown as Row | null;
    if (!row) fail('MERCHANT_NOT_FOUND', 'INVALID_ARGUMENT');
    const result = await repo.updateMany({
      filter: { id, version: row.version },
      values: { version: row.version + 1 },
    });
    if (result.updatedCount !== 1) fail('VERSION_CONFLICT', 'ABORTED');
    return row;
  }
  private base(
    kind: Kind,
    payload: Record<string, unknown>,
    _actor: string,
    merchant?: Row,
  ): Row {
    const id = randomUUID(),
      now = new Date().toISOString();
    return {
      id,
      number: scalar(
        payload.code ??
          payload.number ??
          payload.reference ??
          `${kind}-${id.slice(0, 8)}`,
      ),
      name: scalar(payload.name ?? merchant?.name ?? ''),
      merchantId: kind === 'merchants' ? id : scalar(payload.merchantId),
      userId: scalar(payload.userId ?? ''),
      date: scalar(payload.date ?? payload.start ?? now.slice(0, 10)),
      status:
        kind === 'merchants'
          ? payload.active
            ? 'active'
            : 'inactive'
          : kind === 'contracts'
            ? 'active'
            : 'draft',
      payload,
      version: 0,
      lifecycleVersion: 0,
      statusChangedAt: now,
      createdAt: now,
      updatedAt: now,
      amountCents: scalar(
        cents(scalar(payload.receipts ?? payload.amount ?? '0')),
      ),
      settlementId: null,
    };
  }
  async save(
    access: Access,
    kind: Exclude<Kind, 'settlements'>,
    data: unknown,
    id?: string,
    expectedVersion?: number,
  ): Promise<Row> {
    const payload = schemas[kind].parse(data) as Record<string, unknown>;
    const creationId = kind === 'merchants' ? scalar(payload.creationId) : '';
    const licenseFileId =
      kind === 'merchants' ? scalar(payload.licenseFileId) : '';
    if (id && (creationId || licenseFileId))
      fail('INVALID_FIELD', 'INVALID_ARGUMENT');
    delete payload.creationId;
    delete payload.licenseFileId;
    if (kind === 'merchants') {
      delete payload.code;
      if (payload.category !== 'other') payload.categoryName = '';
    }
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ payload, licenseFileId }))
      .digest('hex');
    const policy = await this.policy(access, kind, 'write');
    const assetAccess =
      kind === 'contracts' &&
      (id || (Array.isArray(payload.assetIds) && payload.assetIds.length))
        ? await assetPolicy(access, 'read').catch((cause) => {
            if (Array.isArray(payload.assetIds) && payload.assetIds.length)
              throw cause;
            return undefined;
          })
        : undefined;
    const merchantPolicy =
      kind === 'merchants'
        ? undefined
        : await this.policy(access, 'merchants', 'read');
    return this.db.transaction(async (c) => {
      if (creationId) {
        const previous = await c
          .repository('hylMerchantCreations')
          .findOne({ filter: { id: creationId } });
        if (previous) {
          if (
            previous.ownerId !== access.actor ||
            previous.requestHash !== requestHash
          )
            fail('PROFILE_RETRY_CONFLICT', 'ALREADY_EXISTS');
          return this.get(access, 'merchants', creationId, 'write', c, policy);
        }
        if (
          await c
            .repository('hylMerchants')
            .exists({ filter: { id: creationId } })
        )
          fail('PROFILE_RETRY_CONFLICT', 'ALREADY_EXISTS');
      }
      let old: Row | undefined;
      if (id) {
        // Reuse the policy resolved before opening SQLite's single-connection transaction.
        old = await this.get(access, kind, id, 'write', c, policy);
        if (old.version !== expectedVersion)
          fail('VERSION_CONFLICT', 'ABORTED');
        if (
          kind !== 'merchants' &&
          scalar(payload.merchantId) !== old.merchantId
        )
          fail('MERCHANT_IMMUTABLE');
      }
      let merchant: Row | undefined;
      if (kind !== 'merchants') {
        merchant = await this.get(
          access,
          'merchants',
          scalar(payload.merchantId),
          'read',
          c,
          merchantPolicy,
        );
        await this.lockMerchant(c, merchant.id);
        if (merchant.status !== 'active') fail('MERCHANT_INACTIVE');
      }
      if (kind === 'merchants' && payload.userId) {
        const user = await this.users
          .withConnection(c)
          .get(scalar(payload.userId));
        if (!user) fail('USER_NOT_FOUND', 'INVALID_ARGUMENT');
      }
      if (kind === 'contracts') {
        const contracts = await c
          .repository<Row>(tables.contracts)
          .findMany({ filter: { merchantId: scalar(payload.merchantId) } });
        if (
          contracts.some(
            (r) =>
              r.id !== id &&
              scalar(r.payload && r.payload.start) <= scalar(payload.end) &&
              scalar(r.payload.end) >= scalar(payload.start),
          )
        )
          fail('CONTRACT_OVERLAP');
        if (id) {
          const settlements = await c
            .repository(tables.settlements)
            .findMany({ filter: { merchantId: scalar(payload.merchantId) } });
          if (
            settlements.some(
              (s) => (s.payload as Record<string, unknown>).contractId === id,
            )
          )
            fail('CONTRACT_IN_USE');
        }
      }
      if (kind === 'revenueReports' || kind === 'expenses') {
        if (
          old &&
          (!['draft', 'returned'].includes(old.status) || old.settlementId)
        )
          fail('RECORD_LOCKED');
        const settlements = await c
          .repository<Row>(tables.settlements)
          .findMany({ filter: { merchantId: scalar(payload.merchantId) } });
        if (
          settlements.some(
            (record) =>
              record.status !== 'cancelled' &&
              scalar(record.payload.start) <= scalar(payload.date) &&
              scalar(record.payload.end) >= scalar(payload.date),
          )
        )
          fail('PERIOD_ALREADY_SETTLED', 'ALREADY_EXISTS');
        const contracts = await c
          .repository<Row>(tables.contracts)
          .findMany({ filter: { merchantId: scalar(payload.merchantId) } });
        if (
          !contracts.some((r) => {
            const p = r.payload;
            return (
              scalar(p.start) <= scalar(payload.date) &&
              scalar(p.end) >= scalar(payload.date)
            );
          })
        )
          fail('CONTRACT_NOT_COVERED');
      }
      if (kind === 'merchants') {
        if (payload.category !== 'other') payload.categoryName = '';
        // Use the persisted identity on edit, including legacy merchant numbers.
        // Cryptographic identifiers avoid MAX+1 races; the unique index is the final guard.
        payload.code =
          old?.number ?? `SH${randomBytes(12).toString('hex').toUpperCase()}`;
      }
      if (kind === 'contracts') {
        if (payload.assetIds === undefined)
          payload.assetIds = old?.payload.assetIds ?? [];
      }
      if (kind === 'contracts')
        payload.number =
          old?.number ?? `HT${randomBytes(12).toString('hex').toUpperCase()}`;
      const values = this.base(kind, payload, access.actor, merchant);
      if (creationId) {
        values.id = creationId;
        values.merchantId = creationId;
      }
      // Actor is maintained in the separate audit table; never accept actor or state from API input.

      const repo = c
        .repository<Row>(tables[kind])
        .withPolicy(policy)
        .narrow({
          create:
            policy.read === false
              ? false
              : policy.read === true
                ? true
                : { scope: policy.read.scope },
        });
      let result: Row;
      if (old) {
        const {
          id: ignoredId,
          createdAt: ignoredCreated,
          status: ignoredStatus,
          lifecycleVersion: ignoredLife,
          statusChangedAt: ignoredChanged,
          ...changes
        } = values;
        void ignoredId;
        void ignoredCreated;
        void ignoredStatus;
        void ignoredLife;
        void ignoredChanged;
        if (kind === 'merchants')
          Object.assign(changes, {
            status: payload.active ? 'active' : 'inactive',
          });
        const saved = await repo.updateOne({
          filter: { id, version: old.version },
          values: { ...changes, version: old.version + 1 },
        });
        result = saved.record as Row;
        if (kind === 'revenueReports' || kind === 'expenses')
          await this.runtime.fire(tables[kind], old.id, 'edit', {
            actor: { id: access.actor },
            transaction: c,
            expect: { version: old.lifecycleVersion },
          });
      } else if (kind === 'revenueReports' || kind === 'expenses') {
        // Creation is permitted only after checking both the business action and the actual scoped parent merchant.
        const created = await creationRuntime(
          this.db,
          tables[kind],
          policy,
        ).create(tables[kind], lifecycleValues(values), {
          actor: { id: access.actor },
          transaction: c,
        });
        result = created.record as unknown as Row;
      } else result = (await repo.createOne({ values })).record as Row;
      if (
        kind === 'contracts' &&
        Array.isArray(payload.assetIds) &&
        (payload.assetIds.length ||
          (old &&
            Array.isArray(old.payload.assetIds) &&
            old.payload.assetIds.length))
      ) {
        if (!assetAccess) fail('ACCESS_DENIED', 'PERMISSION_DENIED');
        await saveContractAssets(
          c,
          result,
          payload.assetIds as string[],
          assetAccess,
          access.actor,
        );
      }
      if (licenseFileId) {
        const claim = await c.repository('hylMerchantFiles').updateMany({
          filter: {
            id: licenseFileId,
            merchantId: creationId,
            ownerId: access.actor,
            linked: false,
          },
          values: { linked: true },
        });
        if (claim.updatedCount !== 1)
          fail('PROFILE_FILE_CONFLICT', 'ALREADY_EXISTS');
        const createdAt = new Date().toISOString();
        const recordId = randomUUID();
        await c.repository('hylMerchantRecords').createOne({
          values: {
            id: recordId,
            merchantId: result.id,
            type: 'license',
            requestId: creationId,
            actor: access.actor,
            date: createdAt.slice(0, 10),
            createdAt,
            payload: {
              requestId: creationId,
              name: '营业执照',
              category: '营业执照',
              number: scalar(payload.creditCode),
              start: '',
              end: '',
              permanent: false,
              notes: '',
              fileId: licenseFileId,
            },
          },
        });
        await this.event(c, result, access, 'profilelicense', { recordId });
      }
      if (creationId)
        await c.repository('hylMerchantCreations').createOne({
          values: {
            id: creationId,
            ownerId: access.actor,
            requestHash,
            createdAt: new Date().toISOString(),
          },
        });
      await this.event(c, result, access, old ? 'edit' : 'create');
      return result;
    });
  }
  async generate(access: Access, input: unknown): Promise<Row> {
    const data = schemas.settlements.parse(input);
    const policy = await this.policy(access, 'settlements', 'write');
    const merchantPolicy = await this.policy(access, 'merchants', 'read');
    const contractPolicy = await this.policy(access, 'contracts', 'read');
    const revenuePolicy = await this.policy(access, 'revenueReports', 'read');
    const expensePolicy = await this.policy(access, 'expenses', 'read');
    return this.db.transaction(async (c) => {
      const merchant = await this.get(
        access,
        'merchants',
        data.merchantId,
        'read',
        c,
        merchantPolicy,
      );
      await this.lockMerchant(c, merchant.id);
      if (merchant.status !== 'active') fail('MERCHANT_INACTIVE');
      const contractRow = await this.get(
        access,
        'contracts',
        data.contractId,
        'read',
        c,
        contractPolicy,
      );
      const contract = schemas.contracts.parse(contractRow.payload);
      const [start, end] = periodFor(data.month, data.part);
      if (
        contractRow.merchantId !== merchant.id ||
        contract.start > start ||
        contract.end < end ||
        (contract.cycle === 'month') !== (data.part === 'month')
      )
        fail('INVALID_PERIOD');
      const scope = buildFilter((f) =>
        f.and([
          f.string('merchantId').eq(merchant.id),
          f.or(
            Array.from(
              { length: Number(end.slice(-2)) - Number(start.slice(-2)) + 1 },
              (_, i) =>
                f
                  .string('date')
                  .eq(
                    `${data.month}-${String(Number(start.slice(-2)) + i).padStart(2, '0')}`,
                  ),
            ),
          ),
        ]),
      );
      // Monetary sources are read through this operation's separately authorized source views.
      const revenueRepo = c
        .repository(tables.revenueReports)
        .withPolicy(revenuePolicy);
      const expenseRepo = c
        .repository(tables.expenses)
        .withPolicy(expensePolicy);
      const revenues = (await revenueRepo.findMany({
        filter: scope,
      })) as unknown as Row[];
      const expenses = (await expenseRepo.findMany({
        filter: scope,
      })) as unknown as Row[];
      // A settlement must cover every source in the period, including records outside a caller's partial view.
      // Only counts are read without the view policy; inaccessible source data is never returned.
      const revenueCount = await c
        .repository(tables.revenueReports)
        .count({ filter: scope });
      const expenseCount = await c
        .repository(tables.expenses)
        .count({ filter: scope });
      if (revenueCount !== revenues.length || expenseCount !== expenses.length)
        fail('ACCESS_DENIED', 'PERMISSION_DENIED');
      if ([...revenues, ...expenses].some((r) => r.status !== 'approved'))
        fail('PENDING_REVIEW');
      if ([...revenues, ...expenses].some((r) => r.settlementId))
        fail('PERIOD_ALREADY_SETTLED', 'ALREADY_EXISTS');
      const active = await c
        .repository(tables.settlements)
        .findMany({ filter: { merchantId: merchant.id } });
      if (
        active.some(
          (r) =>
            r.status !== 'cancelled' &&
            scalar((r.payload as Record<string, unknown>).start) <= end &&
            scalar((r.payload as Record<string, unknown>).end) >= start,
        )
      )
        fail('PERIOD_ALREADY_SETTLED', 'ALREADY_EXISTS');
      const amounts = calculateSettlement(
        contract,
        revenues.map((r) => schemas.revenueReports.parse(r.payload)),
        expenses.map((r) => schemas.expenses.parse(r.payload)),
        start,
        end,
      );
      const id = randomUUID();
      const payload = {
        ...data,
        start,
        end,
        contract: contractRow.payload,
        revenues,
        expenses,
        amounts,
      };
      const row = this.base('settlements', payload, access.actor, merchant);

      row.id = id;
      row.number = `JS-${data.month.replace('-', '')}-${id.slice(0, 8)}`;
      row.date = start;
      row.amountCents = scalar(
        BigInt((amounts.payable ?? '0').replace('.', '')),
      );
      const created = await creationRuntime(
        this.db,
        tables.settlements,
        policy,
      ).create(tables.settlements, lifecycleValues(row), {
        actor: { id: access.actor },
        transaction: c,
      });
      for (const [kind, rows] of [
        ['revenueReports', revenues],
        ['expenses', expenses],
      ] as const) {
        for (const source of rows)
          await c.repository<Row>(tables[kind]).updateOne({
            filter: {
              id: source.id,
              version: source.version,
              settlementId: null,
            },
            values: { settlementId: row.id, version: source.version + 1 },
          });
      }
      await this.event(c, created.record as unknown as Row, access, 'generate');
      return created.record as unknown as Row;
    });
  }
  async act(
    access: Access,
    kind: Kind,
    id: string,
    action: string,
    body: ActionInput,
  ): Promise<Row> {
    const permission =
      action === 'submit'
        ? 'submit'
        : action === 'confirm' || action === 'dispute'
          ? 'confirm'
          : action === 'pay'
            ? 'pay'
            : 'review';
    // Authorization (including ownMerchant scope queries) uses the root connection.
    // Resolve it before acquiring SQLite's sole transaction connection.
    const policy = await this.policy(access, kind, permission);
    const merchantPolicy = await this.policy(access, 'merchants', 'read');
    if (action === 'confirm' && body.confirmation !== 'online')
      await this.policy(access, 'settlements', 'review');
    return this.db.transaction(async (c) => {
      const record = await this.get(access, kind, id, permission, c, policy);
      const merchant = await this.get(
        access,
        'merchants',
        record.merchantId,
        'read',
        c,
        merchantPolicy,
      );
      await this.lockMerchant(c, merchant.id);
      if (record.version !== body.expectedVersion)
        fail('VERSION_CONFLICT', 'ABORTED');
      if (
        (action === 'return' || action === 'cancel' || action === 'dispute') &&
        !body.reason.trim()
      )
        fail('REASON_REQUIRED', 'INVALID_ARGUMENT');
      if (kind !== 'settlements') {
        if (record.settlementId) fail('RECORD_LOCKED');
        if (!['submit', 'approve', 'return'].includes(action))
          fail('INVALID_ACTION', 'INVALID_ARGUMENT');
      } else if (
        !['review', 'confirm', 'dispute', 'cancel', 'pay'].includes(action)
      )
        fail('INVALID_ACTION', 'INVALID_ARGUMENT');
      const lifecycleInput: Record<string, string | boolean> = {
        reason: body.reason,
      };
      let payment: Record<string, unknown> | undefined;
      if (action === 'confirm') {
        if (body.confirmation === 'online') {
          if (merchant.userId !== access.actor)
            fail('MERCHANT_CONFIRMATION_REQUIRED', 'PERMISSION_DENIED');
        } else {
          if (!body.confirmedBy || !body.evidence)
            fail('CONFIRMATION_EVIDENCE_REQUIRED', 'INVALID_ARGUMENT');
        }
        lifecycleInput.balance = scalar(
          (record.payload.amounts as Record<string, string>).payable,
        );
      }
      if (action === 'dispute' && merchant.userId !== access.actor)
        fail('MERCHANT_CONFIRMATION_REQUIRED', 'PERMISSION_DENIED');
      if (action === 'pay') {
        if (!body.reference || !body.date || cents(body.amount) <= 0n)
          fail('PAYMENT_REQUIRED', 'INVALID_ARGUMENT');
        if (
          await c
            .repository('hylPayments')
            .exists({ filter: { reference: body.reference } })
        )
          fail('DUPLICATE_REFERENCE', 'ALREADY_EXISTS');
        const payments = await c
          .repository('hylPayments')
          .findMany({ filter: { settlementId: id } });
        const paid = payments.reduce(
          (sum, p) =>
            sum + cents(scalar((p.payload as Record<string, unknown>).amount)),
          0n,
        );
        const payable = BigInt(
          scalar(
            (record.payload.amounts as Record<string, string>).payable,
          ).replace('.', ''),
        );
        if (paid + cents(body.amount) > payable) fail('OVERPAYMENT');
        lifecycleInput.complete = paid + cents(body.amount) === payable;
        payment = {
          ...body,
          actor: access.actor,
          at: new Date().toISOString(),
        };
      }
      const result = await this.runtime.fire(tables[kind], id, action, {
        actor: { id: access.actor },
        transaction: c,
        expect: { version: record.lifecycleVersion },
        input: lifecycleInput,
      });
      const updated = await c.repository<Row>(tables[kind]).updateOne({
        filter: { id, version: record.version },
        values: {
          version: record.version + 1,
          updatedAt: new Date().toISOString(),
        },
      });
      if (payment)
        await c.repository('hylPayments').createOne({
          values: {
            id: randomUUID(),
            settlementId: id,
            reference: body.reference,
            payload: payment,
          },
        });
      if (action === 'cancel') {
        for (const table of [tables.revenueReports, tables.expenses]) {
          const sources = await c
            .repository(table)
            .findMany({ filter: { settlementId: id } });
          for (const source of sources)
            await c.repository(table).updateOne({
              filter: {
                id: scalar(source.id),
                version: Number(source.version),
              },
              values: {
                settlementId: null,
                version: Number(source.version) + 1,
              },
            });
        }
      }
      void result;
      await this.event(c, updated.record, access, action, body);
      return updated.record;
    });
  }
}

function scalar(value: unknown): string {
  return typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
    ? String(value)
    : '';
}

function lifecycleValues(row: Row): Record<string, unknown> {
  const { status, lifecycleVersion, statusChangedAt, ...values } = row;
  void status;
  void lifecycleVersion;
  void statusChangedAt;
  return values;
}
