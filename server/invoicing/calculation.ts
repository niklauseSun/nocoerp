/** Fixed issued-bill weights. Unlike largest remainder, each line is monotone as paid grows. */
export function allocate(
  paid: bigint,
  weights: { id: string; amountCents: string }[],
) {
  const rows = weights
    .filter((r) => BigInt(r.amountCents) > 0n)
    .sort((a, b) => a.id.localeCompare(b.id));
  let total = rows.reduce((n, r) => n + BigInt(r.amountCents), 0n),
    left = paid;
  if (paid < 0n || paid > total)
    throw new RangeError('Paid amount outside bill');
  return rows.map((r, i) => {
    const weight = BigInt(r.amountCents),
      amount = i === rows.length - 1 ? left : (left * weight) / total;
    left -= amount;
    total -= weight;
    return { ...r, paidCents: String(amount) };
  });
}
export function tax(gross: bigint, rateBps: number) {
  const denominator = 10000n + BigInt(rateBps),
    net = (gross * 10000n + denominator / 2n) / denominator;
  return {
    grossCents: String(gross),
    netCents: String(net),
    taxCents: String(gross - net),
  };
}
/** Cumulative original-line proration makes the final red exactly cancel original net and tax. */
export function redTax(
  gross: bigint,
  original: { grossCents: string; netCents: string },
  previous: { gross: bigint; net: bigint },
) {
  const full = BigInt(original.grossCents),
    net =
      ((previous.gross + gross) * BigInt(original.netCents) + full / 2n) /
        full -
      previous.net;
  return {
    grossCents: String(gross),
    netCents: String(net),
    taxCents: String(gross - net),
  };
}
