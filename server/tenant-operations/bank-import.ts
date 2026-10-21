import { z } from 'zod';
import { bankInput } from './model.js';

const column = z.string().min(1).max(100);
export const mappingSchema = z
  .object({
    externalId: column,
    date: column,
    reference: column,
    method: column.optional(),
    defaultMethod: bankInput.shape.method.default('bank'),
    amount: column.optional(),
    income: column.optional(),
    expense: column.optional(),
    unit: z.enum(['cents', 'yuan']),
  })
  .strict()
  .refine((v) => !!v.amount !== !!(v.income && v.expense), {
    message: 'CSV_MAPPING',
  });
export type BankMapping = z.infer<typeof mappingSchema>;
export const previewImportSchema = z
  .object({ text: z.string().min(1).max(2_000_000), mapping: mappingSchema })
  .strict();

/** RFC4180 reader shared by previews. Malformed quotes/row lengths never silently shift money columns. */
export function csvTable(text: string): string[][] {
  if (new TextEncoder().encode(text).length > 2_000_000)
    throw Error('CSV_TOO_LARGE');
  const result: string[][] = [];
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
    } else if (c === '"') {
      if (value || closed) throw Error('CSV_QUOTE');
      quoted = true;
    } else if (c === ',') {
      row.push(value);
      value = '';
      closed = false;
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(value);
      if (row.some((v) => v !== '')) result.push(row);
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
  if (row.some((v) => v !== '')) result.push(row);
  if (!result.length || result.length > 501) throw Error('CSV_ROWS');
  const header = result[0];
  if (
    header.some((h) => !h.trim()) ||
    new Set(header).size !== header.length ||
    result.some((r) => r.length !== header.length)
  )
    throw Error('CSV_COLUMNS');
  return result;
}

/** No floating point or currency-symbol guessing. A quoted, grouped amount is accepted only with valid thousands groups. */
export function importCents(value: string, unit: BankMapping['unit']): bigint {
  let v = value.trim();
  if (v.includes(',')) {
    if (!/^-?\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(v)) throw Error('CSV_AMOUNT');
    v = v.replaceAll(',', '');
  }
  if (unit === 'cents') {
    if (!/^-?\d{1,16}$/.test(v)) throw Error('CSV_AMOUNT');
    return BigInt(v);
  }
  if (!/^-?\d{1,14}(\.\d{1,2})?$/.test(v)) throw Error('CSV_AMOUNT');
  const [whole, fraction = ''] = v.replace(/^-/, '').split('.');
  return (
    (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))) *
    (v.startsWith('-') ? -1n : 1n)
  );
}

export function normalizeBankCsv(text: string, input: BankMapping) {
  const mapping = mappingSchema.parse(input),
    [header, ...data] = csvTable(text);
  if (!data.length) throw Error('CSV_ROWS');
  const names = [
    'externalId',
    'date',
    'reference',
    'method',
    'amount',
    'income',
    'expense',
  ] as const;
  for (const key of names)
    if (mapping[key] && !header.includes(mapping[key]))
      throw Error('CSV_MAPPING');
  const issues: { row: number; code: string }[] = [];
  const rows: z.infer<typeof bankInput>[] = [];
  const seen = new Set<string>();
  data.forEach((cells, index) => {
    const get = (key: (typeof names)[number]) =>
      mapping[key] ? cells[header.indexOf(mapping[key])].trim() : '';
    try {
      let amount: bigint;
      if (mapping.amount) amount = importCents(get('amount'), mapping.unit);
      else {
        const income = get('income')
          ? importCents(get('income'), mapping.unit)
          : 0n;
        const expense = get('expense')
          ? importCents(get('expense'), mapping.unit)
          : 0n;
        if (income < 0n || expense < 0n || (income > 0n && expense > 0n))
          throw Error('CSV_DIRECTION');
        amount = income - expense;
      }
      const methodText = get('method');
      const method =
        (
          { 银行: 'bank', 转账: 'bank', 现金: 'cash', 其他: 'other' } as Record<
            string,
            string
          >
        )[methodText] ??
        (methodText || mapping.defaultMethod);
      const date = get('date')
        .replace(/^(\d{4})\/(\d{2})\/(\d{2})$/, '$1-$2-$3')
        .replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
      const row = bankInput.parse({
        externalId: get('externalId'),
        date,
        reference: get('reference'),
        amountCents: String(amount),
        method,
      });
      if (seen.has(row.externalId)) throw Error('CSV_DUPLICATE');
      seen.add(row.externalId);
      rows.push(row);
    } catch (error) {
      issues.push({
        row: index + 2,
        code:
          error instanceof z.ZodError
            ? 'CSV_FIELD'
            : error instanceof Error
              ? error.message
              : 'CSV_FIELD',
      });
    }
  });
  // A preview with any invalid row cannot be submitted as a silently shortened batch.
  return {
    headers: header,
    total: data.length,
    rows: issues.length ? [] : rows,
    issues,
  };
}
