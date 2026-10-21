import { bankInput } from '../../../server/tenant-operations/model.js';
/** RFC4180 quoted fields; reject malformed quoting and extra columns rather than guess a financial mapping. */
export function parseBankCsv(text: string) {
  if (text.length > 2_000_000) throw Error('CSV_TOO_LARGE');
  const rows: string[][] = [];
  let row: string[] = [],
    value = '',
    quoted = false,
    closed = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else value += c;
      continue;
    }
    if (c === '"') {
      if (value || closed) throw Error('CSV_QUOTE');
      quoted = true;
    } else if (c === ',') {
      row.push(value);
      value = '';
      closed = false;
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(value);
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      value = '';
      closed = false;
    } else {
      if (closed) throw Error('CSV_QUOTE');
      value += c;
    }
  }
  if (quoted) throw Error('CSV_QUOTE');
  row.push(value);
  if (row.some((v) => v !== '')) rows.push(row);
  const header = ['externalId', 'date', 'reference', 'amountCents', 'method'];
  if (
    JSON.stringify(rows.shift()) !== JSON.stringify(header) ||
    !rows.length ||
    rows.length > 500
  )
    throw Error('CSV_HEADER');
  const result = rows.map((r) => {
    if (r.length !== 5) throw Error('CSV_COLUMNS');
    return bankInput.parse(Object.fromEntries(header.map((h, i) => [h, r[i]])));
  });
  if (new Set(result.map((r) => r.externalId)).size !== result.length)
    throw Error('CSV_DUPLICATE');
  return result;
}
export const bankSample =
  'externalId,date,reference,amountCents,method\r\nTEST-BANK-001,2026-10-20,TEST-NOT-REAL-PAYMENT,10000,bank\r\n';
