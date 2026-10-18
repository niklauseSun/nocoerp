import { randomUUID, createHash } from 'node:crypto';
import { ApiError } from '@nocobase/app-server/router';
import type { DatabaseConnection, JsonValue } from '@nocobase/db';
import { assetPolicy } from '../providers/assets.js';
import { available, getAsset, lockProjects } from '../assets/transactions.js';
import { fail, type Access, type HylService } from '../hyl/service.js';
import { RepairService } from '../repairs/service.js';
import { cents } from '../hyl/calculation.js';
import { today } from '../inspections/calendar.js';
import {
  tables,
  stages,
  permission,
  type Kind,
  type Row,
  type Event,
  type Input,
  type SupplierValues,
  type RequestValues,
  type ReceiptValues,
  type Item,
  type ListInput,
} from './model.js';
const now = () => new Date().toISOString(),
  str = (v: unknown) => (typeof v === 'string' ? v : ''),
  json = (v: unknown) => JSON.parse(JSON.stringify(v)) as JsonValue;
const missing = (e: unknown) =>
  e instanceof ApiError &&
  ['PERMISSION_DENIED', 'NOT_FOUND'].includes(e.status);
const items = (r: Row) => (r.payload.items ?? []) as Item[];
function price(values: RequestValues['items']) {
  return values.map((v, i) => ({
    ...v,
    id: 'item-' + (i + 1),
    unitPriceCents: cents(v.unitPrice).toString(),
    lineCents: (cents(v.unitPrice) * BigInt(v.quantity)).toString(),
  }));
}
function total(lines: Item[]) {
  const v = lines.reduce((a, l) => a + BigInt(l.lineCents), 0n);
  if (v > 99999999999999n) fail('PURCHASE_TOTAL_LIMIT');
  return v.toString();
}
export class ProcurementService {
  readonly repairs: RepairService;
  constructor(readonly hyl: HylService) {
    this.repairs = new RepairService(hyl);
  }
  c() {
    return this.hyl.db.connection();
  }
  async policy(access: Access, action: string) {
    const d = await access.authorization.authorize({
        resource: { type: 'composite', id: 'hyl.procurement' },
        action,
      }),
      p = d.conditions?.database?.hylAssets;
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
  async row(kind: Kind, id: string, c = this.c()) {
    const r = await c.repository<Row>(tables[kind]).findOne({ filter: { id } });
    if (!r) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    return r;
  }
  async scoped(
    access: Access,
    kind: Kind,
    r: Row,
    action = permission(kind, 'read'),
  ) {
    const ids = [r.assetId];
    if (r.supplierId) {
      const supplier = await this.row('suppliers', r.supplierId);
      ids.push(supplier.assetId);
    }
    const p = await this.prepare(access, action, ids);
    if (r.repairId)
      await this.repairs.scoped(access, await this.repairs.row(r.repairId));
    return p;
  }
  async atomic(
    access: Access,
    id: string,
    intent: unknown,
    p: Awaited<ReturnType<ProcurementService['prepare']>>,
    fn: (c: DatabaseConnection) => Promise<Row>,
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
          fail('PURCHASE_CHANGED', 'ABORTED');
      }
      const ops = c.repository<{
          id: string;
          actor: string;
          hash: string;
          result: Row;
          createdAt: string;
        }>('hylPurchaseOperations'),
        prior = await ops.findOne({ filter: { id } });
      if (prior) {
        if (prior.actor !== access.actor || prior.hash !== hash)
          fail('PURCHASE_REQUEST_CONFLICT', 'ALREADY_EXISTS');
        return prior.result;
      }
      const r = await fn(c);
      await ops.createOne({
        values: { id, actor: access.actor, hash, result: r, createdAt: now() },
      });
      return r;
    });
  }
  base(kind: Kind, v: Partial<Row>) {
    const id = randomUUID(),
      at = now(),
      prefix = {
        suppliers: 'GYS',
        requests: 'CGSQ',
        orders: 'CGDD',
        receipts: 'SHYS',
        payments: 'CGFK',
        ledger: 'CGTZ',
      }[kind];
    return {
      id,
      number: prefix + '-' + id.slice(0, 8).toUpperCase(),
      title: '',
      projectId: '',
      assetId: '',
      repairId: '',
      supplierId: '',
      requestId: '',
      orderId: '',
      sourceId: '',
      day: today(),
      actor: '',
      type: kind,
      version: 0,
      amountCents: '0',
      acceptedCents: '0',
      paidCents: '0',
      dedupeKey: null,
      payload: {},
      createdAt: at,
      updatedAt: at,
      ...v,
    };
  }
  async audit(
    c: DatabaseConnection,
    kind: Kind,
    r: Row,
    actor: string,
    action: string,
    fromState: string,
    details: unknown,
  ) {
    const u = await this.hyl.users.withConnection(c).get(actor);
    await c.repository('hylPurchaseEvents').createOne({
      values: {
        id: randomUUID(),
        recordId: r.id,
        kind,
        version: r.version,
        actor,
        action,
        fromState,
        toState: r.status,
        payload: json({ details, actorName: u?.name ?? '' }),
        createdAt: now(),
      },
    });
  }
  async createRow(
    c: DatabaseConnection,
    kind: Kind,
    values: ReturnType<ProcurementService['base']>,
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
  check(r: Row, version: number) {
    if (r.version !== version) fail('PURCHASE_CHANGED', 'ABORTED');
  }
  async save(
    c: DatabaseConnection,
    kind: Kind,
    r: Row,
    action: string,
    actor: string,
    patch: Partial<Row>,
    details: unknown,
  ) {
    await this.hyl.runtime.fire(tables[kind], r.id, action, {
      actor: { id: actor },
      transaction: c,
      expect: { version: r.lifecycleVersion },
    });
    const result = await c.repository(tables[kind]).updateMany({
      filter: { id: r.id, version: r.version },
      values: { ...patch, version: r.version + 1, updatedAt: now() },
    });
    if (result.updatedCount !== 1) fail('PURCHASE_CHANGED', 'ABORTED');
    const out = await this.row(kind, r.id, c);
    await this.audit(c, kind, out, actor, action, r.status, details);
    return out;
  }
  async supplierValid(c: DatabaseConnection, r: Row) {
    if (
      r.status !== 'active' ||
      (str(r.payload.qualificationUntil) &&
        str(r.payload.qualificationUntil) < today())
    )
      fail('PURCHASE_SUPPLIER_UNAVAILABLE');
    const a = await c
      .repository<{ id: string; state: string }>('hylAssets')
      .findOne({ filter: { id: r.assetId } });
    if (!a || a.state === 'inactive') fail('PURCHASE_ASSET_INVALID');
  }
  async repairValid(c: DatabaseConnection, id: string, assetId: string) {
    if (!id) return;
    const r = await this.repairs.row(id, c);
    if (r.assetId !== assetId || ['closed', 'cancelled'].includes(r.status))
      fail('PURCHASE_REPAIR_INVALID');
  }
  async createSupplier(
    access: Access,
    values: SupplierValues,
    requestId: string,
  ) {
    const p = await this.prepare(access, 'manage', [values.projectId]);
    const r = await this.atomic(
      access,
      requestId,
      { supplier: values },
      p,
      async (c) => {
        const a = await getAsset(c, values.projectId, p.ap);
        if (a.type !== 'project' || a.state === 'inactive')
          fail('PURCHASE_PROJECT_INVALID');
        const key = a.id + ':' + values.name.toLowerCase();
        if (
          await c
            .repository(tables.suppliers)
            .exists({ filter: { dedupeKey: key } })
        )
          fail('PURCHASE_SUPPLIER_EXISTS', 'ALREADY_EXISTS');
        return this.createRow(
          c,
          'suppliers',
          this.base('suppliers', {
            title: values.name,
            assetId: a.id,
            projectId: a.id,
            actor: access.actor,
            dedupeKey: key,
            payload: { ...values, assetName: a.name },
          }),
          access.actor,
        );
      },
    );
    return this.view(access, 'suppliers', r);
  }
  async createRequest(
    access: Access,
    values: RequestValues,
    requestId: string,
  ) {
    const p = await this.prepare(access, 'request', [values.assetId]);
    if (values.repairId)
      await this.repairs.scoped(
        access,
        await this.repairs.row(values.repairId),
      );
    const r = await this.atomic(
      access,
      requestId,
      { request: values },
      p,
      async (c) => {
        const a = await getAsset(c, values.assetId, p.ap);
        await available(c, a);
        await this.repairValid(c, values.repairId, values.assetId);
        if (values.neededOn < today()) fail('PURCHASE_DATE_INVALID');
        const lines = price(values.items);
        return this.createRow(
          c,
          'requests',
          this.base('requests', {
            title: values.title,
            assetId: a.id,
            projectId: a.projectId,
            repairId: values.repairId,
            actor: access.actor,
            amountCents: total(lines),
            payload: {
              ...values,
              items: lines,
              assetName: a.name,
              repairNumber: values.repairId
                ? (await this.repairs.row(values.repairId, c)).number
                : '',
            },
          }),
          access.actor,
        );
      },
    );
    return this.view(access, 'requests', r);
  }
  async receiptChecks(
    c: DatabaseConnection,
    order: Row,
    v: Omit<ReceiptValues, 'orderId'>,
    exclude = '',
  ) {
    if (order.status !== 'issued') fail('PURCHASE_STAGE_INVALID');
    this.checkDate(v.day, order.day);
    const others = await c
        .repository<Row>(tables.receipts)
        .findMany({ filter: { orderId: order.id } }),
      reserved = new Map<string, number>();
    for (const r of others)
      if (r.id !== exclude && r.status !== 'cancelled')
        for (const l of r.payload.lines as ReceiptValues['lines'])
          reserved.set(l.itemId, (reserved.get(l.itemId) ?? 0) + l.accepted);
    for (const l of v.lines) {
      const item = items(order).find((i) => i.id === l.itemId);
      if (!item || l.accepted + (reserved.get(l.itemId) ?? 0) > item.quantity)
        fail('PURCHASE_QUANTITY_EXCEEDED');
    }
    return v.lines.map((l) => ({
      ...l,
      ...{
        name: items(order).find((i) => i.id === l.itemId)!.name,
        unit: items(order).find((i) => i.id === l.itemId)!.unit,
        unitPriceCents: items(order).find((i) => i.id === l.itemId)!
          .unitPriceCents,
        lineCents: (
          BigInt(items(order).find((i) => i.id === l.itemId)!.unitPriceCents) *
          BigInt(l.accepted)
        ).toString(),
      },
    }));
  }
  checkDate(day: string, min: string) {
    if (day > today() || day < min) fail('PURCHASE_DATE_INVALID');
  }
  async createReceipt(
    access: Access,
    values: ReceiptValues,
    requestId: string,
    expectedOrderVersion: number,
  ) {
    const order = await this.row('orders', values.orderId),
      p = await this.scoped(access, 'orders', order, 'receive');
    const r = await this.atomic(
      access,
      requestId,
      { receipt: values, expectedOrderVersion },
      p,
      async (c) => {
        const order = await this.row('orders', values.orderId, c);
        this.check(order, expectedOrderVersion);
        const lines = await this.receiptChecks(c, order, values);
        const receipt = await this.createRow(
          c,
          'receipts',
          this.base('receipts', {
            title: order.title,
            projectId: order.projectId,
            assetId: order.assetId,
            repairId: order.repairId,
            supplierId: order.supplierId,
            requestId: order.requestId,
            orderId: order.id,
            day: values.day,
            actor: access.actor,
            amountCents: lines
              .reduce((a, l) => a + BigInt(l.lineCents), 0n)
              .toString(),
            payload: {
              ...values,
              lines,
              assetName: order.payload.assetName,
              supplierName: order.payload.supplierName,
              orderNumber: order.number,
            },
          }),
          access.actor,
        );
        await this.save(
          c,
          'orders',
          order,
          'receive',
          access.actor,
          {},
          { receiptId: receipt.id },
        );
        return receipt;
      },
    );
    return this.view(access, 'receipts', r);
  }
  async balances(c: DatabaseConnection, order: Row) {
    const receipts = await c
        .repository<Row>(tables.receipts)
        .findMany({ filter: { orderId: order.id, status: 'accepted' } }),
      ledger = await c
        .repository<Row>(tables.ledger)
        .findMany({ filter: { orderId: order.id } });
    const received: Record<string, number> = {};
    let accepted = 0n,
      paid = 0n;
    for (const r of receipts) {
      accepted += BigInt(r.amountCents);
      for (const l of r.payload.lines as ReceiptValues['lines'])
        received[l.itemId] = (received[l.itemId] ?? 0) + l.accepted;
    }
    for (const r of ledger)
      if (r.type === 'payment') paid += BigInt(r.amountCents);
      else if (r.type === 'paymentReversal') paid -= BigInt(r.amountCents);
    if (paid < 0n || paid > accepted) fail('PURCHASE_LEDGER_INVALID');
    return {
      acceptedCents: accepted.toString(),
      paidCents: paid.toString(),
      payload: { ...order.payload, received },
    };
  }
  async journal(
    c: DatabaseConnection,
    order: Row,
    type: string,
    amountCents: string,
    sourceId: string,
    day: string,
    actor: string,
    extra: Record<string, unknown> = {},
  ) {
    return this.createRow(
      c,
      'ledger',
      this.base('ledger', {
        title: order.title,
        type,
        assetId: order.assetId,
        projectId: order.projectId,
        repairId: order.repairId,
        supplierId: order.supplierId,
        requestId: order.requestId,
        orderId: order.id,
        sourceId,
        day,
        actor,
        amountCents,
        dedupeKey: type + ':' + sourceId,
        payload: {
          assetName: order.payload.assetName,
          supplierName: order.payload.supplierName,
          orderNumber: order.number,
          ...extra,
        },
      }),
      actor,
    );
  }
  async act(access: Access, kind: Kind, id: string, input: Input) {
    const initial = await this.row(kind, id);
    await this.scoped(access, kind, initial);
    const p = await this.scoped(
      access,
      kind,
      initial,
      permission(kind, input.action),
    );
    let supplier: Row | undefined;
    if (input.action === 'convert') {
      supplier = await this.row('suppliers', input.supplierId);
      await this.scoped(access, 'suppliers', supplier);
      const other = await this.prepare(access, 'purchase', [
        initial.assetId,
        supplier.assetId,
      ]);
      p.assets = other.assets;
      p.policy = other.policy;
      p.ap = other.ap;
    }
    const r = await this.atomic(
      access,
      input.requestId,
      { kind, id, input },
      p,
      async (c) => {
        const r = await this.row(kind, id, c);
        this.check(r, input.expectedVersion);
        if (!(stages[kind][input.action] ?? []).includes(r.status))
          fail('PURCHASE_STAGE_INVALID');
        if (
          ['submit', 'approve', 'convert', 'issue'].includes(input.action) &&
          kind !== 'receipts'
        )
          await available(c, await getAsset(c, r.assetId, p.ap));
        const payload = { ...r.payload };
        let patch: Partial<Row> = {};
        if (kind === 'suppliers') {
          if (
            input.action === 'edit' &&
            'values' in input &&
            'name' in input.values
          ) {
            const key = r.projectId + ':' + input.values.name.toLowerCase(),
              existing = await c
                .repository<Row>(tables.suppliers)
                .findOne({ filter: { dedupeKey: key } });
            if (existing && existing.id !== r.id)
              fail('PURCHASE_SUPPLIER_EXISTS', 'ALREADY_EXISTS');
            Object.assign(payload, input.values);
            patch = { title: input.values.name, dedupeKey: key };
          }
        } else if (kind === 'requests') {
          if (
            input.action === 'edit' &&
            'values' in input &&
            'items' in input.values
          ) {
            if (input.values.neededOn < r.day) fail('PURCHASE_DATE_INVALID');
            const lines = price(input.values.items);
            Object.assign(payload, input.values, { items: lines });
            patch = { title: input.values.title, amountCents: total(lines) };
          }
          if (['submit', 'approve', 'convert'].includes(input.action))
            await this.repairValid(c, r.repairId, r.assetId);
          if (input.action === 'convert') {
            const s = await this.row('suppliers', supplier!.id, c);
            if (s.projectId !== r.projectId) fail('PURCHASE_SUPPLIER_PROJECT');
            await this.supplierValid(c, s);
            const order = await this.createRow(
              c,
              'orders',
              this.base('orders', {
                title: r.title,
                projectId: r.projectId,
                assetId: r.assetId,
                repairId: r.repairId,
                supplierId: s.id,
                requestId: r.id,
                actor: access.actor,
                amountCents: r.amountCents,
                dedupeKey: r.id,
                payload: {
                  ...payload,
                  supplierSnapshot: s.payload,
                  supplierName: s.title,
                  requestNumber: r.number,
                  items: items(r),
                  received: {},
                },
              }),
              access.actor,
            );
            payload.orderId = order.id;
            payload.orderNumber = order.number;
          }
        } else if (kind === 'orders') {
          if (input.action === 'edit' && 'prices' in input) {
            if (
              input.prices.length !== items(r).length ||
              new Set(input.prices.map((p) => p.itemId)).size !==
                items(r).length
            )
              fail('PURCHASE_PRICE_INVALID');
            const request = await this.row('requests', r.requestId, c),
              lines = items(r).map((i) => {
                const p = input.prices.find((p) => p.itemId === i.id),
                  cap = items(request).find((v) => v.id === i.id);
                if (
                  !p ||
                  !cap ||
                  cents(p.unitPrice) > BigInt(cap.unitPriceCents)
                )
                  fail('PURCHASE_PRICE_INVALID');
                return {
                  ...i,
                  unitPrice: p.unitPrice,
                  unitPriceCents: cents(p.unitPrice).toString(),
                  lineCents: (
                    cents(p.unitPrice) * BigInt(i.quantity)
                  ).toString(),
                };
              });
            payload.items = lines;
            patch.amountCents = total(lines);
          }
          if (input.action === 'issue') {
            await this.supplierValid(
              c,
              await this.row('suppliers', r.supplierId, c),
            );
            await this.repairValid(c, r.repairId, r.assetId);
          }
          if (input.action === 'cancel') {
            const receipts = await c
              .repository<Row>(tables.receipts)
              .findMany({ filter: { orderId: r.id } });
            if (
              receipts.some((v) => v.status !== 'cancelled') ||
              BigInt(r.paidCents) > 0n
            )
              fail('PURCHASE_ORDER_IN_USE');
          }
          if (input.action === 'settle') {
            const b = await this.balances(c, r);
            if (
              BigInt(b.acceptedCents) !== BigInt(r.amountCents) ||
              BigInt(b.paidCents) !== BigInt(r.amountCents)
            )
              fail('PURCHASE_NOT_SETTLED');
            Object.assign(patch, b);
          }
          if (input.action === 'pay') {
            this.checkDate(input.day, r.day);
            const b = await this.balances(c, r),
              value = cents(input.amount);
            if (value > BigInt(b.acceptedCents) - BigInt(b.paidCents))
              fail('PURCHASE_PAYMENT_EXCEEDED');
            const key = r.projectId + ':' + input.reference.toLowerCase();
            if (
              await c
                .repository(tables.payments)
                .exists({ filter: { dedupeKey: key } })
            )
              fail('PURCHASE_REFERENCE_EXISTS', 'ALREADY_EXISTS');
            const payment = await this.createRow(
              c,
              'payments',
              this.base('payments', {
                title: r.title,
                assetId: r.assetId,
                projectId: r.projectId,
                repairId: r.repairId,
                supplierId: r.supplierId,
                requestId: r.requestId,
                orderId: r.id,
                actor: access.actor,
                amountCents: value.toString(),
                day: input.day,
                dedupeKey: key,
                payload: {
                  reference: input.reference,
                  channel: input.channel,
                  evidence: input.evidence,
                  note: input.note,
                  assetName: r.payload.assetName,
                  supplierName: r.payload.supplierName,
                  orderNumber: r.number,
                  simulated: true,
                },
              }),
              access.actor,
            );
            await this.journal(
              c,
              r,
              'payment',
              value.toString(),
              payment.id,
              input.day,
              access.actor,
              { reference: input.reference },
            );
            Object.assign(patch, await this.balances(c, r));
            payload.lastPaymentId = payment.id;
          }
        } else if (kind === 'receipts') {
          const order = await this.row('orders', r.orderId, c);
          if (
            input.action === 'edit' &&
            'values' in input &&
            'lines' in input.values
          ) {
            const lines = await this.receiptChecks(
              c,
              order,
              input.values,
              r.id,
            );
            Object.assign(payload, input.values, { lines });
            patch = {
              day: input.values.day,
              amountCents: lines
                .reduce((a, l) => a + BigInt(l.lineCents), 0n)
                .toString(),
            };
          }
          if (['submit', 'accept'].includes(input.action))
            await this.receiptChecks(
              c,
              order,
              {
                day: r.day,
                evidence: str(payload.evidence),
                notes: str(payload.notes),
                lines: payload.lines as ReceiptValues['lines'],
              },
              r.id,
            );
          const receipt = await this.save(
            c,
            kind,
            r,
            input.action,
            access.actor,
            { ...patch, payload: json(payload) as Record<string, unknown> },
            input,
          );
          if (input.action === 'accept' && BigInt(receipt.amountCents) > 0n)
            await this.journal(
              c,
              order,
              'accrual',
              receipt.amountCents,
              r.id,
              r.day,
              access.actor,
            );
          if (order.status === 'issued')
            await this.save(
              c,
              'orders',
              order,
              'receive',
              access.actor,
              await this.balances(c, order),
              { receiptId: r.id, receiptAction: input.action },
            );
          return receipt;
        } else if (kind === 'payments' && input.action === 'reverse') {
          const order = await this.row('orders', r.orderId, c);
          this.checkDate(input.day, r.day);
          if (!['issued', 'settled'].includes(order.status))
            fail('PURCHASE_STAGE_INVALID');
          const payment = await this.save(
            c,
            kind,
            r,
            'reverse',
            access.actor,
            {
              payload: {
                ...payload,
                reversalNote: input.note,
                reversedOn: input.day,
              },
            },
            input,
          );
          await this.journal(
            c,
            order,
            'paymentReversal',
            r.amountCents,
            r.id,
            input.day,
            access.actor,
            { note: input.note, reference: r.payload.reference },
          );
          await this.save(
            c,
            'orders',
            order,
            'reverse',
            access.actor,
            await this.balances(c, order),
            { paymentId: r.id, note: input.note },
          );
          return payment;
        }
        if ('note' in input && input.action !== 'pay')
          payload.lastDecision = input.note;
        // balances returns a fresh received map. Preserve it while appending action links.
        const merged = { ...(patch.payload ?? payload), ...payload };
        return this.save(
          c,
          kind,
          r,
          input.action,
          access.actor,
          { ...patch, payload: json(merged) as Record<string, unknown> },
          input.action === 'pay'
            ? { action: 'pay', amountCents: patch.paidCents }
            : input,
        );
      },
    );
    return this.view(access, kind, r);
  }
  async blocked(kind: Kind, r: Row, action: string) {
    if (
      (kind === 'orders' && action === 'issue') ||
      (kind === 'requests' && ['submit', 'approve', 'convert'].includes(action))
    ) {
      try {
        await this.repairValid(this.c(), r.repairId, r.assetId);
        if (kind === 'orders')
          await this.supplierValid(
            this.c(),
            await this.row('suppliers', r.supplierId),
          );
      } catch (e) {
        if (e instanceof ApiError) return e.reason ?? 'PURCHASE_STAGE_INVALID';
        throw e;
      }
    }
    if (kind === 'orders') {
      if (action === 'pay' && BigInt(r.acceptedCents) <= BigInt(r.paidCents))
        return 'PURCHASE_NO_PAYABLE';
      if (
        action === 'settle' &&
        (BigInt(r.acceptedCents) !== BigInt(r.amountCents) ||
          BigInt(r.paidCents) !== BigInt(r.amountCents))
      )
        return 'PURCHASE_NOT_SETTLED';
      if (
        action === 'cancel' &&
        (
          await this.c()
            .repository<Row>(tables.receipts)
            .findMany({ filter: { orderId: r.id } })
        ).some((v) => v.status !== 'cancelled')
      )
        return 'PURCHASE_ORDER_IN_USE';
    }
    return '';
  }
  async view(access: Access, kind: Kind, r: Row) {
    const allowedActions: string[] = [],
      blockedActions: Record<string, string> = {};
    for (const [action, statuses] of Object.entries(stages[kind]))
      if (
        statuses.includes(r.status) &&
        !(kind === 'orders' && ['receive', 'reverse'].includes(action))
      ) {
        try {
          await this.scoped(access, kind, r, permission(kind, action));
          allowedActions.push(action);
          const reason = await this.blocked(kind, r, action);
          if (reason) blockedActions[action] = reason;
        } catch (e) {
          if (!missing(e)) throw e;
        }
      }
    if (kind === 'orders' && r.status === 'issued') {
      try {
        await this.scoped(access, kind, r, 'receive');
        allowedActions.push('newReceipt');
        if (BigInt(r.acceptedCents) === BigInt(r.amountCents))
          blockedActions.newReceipt = 'PURCHASE_ALL_RECEIVED';
      } catch (e) {
        if (!missing(e)) throw e;
      }
    }
    return {
      ...r,
      allowedActions,
      blockedActions,
      outstandingCents: (
        BigInt(r.acceptedCents) - BigInt(r.paidCents)
      ).toString(),
    };
  }
  async detail(access: Access, kind: Kind, id: string, eventPage = 1) {
    const r = await this.row(kind, id);
    await this.scoped(access, kind, r);
    const repo = this.c().repository<Event>('hylPurchaseEvents');
    return {
      ...(await this.view(access, kind, r)),
      events: {
        data: await repo.findMany({
          filter: { recordId: id },
          sort: (s) => [s.field('version').desc()],
          limit: 20,
          offset: (eventPage - 1) * 20,
        }),
        meta: {
          page: eventPage,
          pageSize: 20,
          total: await repo.count({ filter: { recordId: id } }),
        },
      },
    };
  }
  async list(access: Access, kind: Kind, input: ListInput) {
    await this.policy(access, permission(kind, 'read'));
    const all = await this.c().repository<Row>(tables[kind]).findMany({}),
      rows: Row[] = [];
    for (const r of all) {
      if (
        [
          'status',
          'assetId',
          'projectId',
          'repairId',
          'supplierId',
          'requestId',
          'orderId',
        ].some(
          (k) =>
            input[k as keyof ListInput] &&
            input[k as keyof ListInput] !== r[k as keyof Row],
        )
      )
        continue;
      if (
        input.q &&
        ![
          r.number,
          r.title,
          r.payload.assetName,
          r.payload.supplierName,
          r.payload.reference,
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
    const field = input.order.replace(/^-/, '') as keyof Row,
      dir = input.order.startsWith('-') ? -1 : 1;
    rows.sort(
      (a, b) =>
        dir *
          (field === 'amountCents'
            ? BigInt(a.amountCents) > BigInt(b.amountCents)
              ? 1
              : BigInt(a.amountCents) < BigInt(b.amountCents)
                ? -1
                : 0
            : str(a[field]).localeCompare(str(b[field]))) ||
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
  async summary(access: Access, repairId = '') {
    await this.policy(access, 'financeRead');
    const all = await this.c().repository<Row>(tables.orders).findMany({}),
      totals = { accepted: 0n, paid: 0n };
    for (const r of all) {
      if ((repairId && r.repairId !== repairId) || r.status === 'cancelled')
        continue;
      try {
        await this.scoped(access, 'orders', r, 'financeRead');
        totals.accepted += BigInt(r.acceptedCents);
        totals.paid += BigInt(r.paidCents);
      } catch (e) {
        if (!missing(e)) throw e;
      }
    }
    return {
      acceptedCents: totals.accepted.toString(),
      paidCents: totals.paid.toString(),
      outstandingCents: (totals.accepted - totals.paid).toString(),
    };
  }
  async assets(access: Access, q: string, page: number, projectsOnly = false) {
    const action = projectsOnly ? 'manage' : 'request';
    await this.policy(access, action);
    const all = await this.c()
        .repository<{
          id: string;
          name: string;
          number: string;
          type: string;
          state: string;
        }>('hylAssets')
        .findMany({}),
      rows = [];
    for (const r of all) {
      if (
        r.state === 'inactive' ||
        (projectsOnly && r.type !== 'project') ||
        ![r.name, r.number].join(' ').toLowerCase().includes(q.toLowerCase())
      )
        continue;
      try {
        await this.prepare(access, action, [r.id]);
        rows.push({ id: r.id, name: r.name, number: r.number });
      } catch (e) {
        if (!missing(e)) throw e;
      }
    }
    return {
      data: rows.slice((page - 1) * 20, page * 20),
      meta: { page, pageSize: 20, total: rows.length },
    };
  }
}
