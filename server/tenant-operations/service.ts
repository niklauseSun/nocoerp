import { randomUUID, createHash } from 'node:crypto';
import type { Access, HylService } from '../hyl/service.js';
import { fail } from '../hyl/service.js';
import { tables, type Row } from '../hyl/schema.js';
import { getLease, effectiveEnd } from '../leases/model.js';
import { assetPolicy } from '../providers/assets.js';
import type { Asset, Binding } from '../assets/schema.js';
import type { Bill } from '../billing/model.js';
import { FinanceService } from '../finance/service.js';
import { querySchema as financeQuery } from '../finance/model.js';
import { businessMonth } from '../hyl/dashboard.js';
import { dayOf } from '../cashier/reports.js';
import {
  reportingRows,
  businessRows,
  ageBucket,
  candidates,
  differences,
  signedCents,
} from './projections.js';
import type { Query, Item, Followup, BankRow, Match } from './model.js';
import type { z } from 'zod';
import type {
  followupSchema,
  importSchema,
  matchSchema,
  matchBatchSchema,
  resolutionSchema,
  BankResolution,
} from './model.js';
import { normalizeBankCsv, type previewImportSchema } from './bank-import.js';
export class TenantOperations {
  constructor(readonly hyl: HylService) {}
  async records(access: Access, kind: keyof typeof tables) {
    const policy = await this.hyl.policy(access, kind, 'read');
    return (await this.hyl.db
      .repository<Row>(tables[kind])
      .withPolicy(policy)
      .findMany()) as Row[];
  }
  async cash(access: Access, month: string, reconciliation = false) {
    const result = await new FinanceService(this.hyl).snapshot(
      access,
      financeQuery.parse({
        from: reconciliation ? '1900-01-01' : month + '-01',
        to: reconciliation
          ? '9999-12-31'
          : month +
            '-' +
            String(
              new Date(
                Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
              ).getUTCDate(),
            ),
      }),
    );
    // Financial reporting uses registration dates; external matching uses the actual business date.
    // Fetch the authorized ledger before filtering, so backdated entries remain matchable.
    if (reconciliation)
      result.lines.cash = result.lines.cash.filter((e) =>
        e.date.startsWith(month),
      );
    return result;
  }
  async source(access: Access, kind: string, id: string, write = false) {
    if (kind === 'bank') {
      const row = await this.hyl.db
        .repository<BankRow>('hylBankRows')
        .findOne({ filter: { id, actor: access.actor } });
      if (!row) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
      await this.cash(access, row.date.slice(0, 7), true);
      if (
        write &&
        (
          await access.authorization.authorize({
            resource: { type: 'settings', id: 'hyl.externalReconciliation' },
            action: 'write',
          })
        ).effect !== 'permit'
      )
        fail('ACCESS_DENIED', 'PERMISSION_DENIED');
      return {
        name: row.externalId,
        date: row.date,
        amountCents: row.amountCents,
      };
    }
    if (kind === 'bill') {
      const row = await this.hyl.db
        .repository<Bill>('hylBills')
        .findOne({ filter: { id } });
      if (!row) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
      await this.hyl.get(access, 'contracts', row.contractId, 'billingRead');
      if (write)
        await this.hyl.get(access, 'contracts', row.contractId, 'billWrite');
      return {
        name: row.number,
        date: row.dueDate,
        amountCents: row.remainingCents,
      };
    }
    if (kind !== 'contracts' && kind !== 'settlements')
      fail('INVALID_ARGUMENT', 'INVALID_ARGUMENT');
    const row = await this.hyl.get(access, kind, id);
    if (write)
      await this.hyl.get(
        access,
        kind,
        id,
        kind === 'contracts' ? 'write' : 'review',
      );
    return { name: row.number, date: row.date, amountCents: row.amountCents };
  }
  async followups(access: Access, kind: string, id: string) {
    const source = await this.source(access, kind, id);
    const data = await this.hyl.db
      .repository<Followup>('hylOperationFollowups')
      .findMany({
        filter: { kind, sourceId: id },
        sort: (s) => [s.field('createdAt').desc()],
      });
    let canWrite = false;
    try {
      await this.source(access, kind, id, true);
      canWrite = true;
    } catch {
      /* Source remains read-only. */
    }
    return { source, items: data, canWrite };
  }
  async followup(access: Access, v: z.infer<typeof followupSchema>) {
    await this.source(access, v.kind, v.sourceId, true);
    const repo = this.hyl.db.repository<Followup>('hylOperationFollowups'),
      existing = await repo.findOne({ filter: { id: v.requestId } });
    if (existing) {
      if (
        existing.actor !== access.actor ||
        existing.kind !== v.kind ||
        existing.sourceId !== v.sourceId ||
        existing.note !== v.note ||
        existing.nextDate !== v.nextDate
      )
        fail('REQUEST_CONFLICT', 'ALREADY_EXISTS');
      return existing;
    }
    const created = await repo.createOne({
      values: {
        id: v.requestId,
        kind: v.kind,
        sourceId: v.sourceId,
        note: v.note,
        nextDate: v.nextDate,
        actor: access.actor,
        createdAt: new Date().toISOString(),
      },
    });
    return created.record;
  }
  async rows(access: Access, input: Query) {
    const month = input.month ?? businessMonth(new Date()),
      today = dayOf(new Date().toISOString());
    let items: Item[] = [];
    const summary: Record<string, string> = {};
    if (input.view === 'reporting' || input.view === 'business') {
      const merchants = await this.records(access, 'merchants'),
        reports = await this.records(access, 'revenueReports');
      if (input.view === 'reporting') {
        const contracts = await this.records(access, 'contracts'),
          effective = [];
        for (const row of contracts) {
          const lease = await getLease(this.hyl.db.connection(), row);
          if (lease.status === 'draft') continue;
          effective.push({
            ...row,
            end: await effectiveEnd(this.hyl.db.connection(), row),
          });
        }
        items = reportingRows(merchants, effective, reports, month, today);
        summary.expected = String(items.length);
        summary.missing = String(
          items.filter((i) => i.status === 'missing').length,
        );
        summary.pending = String(
          items.filter((i) => i.status !== 'missing' && i.status !== 'approved')
            .length,
        );
      } else {
        items = businessRows(merchants, reports, month);
        summary.revenueCents = String(
          items.reduce((s, r) => s + BigInt(r.amountCents), 0n),
        );
        summary.merchants = String(
          new Set(items.map((i) => i.id.split(':')[0])).size,
        );
        if (input.group !== 'daily') {
          const grouped = new Map<string, Item>();
          const groupedMerchants = new Set<string>();
          let projectFor: (item: Item) => string = () => '';
          const projectNames = new Map<string, string>();
          if (input.group === 'project') {
            const ap = await assetPolicy(access, 'read'),
              assets = (await this.hyl.db
                .repository<Asset>('hylAssets')
                .withPolicy(ap)
                .findMany()) as Asset[],
              allowed = new Set(assets.map((a) => a.id)),
              contracts = await this.records(access, 'contracts'),
              bindings = await this.hyl.db
                .repository<{
                  contractId: string;
                  assetId: string;
                  snapshot: Record<string, string>;
                }>('hylContractAssets')
                .findMany();
            for (const a of assets)
              if (a.type === 'project') projectNames.set(a.id, a.name);
            const ends = new Map<string, string>();
            for (const row of contracts)
              ends.set(
                row.id,
                await effectiveEnd(this.hyl.db.connection(), row),
              );
            projectFor = (item) => {
              const contract = contracts.find(
                (c) =>
                  c.merchantId === item.id.split(':')[0] &&
                  c.status !== 'draft' &&
                  String(c.payload.start) <= item.date &&
                  (ends.get(c.id) ?? '') >= item.date,
              );
              if (!contract) return '';
              const links = bindings.filter(
                (b) => b.contractId === contract.id,
              );
              if (!links.length || links.some((b) => !allowed.has(b.assetId)))
                return '';
              const ids = [...new Set(links.map((b) => b.snapshot.projectId))];
              return ids.length === 1
                ? projectNames.has(ids[0])
                  ? ids[0]
                  : ''
                : '';
            };
          }
          for (const item of items) {
            const key =
              input.group === 'merchant'
                ? item.id.split(':')[0]
                : input.group === 'channel'
                  ? item.detail
                  : projectFor(item);
            if (!key) continue;
            groupedMerchants.add(item.id.split(':')[0]);
            const previous = grouped.get(key);
            if (previous)
              previous.amountCents = String(
                BigInt(previous.amountCents) + BigInt(item.amountCents),
              );
            else
              grouped.set(key, {
                ...item,
                id: key,
                date: month + '-01',
                name:
                  input.group === 'merchant'
                    ? item.name
                    : input.group === 'project'
                      ? (projectNames.get(key) ?? '')
                      : key,
                detail: input.group,
                path:
                  input.group === 'merchant'
                    ? `/revenueReports?merchantId=${encodeURIComponent(key)}&from=${month}-01&to=${month}-${new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate()}`
                    : '',
              });
          }
          items = [...grouped.values()];
          summary.merchants = String(groupedMerchants.size);
          // Project totals reflect only the intersection with authorized contract and asset sources.
          summary.revenueCents = String(
            items.reduce((s, r) => s + BigInt(r.amountCents), 0n),
          );
        }
        if (input.group !== 'project') {
          try {
            const settlements = await this.records(access, 'settlements'),
              visible = new Set(merchants.map((m) => m.id)),
              fees = new Map<string, bigint>();
            for (const row of settlements.filter(
              (r) =>
                ['payable', 'partial', 'paid', 'settled', 'due'].includes(
                  r.status,
                ) &&
                String(r.payload.start).startsWith(month) &&
                visible.has(r.merchantId),
            )) {
              const value = (row.payload.amounts as Record<string, string>)
                ?.fee;
              if (value)
                fees.set(
                  row.merchantId,
                  (fees.get(row.merchantId) ?? 0n) + signedCents(value),
                );
            }
            summary.feeCents = String(
              [...fees.values()].reduce((a, b) => a + b, 0n),
            );
            if (input.group === 'merchant')
              items = items.map((i) => ({
                ...i,
                feeCents: String(fees.get(i.id) ?? 0n),
              }));
          } catch (error) {
            if (
              !(error instanceof Error) ||
              !('status' in error) ||
              error.status !== 'PERMISSION_DENIED'
            )
              throw error;
          }
        }
      }
    } else if (input.view === 'statements') {
      const settlements = await this.records(access, 'settlements');
      for (const row of settlements.filter((s) =>
        String(s.payload.start).startsWith(month),
      )) {
        const d = await this.hyl.detail(access, 'settlements', row.id);
        items.push({
          id: row.id,
          name: row.number,
          date: row.date,
          status: row.status,
          amountCents: row.amountCents,
          detail: String(
            (d.payload.revenues as unknown[] | undefined)?.length ?? 0,
          ),
          path: '/settlements/' + encodeURIComponent(row.id),
          kind: 'settlements',
          sourceId: row.id,
        });
      }
    } else if (input.view === 'leases') {
      const contracts = await this.records(access, 'contracts');
      for (const row of contracts.filter((r) => r.status !== 'draft')) {
        const lease = await getLease(this.hyl.db.connection(), row),
          end = await effectiveEnd(this.hyl.db.connection(), row);
        if (lease.status === 'closed') continue;
        const days = Math.floor(
          (Date.parse(end + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) /
            86400000,
        );
        if (days > 90 && lease.status === 'active') continue;
        items.push({
          id: row.id,
          name: row.number,
          date: end,
          status:
            lease.status !== 'active'
              ? 'handover'
              : days < 0
                ? 'expired'
                : days <= 30
                  ? 'expire30'
                  : days <= 60
                    ? 'expire60'
                    : 'expire90',
          amountCents: '0',
          detail: row.name,
          path: '/contracts/' + encodeURIComponent(row.id),
          kind: 'contracts',
          sourceId: row.id,
        });
      }
    } else if (input.view === 'vacancy') {
      const policy = await assetPolicy(access, 'read'),
        assets = (await this.hyl.db
          .repository<Asset>('hylAssets')
          .withPolicy(policy)
          .findMany()) as Asset[];
      const bindings = await this.hyl.db
        .repository<Binding>('hylAssetBindings')
        .findMany();
      const units = assets.filter(
        (a) =>
          ['unit', 'stall'].includes(a.type) &&
          a.state === 'normal' &&
          Number(a.lettableArea) > 0,
      );
      const occupied = (id: string) =>
        bindings.some(
          (b) =>
            b.assetId === id && b.start <= today && (!b.end || b.end >= today),
        );
      summary.units = String(units.length);
      summary.occupied = String(units.filter((a) => occupied(a.id)).length);
      summary.vacant = String(units.filter((a) => !occupied(a.id)).length);
      items = units
        .filter((a) => !occupied(a.id))
        .map((a) => ({
          id: a.id,
          name: a.name,
          date: today,
          status: 'vacant',
          amountCents: '0',
          detail: a.number,
          path: '/assets/' + encodeURIComponent(a.id),
          kind: '',
          sourceId: '',
        }));
    } else if (input.view === 'arrears') {
      const snapshot = await this.cash(access, month);
      for (const line of snapshot.lines.receivables.filter(
        (l) => BigInt(l.remainingCents) > 0n,
      )) {
        items.push({
          id: line.id,
          name: line.number,
          date: line.date,
          status: ageBucket(line.date, today),
          amountCents: line.remainingCents,
          detail: line.partyName,
          path: '/financialReports/receivable/' + encodeURIComponent(line.id),
          kind: line.type === 'bill' ? 'bill' : 'contracts',
          sourceId:
            line.type === 'bill'
              ? line.id.replace(/^bill:/, '')
              : line.contractId,
        });
      }
      summary.outstandingCents = String(
        items.reduce((s, r) => s + BigInt(r.amountCents), 0n),
      );
      summary.assessedCents = String(
        snapshot.lines.receivables.reduce(
          (s, r) => s + BigInt(r.amountCents),
          0n,
        ),
      );
      summary.appliedCents = String(
        snapshot.lines.receivables.reduce(
          (s, r) => s + BigInt(r.appliedCents),
          0n,
        ),
      );
      summary.cashAppliedCents = snapshot.summary.cashAppliedCents;
      for (const bucket of ['age30', 'age60', 'age90', 'ageOver90'])
        summary[bucket + 'Cents'] = String(
          items
            .filter((r) => r.status === bucket)
            .reduce((s, r) => s + BigInt(r.amountCents), 0n),
        );
    } else {
      const snapshot = await this.cash(access, month, true),
        events = snapshot.lines.cash;
      const bank = await this.hyl.db
          .repository<BankRow>('hylBankRows')
          .findMany({ filter: { actor: access.actor } }),
        all = await this.hyl.db.repository<Match>('hylBankMatches').findMany();
      for (const row of bank.filter((r) => r.date.startsWith(month))) {
        const match = all.find((m) => m.rowId === row.id),
          event = match && events.find((e) => e.id === match.eventId),
          found = candidates(row, events, all);
        items.push({
          id: row.id,
          name: row.externalId,
          date: row.date,
          status: match
            ? event
              ? 'matched'
              : 'restricted'
            : found.length === 1
              ? 'candidate'
              : found.length > 1
                ? 'ambiguous'
                : differences(row, events).length
                  ? 'difference'
                  : 'unmatched',
          amountCents: row.amountCents,
          detail: row.account + ' / ' + row.reference,
          path: '',
          kind: 'reconciliation',
          sourceId: row.id,
        });
      }
    }
    return {
      month,
      today,
      generatedAt: new Date().toISOString(),
      items,
      summary,
    };
  }
  async selected(access: Access, input: Query) {
    const result = await this.rows(access, input),
      term = input.q.toLocaleLowerCase();
    const rows = result.items.filter(
      (i) =>
        (!input.status || i.status === input.status) &&
        [i.name, i.date, i.detail].join(' ').toLocaleLowerCase().includes(term),
    );
    const desc = input.order.startsWith('-'),
      key = input.order.replace('-', '') as
        'date' | 'name' | 'amountCents' | 'feeCents';
    rows.sort((a, b) => {
      const x = key.endsWith('Cents') ? BigInt(a[key] ?? '0') : (a[key] ?? ''),
        y = key.endsWith('Cents') ? BigInt(b[key] ?? '0') : (b[key] ?? '');
      return (
        (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1) ||
        a.id.localeCompare(b.id)
      );
    });
    return { ...result, items: rows };
  }
  async list(access: Access, input: Query) {
    const result = await this.selected(access, input),
      rows = result.items;
    return {
      data: {
        ...result,
        items: rows.slice(
          (input.page - 1) * input.pageSize,
          input.page * input.pageSize,
        ),
      },
      meta: { total: rows.length, page: input.page, pageSize: input.pageSize },
    };
  }
  async import(access: Access, v: z.infer<typeof importSchema>) {
    // External files remain private to their importing accountant. Source cash scopes are checked again at confirmation.
    await this.cash(access, v.rows[0].date.slice(0, 7));
    const decision = await access.authorization.authorize({
      resource: { type: 'settings', id: 'hyl.externalReconciliation' },
      action: 'write',
    });
    if (decision.effect !== 'permit')
      fail('ACCESS_DENIED', 'PERMISSION_DENIED');
    return this.hyl.db.transaction(async (c) => {
      const repo = c.repository<BankRow>('hylBankRows'),
        old = await repo.findMany({ filter: { batchId: v.requestId } });
      if (old.length) {
        if (
          old[0].actor !== access.actor ||
          old[0].account !== v.account ||
          JSON.stringify(
            [...old]
              .sort((a, b) => a.externalId.localeCompare(b.externalId))
              .map((r) => ({
                externalId: r.externalId,
                date: r.date,
                reference: r.reference,
                amountCents: r.amountCents,
                method: r.method,
              })),
          ) !==
            JSON.stringify(
              [...v.rows].sort((a, b) =>
                a.externalId.localeCompare(b.externalId),
              ),
            )
        )
          fail('REQUEST_CONFLICT', 'ALREADY_EXISTS');
        return old;
      }
      const rows: BankRow[] = [];
      for (const r of v.rows) {
        if (
          await repo.findOne({
            filter: { account: v.account, externalId: r.externalId },
          })
        )
          fail('DUPLICATE_REFERENCE', 'ALREADY_EXISTS');
        rows.push(
          (
            await repo.createOne({
              values: {
                ...r,
                id: randomUUID(),
                account: v.account,
                batchId: v.requestId,
                actor: access.actor,
                createdAt: new Date().toISOString(),
              },
            })
          ).record,
        );
      }
      return rows;
    });
  }
  async previewImport(access: Access, v: z.infer<typeof previewImportSchema>) {
    await this.cash(access, businessMonth(new Date()), true);
    const decision = await access.authorization.authorize({
      resource: { type: 'settings', id: 'hyl.externalReconciliation' },
      action: 'write',
    });
    if (decision.effect !== 'permit')
      fail('ACCESS_DENIED', 'PERMISSION_DENIED');
    try {
      return normalizeBankCsv(v.text, v.mapping);
    } catch {
      fail('CSV_INVALID', 'INVALID_ARGUMENT');
    }
  }
  async matchBatch(access: Access, v: z.infer<typeof matchBatchSchema>) {
    await this.cash(access, businessMonth(new Date()), true);
    const decision = await access.authorization.authorize({
      resource: { type: 'settings', id: 'hyl.externalReconciliation' },
      action: 'write',
    });
    if (decision.effect !== 'permit')
      fail('ACCESS_DENIED', 'PERMISSION_DENIED');
    const results: { rowId: string; status: string; reason: string }[] = [];
    // Every item rechecks original scopes and uniqueness. Partial results are intentional and explicit.
    for (const item of v.items) {
      const digest = createHash('sha256')
        .update(v.requestId + ':' + item.rowId)
        .digest('hex');
      const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
      try {
        const detail = await this.matchDetail(access, item.rowId);
        if (
          detail.match?.id !== id &&
          (detail.candidates.length !== 1 ||
            detail.candidates[0].id !== item.eventId)
        )
          fail('MATCH_INVALID', 'FAILED_PRECONDITION');
        await this.match(access, { ...item, requestId: id, reason: v.reason });
        results.push({ rowId: item.rowId, status: 'matched', reason: '' });
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'reason' in error
            ? String(error.reason)
            : '';
        if (
          ![
            'ACCESS_DENIED',
            'RECORD_NOT_FOUND',
            'MATCH_INVALID',
            'REQUEST_CONFLICT',
            'DUPLICATE_REFERENCE',
          ].includes(code) &&
          !(
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === '23505'
          )
        )
          throw error;
        results.push({
          rowId: item.rowId,
          status: 'failed',
          reason: ['ACCESS_DENIED', 'RECORD_NOT_FOUND'].includes(code)
            ? 'ACCESS_DENIED'
            : 'MATCH_INVALID',
        });
      }
    }
    return results;
  }
  async resolveBank(access: Access, v: z.infer<typeof resolutionSchema>) {
    await this.source(access, 'bank', v.rowId, true);
    const repo = this.hyl.db.repository<BankResolution>('hylBankResolutions');
    const existing = await repo.findOne({ filter: { id: v.requestId } });
    if (existing) {
      if (
        existing.actor !== access.actor ||
        existing.rowId !== v.rowId ||
        existing.conclusion !== v.conclusion ||
        existing.note !== v.note ||
        existing.nextDate !== v.nextDate
      )
        fail('REQUEST_CONFLICT', 'ALREADY_EXISTS');
      return existing;
    }
    // A resolution is audit evidence only: it cannot mark money as received or clear a discrepancy.
    return (
      await repo.createOne({
        values: {
          id: v.requestId,
          rowId: v.rowId,
          conclusion: v.conclusion,
          note: v.note,
          nextDate: v.nextDate,
          actor: access.actor,
          createdAt: new Date().toISOString(),
        },
      })
    ).record;
  }
  async matchDetail(access: Access, id: string) {
    const row = await this.hyl.db
      .repository<BankRow>('hylBankRows')
      .findOne({ filter: { id, actor: access.actor } });
    if (!row) fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    const snapshot = await this.cash(access, row.date.slice(0, 7), true),
      matches = await this.hyl.db
        .repository<Match>('hylBankMatches')
        .findMany();
    const match = matches.find((m) => m.rowId === row.id),
      visibleMatch =
        match && snapshot.lines.cash.some((e) => e.id === match.eventId)
          ? match
          : undefined;
    const used = new Set(matches.map((m) => m.eventId));
    const mayConfirm =
      (
        await access.authorization.authorize({
          resource: { type: 'settings', id: 'hyl.externalReconciliation' },
          action: 'write',
        })
      ).effect === 'permit';
    return {
      row,
      resolutions: await this.hyl.db
        .repository<BankResolution>('hylBankResolutions')
        .findMany({
          filter: { rowId: row.id },
          sort: (s) => [s.field('createdAt').desc()],
        }),
      match: visibleMatch,
      candidates: candidates(row, snapshot.lines.cash, matches),
      events: snapshot.lines.cash.filter(
        (e) =>
          !used.has(e.id) && BigInt(e.amountCents) === BigInt(row.amountCents),
      ),
      canWrite: !match && mayConfirm,
      mayConfirm,
      differences: differences(row, snapshot.lines.cash),
    };
  }
  async match(access: Access, v: z.infer<typeof matchSchema>) {
    const detail = await this.matchDetail(access, v.rowId);
    if (!detail.mayConfirm) fail('ACCESS_DENIED', 'PERMISSION_DENIED');
    const existing = await this.hyl.db
      .repository<Match>('hylBankMatches')
      .findOne({ filter: { id: v.requestId } });
    if (
      existing &&
      detail.match?.id === existing.id &&
      existing.actor === access.actor &&
      existing.rowId === v.rowId &&
      existing.eventId === v.eventId &&
      existing.reason === v.reason
    )
      return existing;
    if (!detail.canWrite) fail('ACCESS_DENIED', 'PERMISSION_DENIED');
    if (!detail.events.some((e) => e.id === v.eventId))
      fail('MATCH_INVALID', 'FAILED_PRECONDITION');
    const created = await this.hyl.db
      .repository<Match>('hylBankMatches')
      .createOne({
        values: {
          id: v.requestId,
          rowId: v.rowId,
          eventId: v.eventId,
          reason: v.reason,
          actor: access.actor,
          createdAt: new Date().toISOString(),
        },
      });
    return created.record;
  }
}
