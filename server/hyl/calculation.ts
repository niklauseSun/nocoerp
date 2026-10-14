/** Money is parsed once to integer cents; no binary floating-point calculations. */
export function cents(value: string): bigint {
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(value)) throw new Error('INVALID_MONEY');
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
export function money(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
function rounded(value: bigint, denominator: bigint): bigint {
  return (value + denominator / 2n) / denominator;
}
export function periodFor(month: string, part: string): [string, string] {
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
    !['month', 'first', 'second'].includes(part)
  )
    throw new Error('INVALID_PERIOD');
  const [year, number] = month.split('-').map(Number);
  const days = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return [
    `${month}-${part === 'second' ? '16' : '01'}`,
    `${month}-${part === 'first' ? '15' : String(days)}`,
  ];
}
export interface FeeContract {
  method: string;
  basis: string;
  rate: string;
  fixedFee: string;
  minimum: string;
  rent: string;
  includeActivity: boolean;
  includeCash: boolean;
  includeHospitality: boolean;
}
export interface RevenueAmounts {
  receipts: string;
  refunds: string;
  activity: string;
  cash: string;
  hospitality: string;
  collected: string;
}
export interface ExpenseAmounts {
  amount: string;
  responsibility: string;
}
export function calculateSettlement(
  contract: FeeContract,
  revenues: RevenueAmounts[],
  expenses: ExpenseAmounts[],
  start: string,
  end: string,
): Record<string, string> {
  const periodDays = BigInt(
    Number(end.slice(-2)) - Number(start.slice(-2)) + 1,
  );
  const days = BigInt(
    new Date(
      Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)), 0),
    ).getUTCDate(),
  );
  const prorate = (value: string): bigint =>
    rounded(cents(value) * periodDays, days);
  let turnover = 0n,
    feeBasis = 0n,
    collected = 0n,
    deductions = 0n,
    ownCost = 0n;
  for (const row of revenues) {
    const receipts = cents(row.receipts) - cents(row.refunds);
    turnover +=
      receipts + cents(row.activity) + cents(row.cash) + cents(row.hospitality);
    collected += cents(row.collected);
    feeBasis += receipts;
    if (contract.basis === 'turnover') {
      if (contract.includeActivity) feeBasis += cents(row.activity);
      if (contract.includeCash) feeBasis += cents(row.cash);
      if (contract.includeHospitality) feeBasis += cents(row.hospitality);
    }
  }
  for (const row of expenses) {
    if (row.responsibility === 'company') deductions += cents(row.amount);
    else ownCost += cents(row.amount);
  }
  const commission = rounded(feeBasis * cents(contract.rate), 10000n);
  const minimum = prorate(contract.minimum);
  const fee =
    contract.method === 'fixed'
      ? prorate(contract.fixedFee)
      : contract.method === 'minimum' && minimum > commission
        ? minimum
        : commission;
  const rent = prorate(contract.rent);
  return Object.fromEntries(
    Object.entries({
      turnover,
      feeBasis,
      collected,
      fee,
      rent,
      deductions,
      ownCost,
      payable: collected - fee - rent - deductions,
    }).map(([key, value]) => [key, money(value)]),
  );
}
