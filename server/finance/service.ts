import type { Order as SplitOrder, Transfer } from '../profit-sharing/model.js';
import { cents } from '../hyl/calculation.js';
import type { RepositoryPolicy } from '@nocobase/db';
import type { Access, HylService } from '../hyl/service.js';
import { fail } from '../hyl/service.js';
import type { Row } from '../hyl/schema.js';
import type { Asset, ContractAsset } from '../assets/schema.js';
import { assetPolicy } from '../providers/assets.js';
import { ProcurementService } from '../procurement/service.js';
import type { Row as Purchase } from '../procurement/model.js';
import type { RepairOrder } from '../repairs/model.js';
import type { Bill, Receipt, ReceiptEntry } from '../billing/model.js';
import type { Entry } from '../leases/model.js';
import { collectCashEvents, dayOf } from '../cashier/reports.js';
import { calculateReport, type Payment } from './calculation.js';
import { type Query, type Line, type Check } from './model.js';
import { buildFilter } from '@nocobase/repository-input';
const filterIds = (key: string, ids: string[]) =>
  buildFilter((f) =>
    ids.length
      ? f.or(ids.map((id) => f.string(key).eq(id)))
      : f.string('id').eq('__none__'),
  );
const intersection = (a: Set<string>, b: { id: string }[]) =>
  new Set(b.filter((r) => a.has(r.id)).map((r) => r.id));
