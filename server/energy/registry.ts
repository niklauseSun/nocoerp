import type { DatabaseConnection } from '@nocobase/db';
import type { Row } from '../hyl/schema.js';
import type { BillLine, BillValues } from '../billing/model.js';
import { fail } from '../hyl/service.js';
import { configAt, configs } from '../billing/accounting.js';
import { covered, fixedDecimal, nextDay } from '../billing/calculation.js';
import { effectiveEnd } from '../leases/model.js';
import type { EnergyRecord } from './model.js';
import { calculateUsage } from './calculation.js';
export const str = (v: unknown) =>
  typeof v === 'string'
    ? v
    : typeof v === 'number' || typeof v === 'boolean'
      ? String(v)
      : '';
export const hashable = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Record<string, unknown>;
export async function registry(c: DatabaseConnection, contractId: string) {
  const assignments = await c
      .repository<EnergyRecord>('hylEnergyAssignments')
      .findMany({ filter: { contractId } }),
    result = [];
  for (const a of assignments) {
    const m = await c
      .repository<EnergyRecord>('hylEnergyMeters')
      .findOne({ filter: { id: a.meterId } });
    if (m) result.push({ a, m });
  }
  return result;
}
export async function managedAt(
  c: DatabaseConnection,
  contractId: string,
  assetId: string,
  type: string,
  code: string,
  start: string,
  end: string,
) {
  return (await registry(c, contractId)).filter(
    ({ a, m }) =>
      a.assetId === assetId &&
      m.payload.type === type &&
      m.payload.code === code &&
      a.start <= end &&
      (!a.end || a.end >= start),
  );
}
export async function managedLines(
  c: DatabaseConnection,
  contract: Row,
  input: BillValues,
  start: string,
  end: string,
  previousLines: BillLine[],
  except = '',
) {
  const ids = input.readingIds ?? [];
  if (new Set(ids).size !== ids.length) fail('ENERGY_SOURCE_ALREADY_BILLED');
  const result: Omit<BillLine, 'id' | 'billId'>[] = [],
    assignments = await registry(c, contract.id),
    versions = await configs(c, contract.id);
  for (const id of ids) {
    const r = await c
      .repository<EnergyRecord>('hylEnergyReadings')
      .findOne({ filter: { id } });
    if (!r || r.contractId !== contract.id)
      fail('RECORD_NOT_FOUND', 'NOT_FOUND');
    const pair = assignments.find(({ a }) => a.id === r.payload.assignmentId);
    if (
      !pair ||
      r.status !== 'approved' ||
      r.start < start ||
      r.end > end ||
      r.start < pair.a.start ||
      (pair.a.end && r.end > pair.a.end)
    )
      fail('ENERGY_READING_REQUIRED');
    const links = await c
      .repository<EnergyRecord>('hylEnergyBillLinks')
      .findMany({ filter: { activeReadingId: r.id } });
    if (links.some((l) => l.billId !== except))
      fail('ENERGY_SOURCE_ALREADY_BILLED');
    const type = str(pair.m.payload.type),
      priceConfig = await configAt(c, contract.id, r.start),
      price = priceConfig?.payload.utilities[type as 'water'];
    if (price === undefined || !input.fees.includes(type as 'water'))
      fail('BILLING_FEE_DISABLED');
    if (
      versions.some(
        (v) => v.effectiveFrom > r.start && v.effectiveFrom <= r.end,
      )
    )
      fail('ENERGY_PRICE_BOUNDARY_REQUIRED');
    const { usage, amountCents } = calculateUsage(
      str(r.payload.previous),
      str(r.payload.current),
      str(r.payload.multiplier),
      price,
    );
    if (amountCents === '0' && (!input.zeroReason || !input.zeroEvidence))
      fail('BILLING_ZERO_EVIDENCE_REQUIRED', 'INVALID_ARGUMENT');
    if (
      previousLines.some(
        (l) =>
          l.assetId === r.assetId &&
          l.feeType === type &&
          l.meterCode === pair.m.payload.code &&
          l.start <= r.end &&
          l.end >= r.start,
      )
    )
      fail('BILLING_DUPLICATE_PERIOD');
    result.push({
      contractId: contract.id,
      feeType: type,
      assetId: r.assetId,
      meterCode: str(pair.m.payload.code),
      start: r.start,
      end: r.end,
      sourceKey: 'energy:' + r.id,
      amountCents,
      payload: {
        ...r.payload,
        usage,
        unitPrice: price,
        readingId: r.id,
        readingNumber: r.number,
        meterId: r.meterId,
        assignmentId: pair.a.id,
        readingVersion: r.version,
        assignmentVersion: pair.a.version,
        meterVersion: pair.m.version,
        configVersion: priceConfig!.version,
      },
    });
  }
  // Managed fees require complete per-meter coverage, combining adjacent segments and existing valid bills.
  for (const { a, m } of assignments) {
    if (!input.fees.includes(str(m.payload.type) as 'water')) continue;
    const from = a.start > start ? a.start : start,
      to = a.end && a.end < end ? a.end : end;
    if (from > to) continue;
    const all = [...previousLines, ...result].filter(
      (l) =>
        l.assetId === a.assetId &&
        l.meterCode === m.payload.code &&
        l.feeType === m.payload.type,
    );
    if (!covered(from, to, all)) fail('ENERGY_READING_REQUIRED');
  }
  return result;
}
export async function reserveSources(
  c: DatabaseConnection,
  billId: string,
  lines: BillLine[],
  actor: string,
) {
  for (const line of lines) {
    const readingId = str(line.payload.readingId);
    if (!readingId) continue;
    const r = (await c
      .repository<EnergyRecord>('hylEnergyReadings')
      .findOne({ filter: { id: readingId } }))!;
    const now = new Date().toISOString(),
      id = crypto.randomUUID();
    await c.repository<EnergyRecord>('hylEnergyBillLinks').createOne({
      values: {
        ...r,
        id,
        number: 'YL-' + id,
        version: 0,
        lifecycleVersion: 0,
        statusChangedAt: now,
        code: null,
        status: 'reserved',
        activeReadingId: readingId,
        billId,
        actor,
        payload: {
          readingId,
          billLineId: line.id,
          amountCents: line.amountCents,
          ...line.payload,
        },
        createdAt: now,
        updatedAt: now,
      },
    });
  }
}
export async function syncEnergyBill(
  c: DatabaseConnection,
  billId: string,
  status: string,
) {
  const rows = await c
    .repository<EnergyRecord>('hylEnergyBillLinks')
    .findMany({ filter: { billId } });
  for (const row of rows)
    await c.repository<EnergyRecord>('hylEnergyBillLinks').updateOne({
      filter: { id: row.id },
      values: {
        status:
          status === 'voided'
            ? 'released'
            : status === 'draft'
              ? 'reserved'
              : 'issued',
        activeReadingId: status === 'voided' ? null : row.activeReadingId,
        version: row.version + 1,
        updatedAt: new Date().toISOString(),
      },
    });
}
export async function energyClosingBlockers(
  c: DatabaseConnection,
  row: Row,
  end: string,
  lines: BillLine[],
) {
  const result = [];
  for (const { a, m } of await registry(c, row.id)) {
    if (a.start > end) continue;
    const to = a.end && a.end < end ? a.end : end;
    const readings = await c
      .repository<EnergyRecord>('hylEnergyReadings')
      .findMany({
        filter: { meterId: m.id, contractId: row.id, status: 'approved' },
      });
    const last = readings.find(
      (r) => r.end === to && r.payload.assignmentId === a.id,
    );
    const paidLines = lines.filter((l) => l.payload.assignmentId === a.id);
    if (!last || !covered(a.start, to, paidLines))
      result.push({
        kind: 'billingCoverage',
        id: m.id,
        number: str(m.payload.code),
        date: a.start,
        end: to,
        status: !last ? 'missingReading' : 'missing',
        contractId: row.id,
        feeType: str(m.payload.type),
        assetId: a.assetId,
        meterCode: str(m.payload.code),
      });
  }
  return result;
}
export async function assertAssignment(
  c: DatabaseConnection,
  a: EnergyRecord,
  m: EnergyRecord,
  contract: Row,
) {
  const links = await c
    .repository('hylContractAssets')
    .findMany({ filter: { contractId: contract.id, assetId: m.assetId } });
  const end = await effectiveEnd(c, contract);
  if (
    !links.length ||
    a.start < str(contract.payload.start) ||
    a.start > end ||
    (a.end && a.end > end)
  )
    fail('ENERGY_ASSIGNMENT_CONFLICT');
  const bindings = await c.repository('hylAssetBindings').findMany({
    filter: { assetId: m.assetId, merchantId: contract.merchantId },
  });
  if (
    !bindings.some(
      (b) =>
        str(b.start) <= a.start && (!b.end || str(b.end) >= (a.end || end)),
    )
  )
    fail('ENERGY_ASSIGNMENT_CONFLICT');
}
export async function assertChain(
  c: DatabaseConnection,
  m: EnergyRecord,
  a: EnergyRecord | undefined,
  r: EnergyRecord,
  submit = true,
) {
  if (m.status !== 'active') fail('ENERGY_METER_STOPPED');
  if (
    r.start > r.end ||
    r.start < (a?.start ?? m.start) ||
    (a?.end && r.end > a.end) ||
    r.start < m.start
  )
    fail('ENERGY_READING_CHAIN_CONFLICT');
  const rows = (
    await c
      .repository<EnergyRecord>('hylEnergyReadings')
      .findMany({ filter: { meterId: m.id } })
  ).filter(
    (x) => x.id !== r.id && ['submitted', 'approved'].includes(x.status),
  );
  if (rows.some((x) => x.start <= r.end && x.end >= r.start))
    fail('ENERGY_READING_CHAIN_CONFLICT');
  const before = rows
    .filter(
      (x) =>
        x.status === 'approved' &&
        x.end < r.start &&
        (!a || str(x.payload.assignmentId) === a.id),
    )
    .sort((x, y) => x.end.localeCompare(y.end))
    .at(-1);
  const from = before ? nextDay(before.end) : (a?.start ?? m.start),
    previous = before
      ? str(before.payload.current)
      : str(a?.payload.openingReading ?? m.payload.openingReading);
  if (
    submit &&
    (r.start !== from || !r.payload.evidence || r.payload.current === null)
  )
    fail('ENERGY_READING_REQUIRED');
  if (
    r.payload.current !== null &&
    fixedDecimal(str(r.payload.current)) < fixedDecimal(previous)
  )
    fail('ENERGY_READING_CHAIN_CONFLICT');
  r.payload = {
    ...r.payload,
    previous,
    multiplier: str(m.payload.multiplier),
    usage:
      r.payload.current === null
        ? ''
        : calculateUsage(
            previous,
            str(r.payload.current),
            str(m.payload.multiplier),
            '0',
          ).usage,
  };
  return r;
}
