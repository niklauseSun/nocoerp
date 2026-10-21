export type SourceRecord = {
  id: string;
  number: string;
  name?: string | null;
  merchantName?: string | null;
  contractTitle?: string | null;
  contractNumber?: string | null;
  start?: string;
  end?: string;
  payload?: unknown;
};
/** Display only fields already present in the caller's authorized DTO/snapshot. */
export function sourceRecordLabel(row: SourceRecord) {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const payload =
    row.payload && typeof row.payload === 'object'
      ? (row.payload as Record<string, unknown>)
      : {};
  const contract =
    payload.contract && typeof payload.contract === 'object'
      ? (payload.contract as Record<string, unknown>)
      : {};
  return [
    row.number,
    text(row.merchantName) || text(row.name),
    text(contract.title) || text(row.contractTitle),
    text(contract.number) || text(row.contractNumber),
    [row.start, row.end].filter(Boolean).join(' – '),
  ]
    .filter(Boolean)
    .join(' · ');
}
