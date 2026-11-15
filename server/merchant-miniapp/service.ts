import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseConnection, RepositoryPolicy } from '@nocobase/db';
import { buildFilter } from '@nocobase/repository-input';
import { fail, type Access, type HylService } from '../hyl/service.js';
import { actionSchema, type Row } from '../hyl/schema.js';
import {
  createValues,
  type RepairOrder,
  type RepairEvent,
} from '../repairs/model.js';
import { RepairService, repairToday } from '../repairs/service.js';
import { BillingService } from '../billing/service.js';
import { listSchema as billingList } from '../billing/model.js';
import { assetFields, type Asset, type Binding } from '../assets/schema.js';
import type { MiniappConfig } from '../config/merchant-miniapp.js';
import { WechatIdentity, unavailable, type loginInput } from './wechat.js';
import type { z } from 'zod';

type Identity = { id: string; userId: string; appId: string; phone: string };
type Grant = {
  id: string;
  merchantId: string;
  phone: string;
  active: boolean;
  actor: string;
  updatedAt: string;
};
type Daily = { id: string; merchantId: string; date: string };
const digest = (...parts: string[]) =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const businessFields = [
  'id',
  'number',
  'name',
  'merchantId',
  'userId',
  'date',
  'status',
  'payload',
  'version',
  'lifecycleVersion',
  'statusChangedAt',
  'createdAt',
  'updatedAt',
  'amountCents',
  'settlementId',
];
const scoped = (
  scope: Record<string, string>,
  write = false,
  fields: readonly string[] = businessFields,
): RepositoryPolicy => ({
  read: { scope, fields, relations: false },
  create: write ? { scope, fields, relations: false } : false,
  update: write ? { scope, fields, relations: false } : false,
  delete: false,
});
const stringValue = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value : fallback;
const reportFields = (row: Partial<Row>) => ({
  id: String(row.id),
  date: String(row.date),
  number: String(row.number),
  status: String(row.status),
  version: Number(row.version),
  amount: stringValue(row.payload?.receipts, '0'),
  orders:
    row.payload?.orderCount === undefined
      ? null
      : Number(row.payload.orderCount),
  note: stringValue(row.payload?.notes),
});
const repairFields = (row: RepairOrder) => ({
  id: row.id,
  title: row.title,
  number: row.number,
  status: row.status,
  updatedAt: row.updatedAt,
  description: stringValue(row.payload.description),
});

