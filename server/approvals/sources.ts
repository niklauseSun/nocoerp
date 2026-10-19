import type { DatabaseConnection, RepositoryPolicy } from '@nocobase/db';
import type { HylService, Access } from '../hyl/service.js';
import type { Row as Contract } from '../hyl/schema.js';
import type { Bill } from '../billing/model.js';
import type { Row as Purchase } from '../procurement/model.js';
import { BillingService } from '../billing/service.js';
import { ProcurementService } from '../procurement/service.js';
import { assetPolicy } from '../providers/assets.js';
import { getAsset, lockProjects } from '../assets/transactions.js';
import { refuse, ruleForSource } from './gate.js';
import type { Kind } from './schema.js';
export interface Source {
  kind: Kind;
  id: string;
  projectId: string;
  merchantId: string;
  assetId: string;
  number: string;
  title: string;
  version: number;
  status: string;
  path: string;
  snapshot: Record<string, unknown>;
  policy: RepositoryPolicy;
  assetsPolicy: RepositoryPolicy;
  domainPolicy?: RepositoryPolicy;
}
const str = (v: unknown) => (typeof v === 'string' ? v : '');
export class ApprovalSources {
  readonly billing: BillingService;
  readonly procurement: ProcurementService;
  constructor(readonly hyl: HylService) {
    this.billing = new BillingService(hyl);
    this.procurement = new ProcurementService(hyl);
  }
  async load(
    access: Access,
    kind: Kind,
    id: string,
    mode: 'read' | 'submit' | 'decide' = 'read',
  ): Promise<Source> {
    const ap = await assetPolicy(
      access,
      kind === 'contracts' && mode === 'decide' ? 'write' : 'read',
    );
    if (kind === 'contracts') {
      const policy = await this.hyl.policy(
          access,
          'contracts',
          mode === 'read' ? 'read' : 'write',
        ),
        r = await this.hyl.get(
          access,
          'contracts',
          id,
          mode === 'read' ? 'read' : 'write',
          undefined,
          policy,
        );
      const rule = await ruleForSource(
        this.hyl.db,
        this.hyl.db.connection(),
        kind,
        id,
      );
      for (const aid of Array.isArray(r.payload.assetIds)
        ? r.payload.assetIds
        : [])
        await getAsset(this.hyl.db.connection(), String(aid), ap);
      return this.contract(r, rule.projectId, policy, ap);
    }
    if (kind === 'bills') {
      const r = await this.billing.billDetail(access, id),
        policy = await this.hyl.policy(
          access,
          'contracts',
          mode === 'read'
            ? 'billingRead'
            : mode === 'submit'
              ? 'billWrite'
              : 'billIssue',
        );
      await this.hyl.get(
        access,
        'contracts',
        r.contractId,
        mode === 'read'
          ? 'billingRead'
          : mode === 'submit'
            ? 'billWrite'
            : 'billIssue',
        undefined,
        policy,
      );
      const rule = await ruleForSource(
        this.hyl.db,
        this.hyl.db.connection(),
        kind,
        id,
      );
      if (rule.projectId)
        await getAsset(this.hyl.db.connection(), rule.projectId, ap);
      return this.bill(r, rule.projectId, policy, ap);
    }
    const r = await this.procurement.row('requests', id);
    await this.procurement.scoped(access, 'requests', r);
    const p = await this.procurement.scoped(
      access,
      'requests',
      r,
      mode === 'read' ? 'read' : mode === 'submit' ? 'request' : 'review',
    );
    return this.purchase(r, p.ap, p.policy);
  }
  contract(
    r: Contract,
    projectId: string,
    policy: RepositoryPolicy,
    assetsPolicy: RepositoryPolicy,
  ): Source {
    const fields = [
      'title',
      'start',
      'end',
      'cycle',
      'method',
      'basis',
      'rate',
      'fixedFee',
      'minimum',
      'rent',
      'includeActivity',
      'includeCash',
      'includeHospitality',
      'depositTarget',
      'assetIds',
    ];
    return {
      kind: 'contracts',
      id: r.id,
      projectId,
      merchantId: r.merchantId,
      assetId: '',
      number: r.number,
      title: str(r.payload.title) || r.number,
      version: r.version,
      status: r.status,
      path: '/contracts/' + r.id,
      snapshot: {
        number: r.number,
        merchantId: r.merchantId,
        ...Object.fromEntries(fields.map((k) => [k, r.payload[k] ?? null])),
      },
      policy,
      assetsPolicy,
    };
  }
  bill(
    r: Bill,
    projectId: string,
    policy: RepositoryPolicy,
    assetsPolicy: RepositoryPolicy,
  ): Source {
    return {
      kind: 'bills',
      id: r.id,
      projectId,
      merchantId: r.merchantId,
      assetId: '',
      number: r.number,
      title: r.number,
      version: r.version,
      status: r.status,
      path: '/billing/bills/' + r.id,
      snapshot: {
        number: r.number,
        contractId: r.contractId,
        amountCents: r.amountCents,
        dueDate: r.dueDate,
        start: r.start,
        end: r.end,
        input: r.payload.input,
        configVersion: r.payload.configVersion,
      },
      policy,
      assetsPolicy,
    };
  }
  purchase(
    r: Purchase,
    assetsPolicy: RepositoryPolicy,
    domainPolicy: RepositoryPolicy,
  ): Source {
    return {
      kind: 'purchases',
      id: r.id,
      projectId: r.projectId,
      merchantId: '',
      assetId: r.assetId,
      number: r.number,
      title: r.title,
      version: r.version,
      status: r.status,
      path: '/procurement/requests/' + r.id,
      snapshot: {
        number: r.number,
        title: r.title,
        assetId: r.assetId,
        amountCents: r.amountCents,
        neededOn: r.payload.neededOn ?? '',
        items: r.payload.items ?? [],
        reason: r.payload.reason ?? '',
      },
      policy: assetsPolicy,
      assetsPolicy,
      domainPolicy,
    };
  }
  async lock(c: DatabaseConnection, s: Source) {
    if (s.merchantId) await this.hyl.lockMerchant(c, s.merchantId);
    else await lockProjects(c, [s.projectId]);
  }
  async fresh(
    c: DatabaseConnection,
    s: Source,
    access: Access,
  ): Promise<Source> {
    if (s.kind === 'contracts') {
      const r = await this.hyl.get(
          access,
          'contracts',
          s.id,
          'read',
          c,
          s.policy,
        ),
        rule = await ruleForSource(this.hyl.db, c, s.kind, s.id);
      for (const aid of Array.isArray(r.payload.assetIds)
        ? r.payload.assetIds
        : [])
        await getAsset(c, String(aid), s.assetsPolicy);
      if (rule.projectId !== s.projectId)
        refuse('APPROVAL_SOURCE_CHANGED', 'ABORTED');
      return this.contract(r, s.projectId, s.policy, s.assetsPolicy);
    }
    if (s.kind === 'bills') {
      const r = await this.billing.findBill(s.id, c);
      await this.hyl.get(
        access,
        'contracts',
        r.contractId,
        'read',
        c,
        s.policy,
      );
      const rule = await ruleForSource(this.hyl.db, c, s.kind, s.id);
      if (rule.projectId !== s.projectId)
        refuse('APPROVAL_SOURCE_CHANGED', 'ABORTED');
      return this.bill(r, s.projectId, s.policy, s.assetsPolicy);
    }
    const r = await this.procurement.row('requests', s.id, c);
    await getAsset(c, r.assetId, s.assetsPolicy);
    await getAsset(c, r.assetId, s.domainPolicy!);
    if (r.projectId !== s.projectId || r.assetId !== s.assetId)
      refuse('APPROVAL_SOURCE_CHANGED', 'ABORTED');
    return this.purchase(r, s.assetsPolicy, s.domainPolicy!);
  }
}
