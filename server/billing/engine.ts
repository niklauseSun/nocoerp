import { managedAt, managedLines } from '../energy/registry.js';
import { randomUUID } from 'node:crypto';
import type { DatabaseConnection } from '@nocobase/db';
import type { Row } from '../hyl/schema.js';
import type { ContractAsset } from '../assets/schema.js';
import { fail } from '../hyl/service.js';
import { cents, money, periodFor } from '../hyl/calculation.js';
import { effectiveEnd } from '../leases/model.js';
import { activeLines, configAt, configs } from './accounting.js';
import {
  decimalText,
  fixedDecimal,
  nextDay,
  prorated,
  utilityAmount,
} from './calculation.js';
import type { BillLine, BillValues, BillingConfig } from './model.js';

export async function previewBill(
  c: DatabaseConnection,
  contract: Row,
  input: BillValues,
  except = '',
  sourceSeed = '',
) {
  const [cycleStart, cycleEnd] = periodFor(input.month, input.part);
  const start =
    String(contract.payload.start) > cycleStart
      ? String(contract.payload.start)
      : cycleStart;
  const contractEnd = await effectiveEnd(c, contract);
  const end = contractEnd < cycleEnd ? contractEnd : cycleEnd;
  if (
    start > end ||
    (contract.payload.cycle === 'month') !== (input.part === 'month') ||
    input.dueDate < start
  )
    fail('INVALID_PERIOD', 'INVALID_ARGUMENT');
  const config = await configAt(c, contract.id, start);
  if (!config) fail('BILLING_NOT_CONFIGURED');
  const history = await configs(c, contract.id);
  const previousLines = await activeLines(c, contract.id, except);
  const assetLinks = await c
    .repository<ContractAsset>('hylContractAssets')
    .findMany({ filter: { contractId: contract.id } });
  const lines: BillLine[] = [];
  const warnings: string[] = [];
  const line = (
    feeType: string,
    amount: string,
    payload: Record<string, unknown>,
    extra: Partial<BillLine> = {},
  ) => {
    if (cents(amount) > 99999999999999n)
      fail('BILLING_AMOUNT_LIMIT', 'INVALID_ARGUMENT');
    const value: BillLine = {
      id: randomUUID(),
      billId: '',
      contractId: contract.id,
      feeType,
      assetId: '',
      meterCode: '',
      start,
      end,
      sourceKey: `${contract.id}:${cycleStart}:${feeType}`,
      amountCents: cents(amount).toString(),
      payload,
      ...extra,
    };
    if (
      [...previousLines, ...lines].some(
        (l) =>
          l.feeType === value.feeType &&
          (feeType === 'other'
            ? l.sourceKey === value.sourceKey
            : l.assetId === value.assetId &&
              l.meterCode === value.meterCode &&
              l.start <= value.end &&
              l.end >= value.start),
      )
    )
      fail('BILLING_DUPLICATE_PERIOD');
    lines.push(value);
  };
  const days = Number(end.slice(8)) - Number(start.slice(8)) + 1;
  const calendarDays =
    Number(cycleEnd.slice(8)) < 28
      ? new Date(
          Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)), 0),
        ).getUTCDate()
      : Number(cycleEnd.slice(8));
  if (input.fees.includes('rent')) {
    if (config.payload.rentChannel !== 'bill')
      fail('BILLING_RENT_IN_SETTLEMENT');
    line('rent', prorated(String(contract.payload.rent), start, end), {
      monthly: contract.payload.rent,
      days,
      calendarDays,
      area: '1',
    });
  }
  if (input.fees.includes('property')) {
    const property = config.payload.property;
    if (!property.enabled) fail('BILLING_FEE_DISABLED');
    const area =
      property.method === 'area'
        ? decimalText(
            assetLinks.reduce(
              (n, l) =>
                n + fixedDecimal(String(l.snapshot.lettableArea ?? '0')),
              0n,
            ),
          )
        : '1';
    if (property.method === 'area' && fixedDecimal(area) <= 0n)
      fail('BILLING_AREA_REQUIRED');
    line('property', prorated(property.price, start, end, area), {
      monthly: property.price,
      days,
      calendarDays,
      area,
      method: property.method,
    });
  }
  for (const reading of input.readings) {
    if (
      (
        await managedAt(
          c,
          contract.id,
          reading.assetId,
          reading.feeType,
          reading.meterCode,
          reading.start,
          reading.end,
        )
      ).length
    )
      fail('ENERGY_MANAGED_METER_REQUIRED');
    const meter = config.payload.meters.find(
      (m) =>
        m.assetId === reading.assetId &&
        m.meterCode === reading.meterCode &&
        m.feeType === reading.feeType,
    );
    const latestMeter = history
      .flatMap((v) => v.payload.meters)
      .filter(
        (m) =>
          m.assetId === reading.assetId &&
          m.meterCode === reading.meterCode &&
          m.feeType === reading.feeType,
      )
      .at(-1);
    if (meter && latestMeter?.activeTo) {
      meter.activeTo = latestMeter.activeTo;
      meter.stopReading = latestMeter.stopReading;
      meter.stopEvidence = latestMeter.stopEvidence;
    }
    const price = config.payload.utilities[reading.feeType];
    if (!meter || price === undefined || !input.fees.includes(reading.feeType))
      fail('BILLING_METER_REQUIRED');
    const meterStart = meter.activeFrom > start ? meter.activeFrom : start;
    const meterEnd =
      meter.activeTo && meter.activeTo < end ? meter.activeTo : end;
    if (
      reading.start < meterStart ||
      reading.end > meterEnd ||
      reading.start > reading.end ||
      fixedDecimal(reading.current) < fixedDecimal(reading.previous) ||
      fixedDecimal(reading.multiplier) <= 0n
    )
      fail('BILLING_READING_INVALID', 'INVALID_ARGUMENT');
    const before = [...previousLines, ...lines]
      .filter(
        (l) =>
          l.feeType === reading.feeType &&
          l.assetId === reading.assetId &&
          l.meterCode === reading.meterCode &&
          l.end < reading.start,
      )
      .sort((a, b) => a.end.localeCompare(b.end))
      .at(-1);
    const after = [...previousLines, ...lines].find(
      (l) =>
        l.feeType === reading.feeType &&
        l.assetId === reading.assetId &&
        l.meterCode === reading.meterCode &&
        l.start === nextDay(reading.end),
    );
    if (
      (reading.start === meter.activeFrom &&
        fixedDecimal(reading.previous) !==
          fixedDecimal(meter.openingReading)) ||
      (before &&
        nextDay(before.end) === reading.start &&
        fixedDecimal(reading.previous) !==
          fixedDecimal(String(before.payload.current))) ||
      (after &&
        fixedDecimal(reading.current) !==
          fixedDecimal(String(after.payload.previous))) ||
      (meter.activeTo === reading.end &&
        meter.stopReading !== undefined &&
        fixedDecimal(reading.current) !== fixedDecimal(meter.stopReading))
    )
      fail('BILLING_READING_CONFLICT');
    if (reading.start !== meterStart || reading.end !== meterEnd)
      warnings.push('BILLING_READING_GAP');
    const calculated = utilityAmount(
      reading.previous,
      reading.current,
      reading.multiplier,
      price,
    );
    line(
      reading.feeType,
      calculated.amount,
      { ...reading, ...calculated, unitPrice: price },
      {
        assetId: reading.assetId,
        meterCode: reading.meterCode,
        start: reading.start,
        end: reading.end,
        sourceKey: `${contract.id}:${reading.assetId}:${reading.feeType}:${reading.meterCode}:${reading.start}:${reading.end}`,
      },
    );
  }
  for (const managed of await managedLines(
    c,
    contract,
    input,
    start,
    end,
    previousLines,
    except,
  )) {
    line(
      managed.feeType,
      money(BigInt(managed.amountCents)),
      managed.payload,
      managed,
    );
  }
  for (const fee of input.fees.filter((v) =>
    ['water', 'electricity', 'gas'].includes(v),
  ))
    if (!lines.some((l) => l.feeType === fee)) fail('BILLING_METER_REQUIRED');
  // A persisted request seed makes generated fee identities stable across retries.
  const seed = sourceSeed || except || randomUUID();
  const others = input.others.map((other, i) => ({
    ...other,
    reference: other.reference || `FY-${seed}-${i + 1}`,
  }));
  for (const other of others) {
    if (
      (await c.repository('hylLeaseEntries').exists({
        filter: { contractId: contract.id, reference: other.reference },
      })) ||
      (await c.repository('hylExpenses').exists({
        filter: { merchantId: contract.merchantId, number: other.reference },
      }))
    )
      fail('BILLING_FEE_CONFLICT');
    if (cents(other.amount) <= 0n) fail('PAYMENT_REQUIRED', 'INVALID_ARGUMENT');
    line('other', other.amount, other, {
      sourceKey: `${contract.id}:other:${other.reference}`,
    });
  }
  if (!lines.length || lines.length > 50)
    fail('BILLING_LINES_REQUIRED', 'INVALID_ARGUMENT');
  const amount = lines.reduce((n, l) => n + BigInt(l.amountCents), 0n);
  if (amount > 99999999999999n)
    fail('BILLING_AMOUNT_LIMIT', 'INVALID_ARGUMENT');
  if (amount === 0n && (!input.zeroReason || !input.zeroEvidence))
    fail('BILLING_ZERO_EVIDENCE_REQUIRED', 'INVALID_ARGUMENT');
  const expenses = await c
    .repository<Row>('hylExpenses')
    .findMany({ filter: { merchantId: contract.merchantId } });
  if (
    expenses.some(
      (e) =>
        e.date >= start &&
        e.date <= end &&
        lines.some(
          (l) => l.feeType === e.payload.category && l.feeType !== 'other',
        ),
    )
  )
    fail('BILLING_FEE_CONFLICT');
  return {
    config,
    cycleStart,
    cycleEnd,
    start,
    end,
    lines,
    others,
    amountCents: amount.toString(),
    total: money(amount),
    warnings: [...new Set(warnings)],
  };
}
export async function assertConfigExpenses(
  c: DatabaseConnection,
  contract: Row,
  cfg: BillingConfig['payload'],
  until: string,
) {
  const expenses = await c
    .repository<Row>('hylExpenses')
    .findMany({ filter: { merchantId: contract.merchantId } });
  if (
    expenses.some(
      (e) =>
        e.date >= cfg.effectiveFrom &&
        e.date <= until &&
        (e.payload.category === 'property'
          ? cfg.property.enabled
          : Object.hasOwn(cfg.utilities, String(e.payload.category))),
    )
  )
    fail('BILLING_FEE_CONFLICT');
}