export class MerchantMiniapp {
  private readonly wechat: WechatIdentity;
  constructor(
    readonly hyl: HylService,
    readonly config: MiniappConfig,
  ) {
    this.wechat = new WechatIdentity(config);
  }
  c() {
    return this.hyl.db.connection();
  }
  private grants(c = this.c()) {
    return c.repository<Grant>('hylMiniappGrants');
  }
  private identities(c = this.c()) {
    return c.repository<Identity>('hylMiniappIdentities');
  }
  async login(input: z.infer<typeof loginInput>) {
    const verified = await this.wechat.verify(input),
      id = digest(verified.appId, verified.openId);
    const proofs = [
      digest(verified.appId, 'login', input.loginCode),
      digest(verified.appId, 'phone', input.phoneCode),
    ];
    return this.hyl.db.transaction(async (c) => {
      const proof = c.repository('hylMiniappLoginProofs');
      const at = new Date().toISOString();
      await proof.deleteMany({
        filter: buildFilter((f) => f.date('expiresAt').before(at)),
      });
      for (const key of proofs) {
        if (await proof.exists({ filter: { id: key } }))
          fail('MINIAPP_LOGIN_REPLAY', 'PERMISSION_DENIED');
        await proof.createOne({
          values: {
            id: key,
            expiresAt: new Date(Date.now() + 600000).toISOString(),
          },
        });
      }
      if (!(await this.merchantsForPhone(verified.phone, c)).length)
        fail('MINIAPP_NO_GRANT', 'PERMISSION_DENIED');
      const existing = await this.identities(c).findOne({ filter: { id } });
      if (existing && existing.phone !== verified.phone)
        fail('MINIAPP_PHONE_CHANGED', 'PERMISSION_DENIED');
      if (existing) {
        const user = await this.hyl.users
          .withConnection(c)
          .get(existing.userId);
        if (!user || user.disabledAt || user.kind !== 'person')
          fail('MINIAPP_NO_GRANT', 'PERMISSION_DENIED');
        return existing.userId;
      }
      const user = await this.hyl.users.withConnection(c).create({
        name: '微信商家 ' + id.slice(0, 8),
        email: 'miniapp-' + id + '@merchant-miniapp.invalid',
        password: randomBytes(36).toString('base64url'),
      });
      await this.identities(c).createOne({
        values: {
          id,
          appId: verified.appId,
          phone: verified.phone,
          userId: user.id,
        },
      });
      return user.id;
    });
  }
  async bindSession(userId: string, sessionId: string, expiresAt: Date) {
    await this.hyl.db.transaction(async (c) => {
      const sessions = c.repository('hylMiniappSessions');
      await sessions.deleteMany({
        filter: buildFilter((f) =>
          f.date('expiresAt').before(new Date().toISOString()),
        ),
      });
      await sessions.createOne({
        values: {
          id: sessionId,
          userId,
          appId: this.config.appId,
          expiresAt: expiresAt.toISOString(),
        },
      });
    });
  }
  async requireSession(userId: string, sessionId: string) {
    if (!this.config.enabled) unavailable();
    if (
      !(await this.c()
        .repository('hylMiniappSessions')
        .exists({
          filter: buildFilter((f) =>
            f.and([
              f.string('id').eq(sessionId),
              f.string('userId').eq(userId),
              f.string('appId').eq(this.config.appId),
              f.date('expiresAt').after(new Date().toISOString()),
            ]),
          ),
        }))
    )
      fail('MINIAPP_NO_GRANT', 'PERMISSION_DENIED');
  }
  async adminList(merchantId: string) {
    if (
      !(await this.c()
        .repository<Row>('hylMerchants')
        .exists({ filter: { id: merchantId } }))
    )
      fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    return this.grants().findMany({
      filter: { merchantId },
      sort: (s) => [s.field('phone').asc()],
      limit: 100,
    });
  }
  async setGrant(
    actor: string,
    merchantId: string,
    phone: string,
    active: boolean,
  ) {
    return this.hyl.db.transaction(async (c) => {
      const merchant = await this.hyl.lockMerchant(c, merchantId);
      if (active && merchant.status !== 'active') fail('MERCHANT_INACTIVE');
      const grants = this.grants(c),
        old = await grants.findOne({ filter: { merchantId, phone } });
      const values = {
        merchantId,
        phone,
        active,
        actor,
        updatedAt: new Date().toISOString(),
      };
      if (old)
        return (await grants.updateOne({ filter: { id: old.id }, values }))
          .record;
      if (!active) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
      if ((await grants.count({ filter: { merchantId } })) >= 100)
        fail('MINIAPP_GRANT_LIMIT');
      return (
        await grants.createOne({ values: { ...values, id: randomUUID() } })
      ).record;
    });
  }
  private async merchantsForPhone(phone: string, c = this.c()) {
    const grants = await this.grants(c).findMany({
      filter: { phone, active: true },
    });
    if (!grants.length) return [];
    const rows = await c.repository<Row>('hylMerchants').findMany({
      filter: buildFilter((f) =>
        f.and([
          f.string('status').eq('active'),
          f.or(grants.map((g) => f.string('id').eq(g.merchantId))),
        ]),
      ),
      sort: (s) => [s.field('name').asc(), s.field('id').asc()],
    });
    return rows.map((x) => ({ id: x.id, name: x.name }));
  }
  private async identity(actor: string, c = this.c()) {
    if (!this.config.enabled) unavailable();
    const identity = await this.identities(c).findOne({
      filter: { userId: actor, appId: this.config.appId },
    });
    if (!identity) fail('MINIAPP_NO_GRANT', 'PERMISSION_DENIED');
    return identity;
  }
  async merchants(actor: string) {
    const identity = await this.identity(actor);
    const merchants = await this.merchantsForPhone(identity.phone);
    if (!merchants.length) fail('MINIAPP_NO_GRANT', 'PERMISSION_DENIED');
    return merchants;
  }
  async ensure(actor: string, merchantId: string, c = this.c()) {
    const identity = await this.identity(actor, c);
    if (
      !(await this.grants(c).exists({
        filter: { phone: identity.phone, merchantId, active: true },
      })) ||
      !(await c
        .repository<Row>('hylMerchants')
        .exists({ filter: { id: merchantId, status: 'active' } }))
    )
      fail('MINIAPP_NO_GRANT', 'PERMISSION_DENIED');
    return identity;
  }
  // Internal capability, never installed in application authorization or granted to a login account.
  // Services see exact record scopes and no permissions other than those named here.
  private access(base: Access, merchantId: string, assetId = ''): Access {
    const resources = new Map<
      string,
      { table: string; policy: RepositoryPolicy }
    >();
    const add = (
      resource: string,
      actions: string[],
      table: string,
      policy: RepositoryPolicy,
    ) => {
      for (const action of actions)
        resources.set(resource + ':' + action, { table, policy });
    };
    add(
      'hyl.merchants',
      ['read'],
      'hylMerchants',
      scoped({ id: merchantId, status: 'active' }),
    );
    add(
      'hyl.revenueReports',
      ['read', 'write', 'submit'],
      'hylRevenueReports',
      scoped({ merchantId }, true),
    );
    add(
      'hyl.contracts',
      ['billingRead'],
      'hylContracts',
      scoped({ merchantId }),
    );
    if (assetId) {
      add(
        'hyl.assets',
        ['read'],
        'hylAssets',
        scoped({ id: assetId }, false, assetFields),
      );
      add(
        'hyl.repairs',
        ['read', 'report'],
        'hylAssets',
        scoped({ id: assetId }, false, assetFields),
      );
    }
    return {
      actor: base.actor,
      authorization: {
        identity: base.authorization.identity,
        authorize: (async (request: {
          resource: { type: string; id: string };
          action: string;
        }) => {
          const entry =
            request.resource.type === 'composite' &&
            resources.get(request.resource.id + ':' + request.action);
          return entry
            ? {
                effect: 'conditional',
                conditions: { database: { [entry.table]: entry.policy } },
              }
            : { effect: 'deny' };
        }) as Access['authorization']['authorize'],
        can: async () => false,
        require: async () => fail('ACCESS_DENIED', 'PERMISSION_DENIED'),
        snapshot: async () => ({ unrestricted: false, permissions: [] }),
      },
    };
  }
  async reports(base: Access, merchantId: string, page: number) {
    await this.ensure(base.actor, merchantId);
    const list = await this.hyl.list(
      this.access(base, merchantId),
      'revenueReports',
      {
        merchantId,
        orderBy: 'date:desc',
        page,
        pageSize: 20,
        q: '',
        status: '',
      },
    );
    const daily = this.c().repository<Daily>('hylMiniappDaily');
    return {
      meta: list.meta,
      data: await Promise.all(
        list.data.map(async (row) => {
          const dto = reportFields(row);
          const editable =
            ['draft', 'returned'].includes(dto.status) &&
            (await daily.exists({ filter: { id: dto.id, merchantId } }));
          let returnReason = '';
          if (dto.status === 'returned') {
            const events = await this.c()
              .repository<{
                recordId: string;
                payload: Record<string, unknown>;
              }>('hylEvents')
              .findMany({ filter: { recordId: dto.id } });
            const latest = events
              .filter((e) => e.payload.action === 'return')
              .sort(
                (a, b) => Number(b.payload.version) - Number(a.payload.version),
              )[0];
            const reason = (
              latest?.payload.detail as { reason?: unknown } | undefined
            )?.reason;
            returnReason = typeof reason === 'string' ? reason : '';
          }
          return { ...dto, editable, returnReason };
        }),
      ),
    };
  }

