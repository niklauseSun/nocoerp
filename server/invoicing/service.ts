import { randomUUID } from 'node:crypto';
import { ApiError } from '@nocobase/app-server/router';
import { buildFilter } from '@nocobase/repository-input';
import type { DatabaseConnection, RepositoryPolicy } from '@nocobase/db';
import type { Access, HylService } from '../hyl/service.js';
import { fail } from '../hyl/service.js';
import type { Row } from '../hyl/schema.js';
import { cents } from '../hyl/calculation.js';
import { CashierService } from '../cashier/service.js';
import type { Receipt, ReceiptEntry } from '../billing/model.js';
import { tax, redTax } from './calculation.js';
import {
  compute,
  refresh,
  fingerprint,
  latestConfig,
  writeInvoice,
  type DraftLine,
} from './engine.js';
import {
  actions,
  type Config,
  type ConfigValues,
  type Source,
  type Invoice,
  type InvoiceLine,
  type IssueValues,
  type RedValues,
  type Expected,
  type ListInput,
} from './model.js';
type Member = {
  id: string;
  invoiceId: string;
  sourceId: string;
  contractId: string;
  billId: string;
};
export class InvoiceService {
  constructor(readonly hyl: HylService) {}
  async prepare(access: Access, ids: string[], names: string[]) {
    const policies = new Map<string, RepositoryPolicy>();
    for (const a of new Set(names))
      policies.set(a, await this.hyl.policy(access, 'contracts', a));
    const rows = new Map<string, Row>();
    for (const id of new Set(ids))
      for (const [action, policy] of policies)
        rows.set(
          id,
          await this.hyl.get(
            access,
            'contracts',
            id,
            action,
            undefined,
            policy,
          ),
        );
    return { policies, rows };
  }
  async allowed(access: Access, ids: string[]) {
    const result: string[] = [];
    for (const a of actions) {
      try {
        await this.prepare(
          access,
          ids,
          a === 'invoiceConfigure' ? [a, 'read'] : [a, 'read', 'billingRead'],
        );
        result.push(a);
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
      }
    }
    return result;
  }
  async source(
    access: Access,
    id: string,
    action = 'invoiceRead',
    c = this.hyl.db.connection(),
  ) {
    const row = await c
      .repository<Source>('hylInvoiceSources')
      .findOne({ filter: { id } });
    if (!row) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    await this.prepare(
      access,
      [row.contractId],
      [action, 'invoiceRead', 'read', 'billingRead'],
    );
    return row;
  }
  async invoice(access: Access, id: string, action = 'invoiceRead') {
    const row = await this.hyl.db
      .repository<Invoice>('hylInvoices')
      .findOne({ filter: { id } });
    if (!row) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    const members = await this.hyl.db
      .repository<Member>('hylInvoiceMembers')
      .findMany({ filter: { invoiceId: id } });
    if (!members.length) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    await this.prepare(
      access,
      members.map((m) => m.contractId),
      [action, 'invoiceRead', 'read', 'billingRead'],
    );
    return { row, members };
  }
  async atomic<T>(
    access: Access,
    ids: string[],
    action: string,
    input: { requestId: string },
    intent: unknown,
    fn: (c: DatabaseConnection) => Promise<T>,
  ) {
    const prepared = await this.prepare(
        access,
        ids,
        action === 'invoiceConfigure'
          ? [action, 'read']
          : [action, 'invoiceRead', 'read', 'billingRead'],
      ),
      merchants = new Set([...prepared.rows.values()].map((r) => r.merchantId));
    if (merchants.size !== 1) fail('INVOICE_INCOMPATIBLE');
    const hash = fingerprint({ actor: access.actor, intent });
    return this.hyl.db.transaction(async (c) => {
      await this.hyl.lockMerchant(c, [...merchants][0]);
      for (const id of ids)
        for (const [a, p] of prepared.policies)
          await this.hyl.get(access, 'contracts', id, a, c, p);
      const old = await c
        .repository<{
          id: string;
          actor: string;
          hash: string;
          payload: { result: T };
        }>('hylInvoiceOperations')
        .findOne({ filter: { id: input.requestId } });
      if (old) {
        if (old.actor !== access.actor || old.hash !== hash)
          fail('IDEMPOTENCY_CONFLICT', 'ABORTED');
        return old.payload.result;
      }
      const result = await fn(c);
      await c.repository('hylInvoiceOperations').createOne({
        values: {
          id: input.requestId,
          actor: access.actor,
          hash,
          payload: { result },
          createdAt: new Date().toISOString(),
        },
      });
      return result;
    });
  }
  async configuration(access: Access, id: string) {
    try {
      await this.prepare(access, [id], ['invoiceRead', 'read']);
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      await this.prepare(access, [id], ['invoiceConfigure', 'read']);
    }
    const c = this.hyl.db.connection(),
      row = await c.repository<Row>('hylContracts').findOne({ filter: { id } }),
      merchant = await c
        .repository<Row>('hylMerchants')
        .findOne({ filter: { id: row!.merchantId } });
    return {
      config: await latestConfig(c, id),
      contract: row,
      merchant: {
        name: merchant?.name,
        creditCode: merchant?.payload.creditCode ?? '',
      },
      allowedActions: await this.allowed(access, [id]),
    };
  }
  async previewConfig(access: Access, id: string, values: ConfigValues) {
    await this.prepare(
      access,
      [id],
      [
        'invoiceConfigure',
        'read',
        ...(values.autoIssue ? ['invoiceIssue'] : []),
      ],
    );
    if (values.seller.type !== 'company' || !values.seller.taxNo)
      fail('INVOICE_PARTIES', 'INVALID_ARGUMENT');
    return {
      expectedConfigVersion:
        (await latestConfig(this.hyl.db.connection(), id))?.version ?? 0,
      sample: values.fees.map((f) => ({
        feeType: f.feeType,
        ...tax(10000n, Math.round(Number(f.rate) * 100)),
      })),
    };
  }
  async saveConfig(
    access: Access,
    id: string,
    input: { requestId: string; expectedVersion: number; values: ConfigValues },
  ) {
    await this.previewConfig(access, id, input.values);
    return this.atomic(
      access,
      [id],
      'invoiceConfigure',
      input,
      { config: id, input },
      async (c) => {
        const old = await latestConfig(c, id);
        if ((old?.version ?? 0) !== input.expectedVersion)
          fail('VERSION_CONFLICT', 'ABORTED');
        const contract = (await c
            .repository<Row>('hylContracts')
            .findOne({ filter: { id } }))!,
          merchant = await c
            .repository<Row>('hylMerchants')
            .findOne({ filter: { id: contract.merchantId } }),
          now = new Date().toISOString(),
          row: Config = {
            id: randomUUID(),
            contractId: id,
            merchantId: contract.merchantId,
            version: input.expectedVersion + 1,
            enabled: input.values.enabled,
            autoIssue: input.values.autoIssue,
            payload: input.values,
            actor: access.actor,
            createdAt: now,
            updatedAt: now,
            searchText: [
              contract.number,
              merchant?.name,
              input.values.buyer.name,
              input.values.seller.name,
            ].join(' '),
          };
        await c
          .repository<Config>('hylInvoiceConfigs')
          .createOne({ values: row });
        for (const source of await c
          .repository<Source>('hylInvoiceSources')
          .findMany({ filter: { contractId: id } }))
          await refresh(c, this.hyl, source.billId, access.actor);
        return row;
      },
    );
  }
  async previewBackfill(access: Access, billId: string) {
    const s = await compute(this.hyl.db.connection(), billId);
    await this.prepare(
      access,
      [s.bill.contractId],
      ['invoiceBackfill', 'invoiceRead', 'read', 'billingRead'],
    );
    return { billId, sourceHash: s.sourceHash, status: s.status, ...s.values };
  }
  async backfill(
    access: Access,
    input: {
      requestId: string;
      billId: string;
      sourceHash: string;
      reason: string;
    },
  ) {
    const s = await compute(this.hyl.db.connection(), input.billId);
    return this.atomic(
      access,
      [s.bill.contractId],
      'invoiceBackfill',
      input,
      { backfill: input },
      async (c) => {
        const latest = await compute(c, input.billId);
        if (latest.sourceHash !== input.sourceHash)
          fail('INVOICE_CHANGED', 'ABORTED');
        if (
          await c
            .repository('hylInvoiceSources')
            .exists({ filter: { billId: input.billId } })
        )
          fail('INVOICE_DUPLICATE', 'ALREADY_EXISTS');
        return refresh(c, this.hyl, input.billId, access.actor);
      },
    );
  }
  expected(row: Source, config: Config | undefined): Expected {
    return {
      id: row.id,
      version: row.version,
      sourceHash: row.sourceHash,
      configVersion: config?.version ?? 0,
    };
  }
  checkExpected(actual: Expected[], expected: Expected[]) {
    const sorted = (v: Expected[]) =>
      [...v].sort((a, b) => a.id.localeCompare(b.id));
    if (fingerprint(sorted(actual)) !== fingerprint(sorted(expected)))
      fail('INVOICE_CHANGED', 'ABORTED');
  }
  async assertFresh(
    c: DatabaseConnection,
    expected: Expected[],
    ids: string[],
  ) {
    if (
      new Set(expected.map((e) => e.id)).size !== expected.length ||
      [...new Set(ids)].sort().join(',') !==
        expected
          .map((e) => e.id)
          .sort()
          .join(',')
    )
      fail('INVOICE_CHANGED', 'ABORTED');
    const actual: Expected[] = [];
    for (const id of ids) {
      const row = await c
        .repository<Source>('hylInvoiceSources')
        .findOne({ filter: { id } });
      if (!row) fail('INVOICE_CHANGED', 'ABORTED');
      actual.push(this.expected(row, await latestConfig(c, row.contractId)));
    }
    this.checkExpected(actual, expected);
  }
  async draftIssue(c: DatabaseConnection, input: IssueValues) {
    const sourceIds = input.sources.map((s) => s.sourceId);
    if (new Set(sourceIds).size !== sourceIds.length)
      fail('INVALID_INPUT', 'INVALID_ARGUMENT');
    const expectedSources: Expected[] = [],
      lines: DraftLine[] = [],
      authorizers: string[] = [];
    let config: Config | undefined,
      merchantId = '';
    for (const selection of input.sources) {
      const source = await c
        .repository<Source>('hylInvoiceSources')
        .findOne({ filter: { id: selection.sourceId } });
      if (!source) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
      const latest = await compute(c, source.billId),
        cfg = latest.config;
      if (!cfg?.enabled) fail('INVOICE_CONFIG_REQUIRED');
      if (latest.sourceHash !== source.sourceHash)
        fail('INVOICE_CHANGED', 'ABORTED');
      if (BigInt(latest.values.requiredRedCents) > 0n)
        fail('INVOICE_RED_REQUIRED');
      if (merchantId && merchantId !== source.merchantId)
        fail('INVOICE_INCOMPATIBLE');
      merchantId = source.merchantId;
      if (
        config &&
        fingerprint({
          buyer: config.payload.buyer,
          seller: config.payload.seller,
          fees: [...config.payload.fees].sort((a, b) =>
            a.feeType.localeCompare(b.feeType),
          ),
        }) !==
          fingerprint({
            buyer: cfg.payload.buyer,
            seller: cfg.payload.seller,
            fees: [...cfg.payload.fees].sort((a, b) =>
              a.feeType.localeCompare(b.feeType),
            ),
          })
      )
        fail('INVOICE_INCOMPATIBLE');
      config = cfg;
      authorizers.push(cfg.actor);
      expectedSources.push(this.expected(source, cfg));
      if (
        new Set(selection.amounts.map((l) => l.billLineId)).size !==
        selection.amounts.length
      )
        fail('INVALID_INPUT', 'INVALID_ARGUMENT');
      for (const selectionLine of selection.amounts) {
        const gross = cents(selectionLine.gross);
        if (gross === 0n) continue;
        const line = latest.lines.find(
            (l) => l.id === selectionLine.billLineId,
          ),
          fee = cfg.payload.fees.find((f) => f.feeType === line?.feeType);
        if (!line || !fee || gross <= 0n || gross > BigInt(line.availableCents))
          fail('INVOICE_LIMIT');
        const rateBps = Math.round(Number(fee.rate) * 100);
        lines.push({
          originalLineId: null,
          sourceId: source.id,
          billId: source.billId,
          contractId: source.contractId,
          billLineId: line.id,
          feeType: line.feeType,
          ...tax(gross, rateBps),
          rateBps,
          payload: {
            taxItemName: fee.taxItemName,
            code: fee.code,
            configVersion: cfg.version,
            configAuthorizer: cfg.actor,
          },
        });
      }
    }
    if (!config || !lines.length) fail('INVOICE_LIMIT');
    if (input.result === 'failed' && !input.failureReason)
      fail('REASON_REQUIRED', 'INVALID_ARGUMENT');
    const grossCents = String(
        lines.reduce((n, l) => n + BigInt(l.grossCents), 0n),
      ),
      netCents = String(lines.reduce((n, l) => n + BigInt(l.netCents), 0n));
    const draft = {
      merchantId,
      buyer: config.payload.buyer,
      seller: config.payload.seller,
      lines,
      expectedSources,
      authorizers,
      grossCents,
      netCents,
      taxCents: String(BigInt(grossCents) - BigInt(netCents)),
    };
    return { ...draft, previewHash: fingerprint({ input, draft }) };
  }
  async previewIssue(access: Access, input: IssueValues) {
    const ids: string[] = [];
    for (const s of input.sources)
      ids.push(
        (await this.source(access, s.sourceId, 'invoiceIssue')).contractId,
      );
    await this.prepare(access, ids, [
      'invoiceIssue',
      'invoiceRead',
      'read',
      'billingRead',
    ]);
    return this.draftIssue(this.hyl.db.connection(), input);
  }
  async issue(
    access: Access,
    input: IssueValues & {
      requestId: string;
      expectedSources: Expected[];
      previewHash: string;
    },
  ) {
    const ids: string[] = [];
    for (const s of input.sources)
      ids.push(
        (await this.source(access, s.sourceId, 'invoiceIssue')).contractId,
      );
    return this.atomic(
      access,
      ids,
      'invoiceIssue',
      input,
      { issue: input },
      async (c) => {
        const {
          requestId: _,
          expectedSources: __,
          previewHash: ___,
          ...values
        } = input;
        await this.assertFresh(
          c,
          input.expectedSources,
          input.sources.map((s) => s.sourceId),
        );
        const draft = await this.draftIssue(c, values);
        this.checkExpected(draft.expectedSources, input.expectedSources);
        if (draft.previewHash !== input.previewHash)
          fail('INVOICE_CHANGED', 'ABORTED');
        if (input.result === 'failed') {
          for (const selection of input.sources) {
            const selectedLines = draft.lines.filter(
              (l) => l.sourceId === selection.sourceId,
            );
            await this.attempt(
              c,
              input.requestId,
              'blue',
              draft.merchantId,
              String(
                selectedLines.reduce((n, l) => n + BigInt(l.grossCents), 0n),
              ),
              {
                selection,
                result: input.result,
                failureReason: input.failureReason,
                notes: input.notes,
              },
              null,
              selection.sourceId,
              access.actor,
            );
          }
          return { outcome: 'failed', invoice: null };
        }
        const invoice = await writeInvoice(c, this.hyl, {
          ...draft,
          kind: 'blue',
          actor: access.actor,
          mode: 'manualSimulation',
          notes: input.notes,
        });
        return { outcome: 'success', invoice };
      },
    );
  }
  async draftRed(c: DatabaseConnection, id: string, input: RedValues) {
    const original = await c
      .repository<Invoice>('hylInvoices')
      .findOne({ filter: { id } });
    if (!original || original.kind !== 'blue') fail('INVOICE_LIMIT');
    const originalLines = await c
        .repository<InvoiceLine>('hylInvoiceLines')
        .findMany({ filter: { invoiceId: id } }),
      lines: DraftLine[] = [],
      expectedSources: Expected[] = [],
      gaps = new Map<string, bigint>();
    if (
      new Set(input.lines.map((l) => l.originalLineId)).size !==
      input.lines.length
    )
      fail('INVALID_INPUT', 'INVALID_ARGUMENT');
    for (const selection of input.lines) {
      const gross = cents(selection.gross);
      if (!gross) continue;
      const l = originalLines.find((l) => l.id === selection.originalLineId);
      if (!l) fail('INVOICE_LIMIT');
      const credits = await c
          .repository<InvoiceLine>('hylInvoiceLines')
          .findMany({ filter: { originalLineId: l.id } }),
        previous = {
          gross: credits.reduce((n, r) => n + BigInt(r.grossCents), 0n),
          net: credits.reduce((n, r) => n + BigInt(r.netCents), 0n),
        };
      if (gross <= 0n || gross > BigInt(l.grossCents) - previous.gross)
        fail('INVOICE_LIMIT');
      const source = (await c
          .repository<Source>('hylInvoiceSources')
          .findOne({ filter: { id: l.sourceId } }))!,
        latest = await compute(c, l.billId);
      if (latest.sourceHash !== source.sourceHash)
        fail('INVOICE_CHANGED', 'ABORTED');
      const sourceLine = latest.lines.find((r) => r.id === l.billLineId);
      if (!sourceLine) fail('INVOICE_LIMIT');
      const key = l.sourceId + ':' + l.billLineId,
        used = gaps.get(key) ?? 0n;
      if (
        input.reasonCode === 'refund' &&
        gross + used > BigInt(sourceLine.requiredRedCents)
      )
        fail('INVOICE_LIMIT');
      gaps.set(key, used + gross);
      if (!expectedSources.some((r) => r.id === source.id))
        expectedSources.push(this.expected(source, latest.config));
      const { id: _, invoiceId: __, ...rest } = l;
      lines.push({
        ...rest,
        originalLineId: l.id,
        ...redTax(gross, l, previous),
      });
    }
    if (!lines.length) fail('INVOICE_LIMIT');
    if (input.result === 'failed' && !input.failureReason)
      fail('REASON_REQUIRED', 'INVALID_ARGUMENT');
    const grossCents = String(
        lines.reduce((n, l) => n + BigInt(l.grossCents), 0n),
      ),
      netCents = String(lines.reduce((n, l) => n + BigInt(l.netCents), 0n)),
      draft = {
        original,
        lines,
        expectedSources,
        grossCents,
        netCents,
        taxCents: String(BigInt(grossCents) - BigInt(netCents)),
      };
    return { ...draft, previewHash: fingerprint({ input, draft }) };
  }
  async previewRed(access: Access, id: string, input: RedValues) {
    await this.invoice(access, id, 'invoiceRed');
    return this.draftRed(this.hyl.db.connection(), id, input);
  }
  async red(
    access: Access,
    id: string,
    input: RedValues & {
      requestId: string;
      expectedVersion: number;
      expectedSources: Expected[];
      previewHash: string;
    },
  ) {
    const { members } = await this.invoice(access, id, 'invoiceRed');
    return this.atomic(
      access,
      members.map((m) => m.contractId),
      'invoiceRed',
      input,
      { red: id, input },
      async (c) => {
        const {
            requestId: _,
            expectedVersion: __,
            expectedSources: ___,
            previewHash: ____,
            ...values
          } = input,
          original = await c
            .repository<Invoice>('hylInvoices')
            .findOne({ filter: { id } });
        if (!original || original.version !== input.expectedVersion)
          fail('VERSION_CONFLICT', 'ABORTED');
        await this.assertFresh(
          c,
          input.expectedSources,
          input.expectedSources.map((s) => s.id),
        );
        const draft = await this.draftRed(c, id, values);
        if (draft.original.version !== input.expectedVersion)
          fail('VERSION_CONFLICT', 'ABORTED');
        this.checkExpected(draft.expectedSources, input.expectedSources);
        if (draft.previewHash !== input.previewHash)
          fail('INVOICE_CHANGED', 'ABORTED');
        if (input.result === 'failed') {
          await this.attempt(
            c,
            input.requestId,
            'red',
            draft.original.merchantId,
            draft.grossCents,
            input,
            id,
            null,
            access.actor,
          );
          return { outcome: 'failed', invoice: null };
        }
        const invoice = await writeInvoice(c, this.hyl, {
          merchantId: draft.original.merchantId,
          kind: 'red',
          original: draft.original,
          buyer: draft.original.payload.buyer,
          seller: draft.original.payload.seller,
          lines: draft.lines,
          actor: access.actor,
          mode: 'manualSimulation',
          notes: input.notes,
          reason: input.reason,
          evidence: input.evidence,
          reasonCode: input.reasonCode,
          authorizers: draft.original.payload.configAuthorizers,
        });
        return { outcome: 'success', invoice };
      },
    );
  }
  async attempt(
    c: DatabaseConnection,
    operationId: string,
    kind: string,
    merchantId: string,
    grossCents: string,
    input: unknown,
    parentInvoiceId: string | null,
    sourceId: string | null,
    actor: string,
  ) {
    await c.repository('hylInvoiceAttempts').createOne({
      values: {
        id: randomUUID(),
        operationId,
        kind,
        merchantId,
        grossCents,
        status: 'failed',
        parentInvoiceId,
        sourceId,
        payload: { input, actor },
        createdAt: new Date().toISOString(),
      },
    });
  }
  async scopeBills(access: Access, input: ListInput) {
    const c = this.hyl.db.connection();
    let ids: Set<string> | undefined;
    if (input.billId) ids = new Set([input.billId]);
    if (input.receiptId) {
      const r = await c
        .repository<Receipt>('hylReceipts')
        .findOne({ filter: { id: input.receiptId } });
      if (!r) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
      await this.prepare(
        access,
        [r.contractId],
        ['receiptRead', 'billingRead', 'invoiceRead'],
      );
      ids = new Set(
        (
          await c
            .repository<ReceiptEntry>('hylReceiptEntries')
            .findMany({ filter: { receiptId: r.id } })
        )
          .map((e) => e.billId)
          .filter((id): id is string => !!id),
      );
    }
    for (const [id, kind] of [
      [input.cashierOrderId, 'orders'],
      [input.cashierRefundId, 'refunds'],
    ] as const)
      if (id) {
        const cashier = new CashierService(this.hyl);
        await cashier.guard(access, kind, id);
        ids = new Set(
          (await cashier.members(id))
            .filter((m) => m.kind === 'bill')
            .map((m) => m.sourceId),
        );
      }
    return ids;
  }
  async list(
    access: Access,
    kind: 'sources' | 'invoices' | 'configs',
    input: ListInput,
  ) {
    const c = this.hyl.db.connection(),
      policy = await this.hyl.policy(access, 'contracts', 'invoiceRead'),
      contracts = await c
        .repository<Row>('hylContracts')
        .withPolicy(policy)
        .findMany(),
      visible = new Set<string>();
    for (const contract of contracts)
      try {
        await this.prepare(
          access,
          [String(contract.id)],
          ['invoiceRead', 'read', 'billingRead'],
        );
        visible.add(String(contract.id));
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
      }
    const table =
        kind === 'sources'
          ? 'hylInvoiceSources'
          : kind === 'configs'
            ? 'hylInvoiceConfigs'
            : 'hylInvoices',
      members =
        kind === 'invoices'
          ? await c.repository<Member>('hylInvoiceMembers').findMany()
          : [],
      bills = await this.scopeBills(access, input),
      rows = await c.repository<Source & Config & Invoice>(table).findMany();
    const ids: string[] = [];
    for (const r of rows) {
      const own =
        kind === 'invoices'
          ? members.filter((m) => m.invoiceId === r.id)
          : [{ contractId: r.contractId, billId: r.billId, sourceId: r.id }];
      if (!own.length || own.some((m) => !visible.has(m.contractId))) continue;
      if (
        input.contractId &&
        !own.some((m) => m.contractId === input.contractId)
      )
        continue;
      if (bills && !own.some((m) => bills.has(m.billId))) continue;
      if (input.sourceId && !own.some((m) => m.sourceId === input.sourceId))
        continue;
      if (input.merchantId && r.merchantId !== input.merchantId) continue;
      const day = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
      }).format(new Date(r.createdAt));
      if ((input.from && day < input.from) || (input.to && day > input.to))
        continue;
      ids.push(r.id);
    }
    const col = input.orderBy.replace(/^-/, '');
    const sortable =
      kind === 'sources'
        ? [
            'updatedAt',
            'createdAt',
            'paidCents',
            'netIssuedCents',
            'availableCents',
            'requiredRedCents',
          ]
        : kind === 'configs'
          ? ['updatedAt', 'createdAt', 'version']
          : [
              'issuedAt',
              'updatedAt',
              'grossCents',
              'netCents',
              'taxCents',
              'redGrossCents',
            ];
    if (!sortable.includes(col)) fail('INVALID_INPUT', 'INVALID_ARGUMENT');
    const filter = buildFilter((f) =>
      f.and([
        ids.length
          ? f.or(ids.map((id) => f.string('id').eq(id)))
          : f.string('id').eq('__none__'),
        ...(input.q
          ? [
              f.or([
                f.string('searchText').includes(input.q),
                ...(kind !== 'configs'
                  ? [f.string('number').includes(input.q)]
                  : []),
              ]),
            ]
          : []),
        ...(input.status && kind !== 'configs'
          ? [f.string('status').eq(input.status)]
          : []),
        ...(input.kind && kind === 'invoices'
          ? [f.string('kind').eq(input.kind)]
          : []),
        ...(input.enabled && kind === 'configs'
          ? [
              input.enabled === 'true'
                ? f.boolean('enabled').isTrue()
                : f.boolean('enabled').isFalse(),
            ]
          : []),
      ]),
    );
    const repo = c.repository<Source & Config & Invoice>(table),
      data = await repo.findMany({
        filter,
        limit: input.pageSize,
        offset: (input.page - 1) * input.pageSize,
        sort: (s) => [
          input.orderBy.startsWith('-')
            ? s.field(col).desc()
            : s.field(col).asc(),
          s.field('id').asc(),
        ],
      });
    return {
      data: await Promise.all(
        data.map(async (r) => ({
          ...r,
          merchantName:
            (
              await c
                .repository<Row>('hylMerchants')
                .findOne({ filter: { id: r.merchantId } })
            )?.name ?? '',
          contractNumber:
            kind === 'configs'
              ? (
                  await c
                    .repository<Row>('hylContracts')
                    .findOne({ filter: { id: r.contractId } })
                )?.number
              : undefined,
          allowedActions: await this.allowed(
            access,
            kind === 'invoices'
              ? members
                  .filter((m) => m.invoiceId === r.id)
                  .map((m) => m.contractId)
              : [r.contractId],
          ),
        })),
      ),
      meta: {
        page: input.page,
        pageSize: input.pageSize,
        total: await repo.count({ filter }),
      },
    };
  }
  async children(
    c: DatabaseConnection,
    table: string,
    filter: Record<string, string>,
    key: string,
    pages: Record<string, string | number>,
  ) {
    const page = Number(pages[key] ?? 1),
      order = String(pages[key + 'Order'] ?? '-createdAt'),
      col = order.replace(/^-/, '');
    const sortable: Record<string, string[]> = {
      hylInvoiceConfigs: ['createdAt', 'version'],
      hylInvoiceSourceRevisions: [
        'createdAt',
        'revision',
        'paidCents',
        'netIssuedCents',
        'availableCents',
        'requiredRedCents',
      ],
      hylInvoiceAttempts: ['createdAt', 'grossCents'],
      hylInvoices: ['createdAt', 'issuedAt', 'grossCents'],
    };
    if (!sortable[table]?.includes(col))
      fail('INVALID_INPUT', 'INVALID_ARGUMENT');
    const repo = c.repository(table);
    return {
      data: await repo.findMany({
        filter,
        limit: 20,
        offset: (page - 1) * 20,
        sort: (s) => [
          order.startsWith('-') ? s.field(col).desc() : s.field(col).asc(),
          s.field('id').asc(),
        ],
      }),
      meta: { page, pageSize: 20, total: await repo.count({ filter }) },
    };
  }
  async detail(
    access: Access,
    kind: 'sources' | 'invoices' | 'configs',
    id: string,
    pages: Record<string, string | number> = {},
  ) {
    const c = this.hyl.db.connection();
    if (kind === 'configs') {
      const row = await c
        .repository<Config>('hylInvoiceConfigs')
        .findOne({ filter: { id } });
      if (!row) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
      await this.prepare(access, [row.contractId], ['invoiceRead', 'read']);
      return {
        ...row,
        sample: row.payload.fees.map((f) => ({
          feeType: f.feeType,
          ...tax(10000n, Math.round(Number(f.rate) * 100)),
        })),
        allowedActions: await this.allowed(access, [row.contractId]),
        history: await this.children(
          c,
          'hylInvoiceConfigs',
          { contractId: row.contractId },
          'history',
          pages,
        ),
      };
    }
    if (kind === 'invoices') {
      const { row, members } = await this.invoice(access, id),
        lines = await c
          .repository<InvoiceLine>('hylInvoiceLines')
          .findMany({ filter: { invoiceId: id } }),
        credits = lines.length
          ? await c.repository<InvoiceLine>('hylInvoiceLines').findMany({
              filter: buildFilter((f) =>
                f.or(lines.map((l) => f.string('originalLineId').eq(l.id))),
              ),
            })
          : [],
        sources = await c.repository<Source>('hylInvoiceSources').findMany({
          filter: buildFilter((f) =>
            f.or(members.map((m) => f.string('id').eq(m.sourceId))),
          ),
        });
      return {
        ...row,
        allowedActions: await this.allowed(
          access,
          members.map((m) => m.contractId),
        ),
        lines: memoryPage(
          lines.map((l) => ({
            ...l,
            ...l.payload,
            billNumber:
              sources.find((s) => s.id === l.sourceId)?.payload.billNumber ??
              l.billId,
            sourceNumber:
              sources.find((s) => s.id === l.sourceId)?.number ?? l.sourceId,
            rate: String(l.rateBps / 100) + '%',
            requiredRedCents:
              sources
                .find((s) => s.id === l.sourceId)
                ?.payload.lines.find((r) => r.id === l.billLineId)
                ?.requiredRedCents ?? '0',
            remainingCents: String(
              BigInt(l.grossCents) -
                credits
                  .filter((r) => r.originalLineId === l.id)
                  .reduce((n, r) => n + BigInt(r.grossCents), 0n),
            ),
          })),
          pages,
          'lines',
        ),
        members: memoryPage(
          members.map((m) => ({
            ...m,
            billNumber:
              sources.find((s) => s.id === m.sourceId)?.payload.billNumber ??
              m.billId,
          })),
          pages,
          'members',
        ),
        credits: await this.children(
          c,
          'hylInvoices',
          { originalInvoiceId: id },
          'credits',
          pages,
        ),
        attempts: await this.children(
          c,
          'hylInvoiceAttempts',
          { parentInvoiceId: id },
          'attempts',
          pages,
        ),
      };
    }
    const row = await this.source(access, id),
      computed = await compute(c, row.billId),
      members = await c
        .repository<Member>('hylInvoiceMembers')
        .findMany({ filter: { sourceId: id } }),
      visibleInvoices: Invoice[] = [];
    for (const member of members)
      try {
        visibleInvoices.push(
          (await this.invoice(access, member.invoiceId)).row,
        );
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
      }
    let cash: unknown[] = [],
      deposits: unknown[] = [];
    let cashRestricted = true,
      depositsRestricted = true;
    try {
      await this.prepare(access, [row.contractId], ['receiptRead']);
      cashRestricted = false;
      cash = await Promise.all(
        computed.cash.map(async (e) => ({
          id: e.id,
          receiptId: e.receiptId,
          number:
            (
              await c
                .repository<Receipt>('hylReceipts')
                .findOne({ filter: { id: e.receiptId } })
            )?.number ?? e.receiptId,
          amountCents: e.amountCents,
          createdAt: e.createdAt,
        })),
      );
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
    }
    try {
      await this.prepare(access, [row.contractId], ['depositRead']);
      depositsRestricted = false;
      deposits = computed.deposits.map((e) => ({
        id: e.id,
        amountCents: e.amountCents,
        createdAt: e.createdAt,
      }));
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
    }
    const revisions = await this.children(
      c,
      'hylInvoiceSourceRevisions',
      { sourceId: id },
      'history',
      pages,
    );
    return {
      ...row,
      config: computed.config,
      allowedActions: await this.allowed(access, [row.contractId]),
      payload: { ...row.payload, lines: undefined },
      lines: memoryPage(
        row.payload.lines.map((l) => ({
          ...l,
          included:
            l.included ??
            (!!computed.config?.enabled &&
              computed.config.payload.fees.some(
                (f) => f.feeType === l.feeType,
              )),
        })),
        pages,
        'lines',
      ),
      cash: { ...memoryPage(cash, pages, 'cash'), restricted: cashRestricted },
      deposits: {
        ...memoryPage(deposits, pages, 'deposits'),
        restricted: depositsRestricted,
      },
      invoices: memoryPage(visibleInvoices, pages, 'invoices'),
      history: {
        ...revisions,
        data: revisions.data.map((r) => ({
          id: r.id,
          revision: r.revision,
          createdAt: r.createdAt,
          paidCents: r.paidCents,
          netIssuedCents: r.netIssuedCents,
          requiredRedCents: r.requiredRedCents,
        })),
      },
      attempts: await this.children(
        c,
        'hylInvoiceAttempts',
        { sourceId: id },
        'attempts',
        pages,
      ),
    };
  }
}
function memoryPage<T>(
  rows: T[],
  pages: Record<string, string | number>,
  key: string,
) {
  const page = Number(pages[key] ?? 1),
    order = String(pages[key + 'Order'] ?? 'id'),
    col = order.replace(/^-/, '');
  if (
    ![
      'id',
      'grossCents',
      'createdAt',
      'issuedAt',
      'paidCents',
      'netIssuedCents',
      'availableCents',
      'requiredRedCents',
      'netCents',
      'taxCents',
      'remainingCents',
      'amountCents',
    ].includes(col)
  )
    fail('INVALID_INPUT', 'INVALID_ARGUMENT');
  const value = (r: T) => {
    const v = (r as Record<string, unknown>)[col];
    return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
  };
  const ordered = [...rows].sort((a, b) => {
    const x = value(a),
      y = value(b);
    return (
      (col.endsWith('Cents')
        ? BigInt(x || '0') < BigInt(y || '0')
          ? -1
          : BigInt(x || '0') > BigInt(y || '0')
            ? 1
            : 0
        : x.localeCompare(y)) * (order.startsWith('-') ? -1 : 1) ||
      String((a as { id: string }).id).localeCompare(
        String((b as { id: string }).id),
      )
    );
  });
  return {
    data: ordered.slice((page - 1) * 20, page * 20),
    meta: { page, pageSize: 20, total: rows.length },
  };
}
