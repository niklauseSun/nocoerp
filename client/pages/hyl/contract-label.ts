/** Contract rows store the contract title in payload.title and the merchant snapshot in name. */
export function contractLabel(row: {
  number?: unknown;
  name?: unknown;
  payload?: unknown;
}) {
  const text = (value: unknown) =>
    typeof value === 'string' ? value.trim() : '';
  const payload =
    row.payload && typeof row.payload === 'object'
      ? (row.payload as Record<string, unknown>)
      : {};
  return [text(payload.title) || text(row.name), text(row.number)]
    .filter(Boolean)
    .join(' · ');
}
/** Energy assignment options carry the authorized contract's display fields alongside their own identity. */
export function assignedContractLabel(row: {
  contractNumber?: unknown;
  contractTitle?: unknown;
  contractMerchantName?: unknown;
  payload?: unknown;
}) {
  const payload =
    row.payload && typeof row.payload === 'object'
      ? (row.payload as Record<string, unknown>)
      : {};
  return contractLabel({
    number: row.contractNumber ?? payload.contractNumber,
    name: row.contractMerchantName,
    payload: { title: row.contractTitle },
  });
}