  async saveReport(
    base: Access,
    merchantId: string,
    input: {
      date: string;
      amount: string;
      orders: number;
      note: string;
      id?: string;
      version?: number;
    },
  ) {
    await this.ensure(base.actor, merchantId);
    if (input.date > repairToday()) fail('INVALID_PERIOD', 'INVALID_ARGUMENT');
    const access = this.access(base, merchantId);
    const merchantPolicy = await this.hyl.policy(access, 'merchants', 'read');
    const writePolicy = await this.hyl.policy(
      access,
      'revenueReports',
      'write',
    );
    return this.hyl.db.transaction(async (c) => {
      await this.hyl.lockMerchant(c, merchantId);
      await this.ensure(base.actor, merchantId, c);
      const daily = c.repository<Daily>('hylMiniappDaily');
      const previous = await daily.findOne({
        filter: { merchantId, date: input.date },
      });
      if (input.id) {
        if (!previous || previous.id !== input.id)
          fail('RECORD_NOT_FOUND', 'NOT_FOUND');
      } else if (previous) {
        const row = await this.hyl.get(
          access,
          'revenueReports',
          previous.id,
          'write',
          c,
          writePolicy,
        );
        if (
          row.status === 'draft' &&
          row.payload.receipts === input.amount &&
          row.payload.orderCount === input.orders &&
          row.payload.notes === input.note
        )
          return reportFields(row);
        fail('MINIAPP_DAILY_EXISTS', 'ALREADY_EXISTS');
      }
      if (
        !previous &&
        (await c
          .repository<Row>('hylRevenueReports')
          .exists({ filter: { merchantId, date: input.date } }))
      )
        fail('MINIAPP_DAILY_EXISTS', 'ALREADY_EXISTS');
      const row = await this.hyl.save(
        access,
        'revenueReports',
        {
          merchantId,
          date: input.date,
          source: 'other',
          reference: 'MINIAPP-' + merchantId + '-' + input.date,
          receipts: input.amount,
          orderCount: input.orders,
          refunds: '0',
          activity: '0',
          cash: '0',
          hospitality: '0',
          collected: '0',
          evidence: '微信小程序报送凭证',
          notes: input.note,
        },
        input.id,
        input.version,
        { connection: c, policy: writePolicy, merchantPolicy },
      );
      if (!previous)
        await daily.createOne({
          values: { id: row.id, merchantId, date: input.date },
        });
      return reportFields(row);
    });
  }
  async submit(base: Access, merchantId: string, id: string, version: number) {
    await this.ensure(base.actor, merchantId);
    const access = this.access(base, merchantId);
    const policy = await this.hyl.policy(access, 'revenueReports', 'submit');
    const merchantPolicy = await this.hyl.policy(access, 'merchants', 'read');
    return this.hyl.db.transaction(async (c) => {
      await this.hyl.lockMerchant(c, merchantId);
      await this.ensure(base.actor, merchantId, c);
      const row = await this.hyl.get(
        access,
        'revenueReports',
        id,
        'submit',
        c,
        policy,
      );
      if (
        !(await c
          .repository<Daily>('hylMiniappDaily')
          .exists({ filter: { id, merchantId } }))
      )
        fail('RECORD_NOT_FOUND', 'NOT_FOUND');
      if (row.status === 'pending' && row.version === version + 1)
        return reportFields(row);
      if (
        !(await c
          .repository('hylReportingFiles')
          .exists({ filter: { kind: 'revenueReports', recordId: id } }))
      )
        fail('MINIAPP_EVIDENCE_REQUIRED', 'INVALID_ARGUMENT');
      return reportFields(
        await this.hyl.act(
          access,
          'revenueReports',
          id,
          'submit',
          actionSchema.parse({ expectedVersion: version }),
          { connection: c, policy, merchantPolicy },
        ),
      );
    });
  }
  private async reportingTarget(
    actor: string,
    id: string,
    write: boolean,
    c: DatabaseConnection,
  ) {
    const report = await c
      .repository<Row>('hylRevenueReports')
      .findOne({ filter: { id } });
    if (!report) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    await this.ensure(actor, report.merchantId, c);
    if (
      write &&
      (!['draft', 'returned'].includes(report.status) ||
        !(await c
          .repository<Daily>('hylMiniappDaily')
          .exists({ filter: { id, merchantId: report.merchantId } })))
    )
      fail('RECORD_LOCKED');
    return report;
  }
  async reportingAccess(base: Access, id: string, write: boolean) {
    const report = await this.reportingTarget(base.actor, id, write, this.c());
    return this.access(base, report.merchantId);
  }
  async attachEvidence(
    actor: string,
    reportId: string,
    stagingId: string,
    fileId: string,
  ) {
    return this.hyl.db.transaction(async (c) => {
      const report = await this.reportingTarget(actor, reportId, true, c);
      await this.hyl.lockMerchant(c, report.merchantId);
      await this.reportingTarget(actor, reportId, true, c);
      const files = c.repository('hylReportingFiles');
      if (
        (await files.count({
          filter: { recordId: reportId, kind: 'revenueReports' },
        })) >= 9
      )
        fail('MINIAPP_EVIDENCE_LIMIT');
      const attached = await files.updateMany({
        filter: {
          id: fileId,
          recordId: stagingId,
          ownerId: actor,
          kind: 'revenueReports',
        },
        values: { recordId: reportId },
      });
      if (attached.updatedCount !== 1) fail('ATTACHMENT_CHANGED', 'ABORTED');
    });
  }
  async isMiniappIdentity(actor: string) {
    return this.identities().exists({ filter: { userId: actor } });
  }
  async bills(base: Access, merchantId: string, page: number) {
    await this.ensure(base.actor, merchantId);
    const list = await new BillingService(this.hyl).list(
      this.access(base, merchantId),
      'bills',
      billingList.parse({ merchantId, page, pageSize: 20, status: 'issued' }),
    );
    return {
      ...list,
      data: list.data.map((b) => ({
        id: b.id,
        number: b.number,
        dueDate: 'dueDate' in b ? b.dueDate : '',
        amountCents: String(b.amountCents),
        remainingCents: 'remainingCents' in b ? String(b.remainingCents) : '0',
        status: b.displayStatus,
      })),
    };
  }
  async assets(actor: string, merchantId: string) {
    await this.ensure(actor, merchantId);
    const today = repairToday();
    const bindings = await this.c()
      .repository<Binding>('hylAssetBindings')
      .findMany({ filter: { merchantId } });
    const ids = [
      ...new Set(
        bindings
          .filter((b) => b.start <= today && (!b.end || b.end >= today))
          .map((b) => b.assetId),
      ),
    ];
    if (!ids.length) return [];
    return (
      await this.c()
        .repository<Asset>('hylAssets')
        .findMany({
          filter: buildFilter((f) =>
            f.and([
              f.string('state').ne('inactive'),
              f.or(ids.map((id) => f.string('id').eq(id))),
            ]),
          ),
        })
    )
      .filter((a) => a.state !== 'inactive')
      .map((a) => ({ id: a.id, name: a.name, number: a.number }));
  }
  async createRepair(
    base: Access,
    merchantId: string,
    input: {
      assetId: string;
      title: string;
      description: string;
      category: string;
      requestId: string;
    },
  ) {
    const identity = await this.ensure(base.actor, merchantId);
    if (
      !(await this.assets(base.actor, merchantId)).some(
        (a) => a.id === input.assetId,
      )
    )
      fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    const values = createValues.parse({
      assetId: input.assetId,
      merchantId,
      title: input.title,
      description: input.description,
      category: input.category,
      priority: 'normal',
      reporterName: '商家小程序',
      reporterPhone: identity.phone,
      occurredOn: repairToday(),
    });
    const service = new RepairService(this.hyl);
    const access = this.access(base, merchantId, input.assetId);
    const row = await service.create(access, values, input.requestId, (c) =>
      this.ensure(base.actor, merchantId, c),
    );
    return repairFields(row);
  }
  async repairs(actor: string, merchantId: string, page: number) {
    await this.ensure(actor, merchantId);
    const repo = this.c().repository<RepairOrder>('hylRepairOrders'),
      filter = { merchantId };
    const data = await repo.findMany({
      filter,
      sort: (s) => [s.field('updatedAt').desc(), s.field('id').desc()],
      offset: (page - 1) * 20,
      limit: 20,
    });
    return {
      data: data.map(repairFields),
      meta: { page, pageSize: 20, total: await repo.count({ filter }) },
    };
  }
  async progress(actor: string, merchantId: string, id: string) {
    await this.ensure(actor, merchantId);
    const row = await this.c()
      .repository<RepairOrder>('hylRepairOrders')
      .findOne({ filter: { id, merchantId } });
    if (!row) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    const events = (
      await this.c()
        .repository<RepairEvent>('hylRepairEvents')
        .findMany({ filter: { orderId: id } })
    )
      .sort(
        (a, b) =>
          Number(b.payload.version) - Number(a.payload.version) ||
          b.createdAt.localeCompare(a.createdAt) ||
          b.id.localeCompare(a.id),
      )
      .slice(0, 50);
    return {
      ...repairFields(row),
      events: events.map((e) => ({
        id: e.id,
        action: e.action,
        status: e.toState,
        createdAt: e.createdAt,
      })),
    };
  }
}
