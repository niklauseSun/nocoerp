/** Cumulative targets are rounded once, never by payment leg. Stable keys settle equal remainders. */
export function apportion(
  total: bigint,
  rows: { key: string; weight: bigint }[],
): Record<string, bigint> {
  const denominator = rows.reduce((n, r) => n + r.weight, 0n);
  if (
    total < 0n ||
    denominator <= 0n ||
    new Set(rows.map((r) => r.key)).size !== rows.length ||
    rows.some((r) => r.weight < 0n)
  )
    throw Error('INVALID_SPLIT_WEIGHTS');
  const result = Object.fromEntries(
    rows.map((r) => [r.key, (total * r.weight) / denominator]),
  );
  let rest = total - Object.values(result).reduce((a, b) => a + b, 0n);
  const ranked = [...rows].sort((a, b) => {
    const x = (total * a.weight) % denominator,
      y = (total * b.weight) % denominator;
    return x === y ? a.key.localeCompare(b.key) : x > y ? -1 : 1;
  });
  for (const r of ranked) {
    if (!rest) break;
    result[r.key]++;
    rest--;
  }
  return result;
}
export function balances(target: bigint, paid: bigint, recovered: bigint) {
  const net = paid - recovered;
  return {
    netPaidCents: String(net),
    remainingCents: String(target > net ? target - net : 0n),
    recoveryCents: String(net > target ? net - target : 0n),
  };
}