export class FinanceService {
  constructor(readonly hyl: HylService) {}
  async snapshot(access: Access, input: Query) {
    // Resolve all authorization before holding SQLite's connection. Page access alone grants no data.
    const decision = await access.authorization.authorize({
      resource: { type: 'composite', id: 'hyl.finance' },
      action: 'read',
    });
    const fp = decision.conditions?.database;
    if (decision.effect === 'deny' || !fp?.hylContracts || !fp.hylAssets)
      fail('ACCESS_DENIED', 'PERMISSION_DENIED');
    const actions = [
      'read',
      'billingRead',
      'receiptRead',
      'depositRead',
      'cashierReconcileRead',
      'splitRead',
    ];
    const policies: RepositoryPolicy[] = [];
    for (const action of actions)
      policies.push(await this.hyl.policy(access, 'contracts', action));
    const mp = await this.hyl.policy(access, 'merchants', 'read'),
      sp = await this.hyl.policy(access, 'settlements', 'read'),
      ap = await assetPolicy(access, 'read');
    const procurement = new ProcurementService(this.hyl),
      pp = await procurement.policy(access, 'financeRead');
    let rp: RepositoryPolicy | undefined;
    try {
      rp = await procurement.repairs.permission(access, 'read');
    } catch (e) {
      if (
        !(e instanceof Error) ||
        !('status' in e) ||
        e.status !== 'PERMISSION_DENIED'
      )
        throw e;
    }
    const now = new Date(),
      day = dayOf(now.toISOString()),
      from = input.from ?? day.slice(0, 7) + '-01',
      to = input.to ?? day;
    if (from > to) fail('INVALID_PERIOD', 'INVALID_ARGUMENT');
    return this.hyl.db.transaction(async (c) => {
      const allAssets = (await c
        .repository<Asset>('hylAssets')
        .withPolicy(ap)
        .findMany()) as Asset[];
      const financeAssets = intersection(
        new Set(allAssets.map((a) => a.id)),
        (await c
          .repository<Asset>('hylAssets')
          .withPolicy(fp.hylAssets)
          .findMany()) as Asset[],
      );
      const purchaseAssets = intersection(
        financeAssets,
        (await c
          .repository<Asset>('hylAssets')
          .withPolicy(pp)
          .findMany()) as Asset[],
      );
      const repairAssets = rp
        ? intersection(
            new Set(allAssets.map((a) => a.id)),
            (await c
              .repository<Asset>('hylAssets')
              .withPolicy(rp)
              .findMany()) as Asset[],
          )
        : new Set<string>();
      const merchants = (await c
          .repository<Row>('hylMerchants')
          .withPolicy(mp)
          .findMany()) as Row[],
        merchantIds = new Set(merchants.map((m) => m.id));
      const readableContracts = (await c
          .repository<Row>('hylContracts')
          .withPolicy(policies[0])
          .findMany()) as Row[],
        readableIds = new Set(readableContracts.map((r) => r.id));
      let ids = new Set(
        (
          (await c
            .repository<Row>('hylContracts')
            .withPolicy(fp.hylContracts)
            .findMany()) as Row[]
        ).map((r) => r.id),
      );
      for (const policy of policies)
        ids = intersection(
          ids,
          (await c
            .repository<Row>('hylContracts')
            .withPolicy(policy)
            .findMany()) as Row[],
        );
      const bindings = await c
        .repository<ContractAsset>('hylContractAssets')
        .findMany({ filter: filterIds('contractId', [...ids]) });
      const contractProjects: Record<string, string> = {};
      const contracts = readableContracts.filter((r) => {
        if (!ids.has(r.id) || !merchantIds.has(r.merchantId)) return false;
        const bound = bindings.filter((b) => b.contractId === r.id);
        if (bound.some((b) => !financeAssets.has(b.assetId))) return false;
        const projects = [
          ...new Set(bound.map((b) => String(b.snapshot.projectId))),
        ];
        const project =
          projects.length === 1 ? projects[0] : projects.length ? 'mixed' : '';
        contractProjects[r.id] = project;
        return !input.projectId || project === input.projectId;
      });
      ids = new Set(contracts.map((r) => r.id));
      const own = (key = 'contractId') => filterIds(key, [...ids]);
      const settlements = (
        (await c
          .repository<Row>('hylSettlements')
          .withPolicy(sp)
          .findMany()) as Row[]
      ).filter((s) => ids.has(String(s.payload.contractId)));
      const payments = await c.repository<Payment>('hylPayments').findMany({
        filter: filterIds(
          'settlementId',
          settlements.map((r) => r.id),
        ),
      });
      const suppliers = await c
          .repository<Purchase>('hylPurchaseSuppliers')
          .findMany(),
        repairs = await c.repository<RepairOrder>('hylRepairOrders').findMany();
      const purchaseOrders = (
        await c.repository<Purchase>('hylPurchaseOrders').findMany()
      ).filter((o) => {
        if (
          !purchaseAssets.has(o.assetId) ||
          (input.projectId && o.projectId !== input.projectId)
        )
          return false;
        const supplier = suppliers.find((s) => s.id === o.supplierId);
        if (!supplier || !purchaseAssets.has(supplier.assetId)) return false;
        if (!o.repairId) return true;
        const repair = repairs.find((r) => r.id === o.repairId);
        return (
          !!repair &&
          repairAssets.has(repair.assetId) &&
          (!repair.merchantId || merchantIds.has(repair.merchantId)) &&
          (!repair.contractId || readableIds.has(repair.contractId))
        );
      });
      const purchaseLedger = await c
        .repository<Purchase>('hylPurchaseLedger')
        .findMany({
          filter: filterIds(
            'orderId',
            purchaseOrders.map((o) => o.id),
          ),
        });
      const splits = await c
        .repository<SplitOrder>('hylSplitOrders')
        .findMany({ filter: own() });
      const visibleSettlements = new Set(settlements.map((s) => s.id));
      const visibleSplits = new Set(
        splits
          .filter(
            (o) =>
              o.sourceKind === 'bill' || visibleSettlements.has(o.sourceId),
          )
          .map((o) => o.id),
      );
      const transfers = await c
        .repository<Transfer>('hylSplitTransfers')
        .findMany({ filter: own() });
      const visibleTransfers = new Set(
        transfers
          .filter((t) => visibleSplits.has(t.orderId))
          .map((t) => 'splitTransfer:' + t.id),
      );
      const cash = (await collectCashEvents(c, [...ids])).filter(
        (e) => !e.id.startsWith('splitTransfer:') || visibleTransfers.has(e.id),
      );
      for (const p of payments) {
        const s = settlements.find((s) => s.id === p.settlementId)!;
        cash.push({
          id: 'settlementPayment:' + p.id,
          contractId: String(s.payload.contractId),
          number: s.number,
          reference: p.reference,
          at: String(p.payload.at),
          date: String(p.payload.date),
          actor: String(p.payload.actor),
          method: 'unclassified',
          kind: 'payout',
          category: 'settlement',
          amountCents: String(-cents(String(p.payload.amount))),
        });
      }
      for (const p of purchaseLedger.filter((p) =>
        ['payment', 'paymentReversal'].includes(p.type),
      ))
        cash.push({
          id: 'purchaseLedger:' + p.id,
          contractId: '',
          number: p.number,
          at: p.createdAt,
          date: p.day,
          actor: p.actor,
          method: 'unclassified',
          kind: p.type,
          category: 'procurement',
          amountCents: String(
            BigInt(p.amountCents) * (p.type === 'payment' ? -1n : 1n),
          ),
        });
      const projects = allAssets
        .filter((a) => a.type === 'project' && financeAssets.has(a.id))
        .map((a) => ({ id: a.id, name: a.name }));
      // Party names are derived only from parents that survived all original source scopes.
      const contractParties = Object.fromEntries(
        contracts.map((r) => [
          r.id,
          merchants.find((m) => m.id === r.merchantId)?.name ?? '',
        ]),
      );
      const purchaseParties = Object.fromEntries(
        purchaseOrders.map((o) => [
          o.id,
          suppliers.find((s) => s.id === o.supplierId)?.title ?? '',
        ]),
      );
      const result = calculateReport(
        {
          contracts,
          bills: await c
            .repository<Bill>('hylBills')
            .findMany({ filter: own() }),
          receipts: await c
            .repository<Receipt>('hylReceipts')
            .findMany({ filter: own() }),
          receiptEntries: await c
            .repository<ReceiptEntry>('hylReceiptEntries')
            .findMany({ filter: own() }),
          leaseEntries: await c
            .repository<Entry>('hylLeaseEntries')
            .findMany({ filter: own() }),
          settlements,
          payments,
          purchaseOrders,
          purchaseLedger,
          cash,
          projects,
          contractProjects,
          contractParties,
          purchaseParties,
        },
        { from, to },
      );
      // Cash procurement lines inherit their order's project; there is no fake contract for them.
      for (const line of result.lines.cash.filter(
        (l) => l.type === 'procurement',
      )) {
        const journal = purchaseLedger.find(
          (p) => 'purchaseLedger:' + p.id === line.id,
        )!;
        const order = purchaseOrders.find((o) => o.id === journal.orderId)!;
        line.projectId = order.projectId;
        line.partyName = purchaseParties[order.id] ?? '';
        line.title = journal.type;
        line.reference =
          typeof journal.payload.reference === 'string'
            ? journal.payload.reference
            : '';
      }
      return {
        generatedAt: new Date().toISOString(),
        from,
        to,
        currency: 'CNY',
        projects,
        ...result,
      };
    });
  }
  async report(access: Access, input: Query) {
    const snapshot = await this.snapshot(access, input);
    let items: (Line | Check)[] =
      input.view === 'checks' ? snapshot.checks : snapshot.lines[input.view];
    const q = input.q.toLocaleLowerCase();
    items = items.filter((r) =>
      JSON.stringify(r).toLocaleLowerCase().includes(q),
    );
    const key = input.order.replace(/^-/, ''),
      sign = input.order.startsWith('-') ? -1 : 1;
    items.sort((a, b) => {
      const x = (a as unknown as Record<string, string>)[key] ?? '',
        y = (b as unknown as Record<string, string>)[key] ?? '';
      return (
        (key.endsWith('Cents')
          ? BigInt(x || '0') > BigInt(y || '0')
            ? 1
            : BigInt(x || '0') < BigInt(y || '0')
              ? -1
              : 0
          : x.localeCompare(y)) * sign || a.id.localeCompare(b.id)
      );
    });
    const { lines, ...data } = snapshot;
    void lines;
    return {
      data: {
        ...data,
        items: items.slice(
          (input.page - 1) * input.pageSize,
          input.page * input.pageSize,
        ),
      },
      meta: { page: input.page, pageSize: input.pageSize, total: items.length },
    };
  }
  async detail(access: Access, input: Query, kind: Line['kind'], id: string) {
    const r = await this.snapshot(access, input);
    const row = Object.values(r.lines)
      .flat()
      .find((r) => r.kind === kind && r.id === id);
    if (!row) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    return { ...row, generatedAt: r.generatedAt };
  }
}
