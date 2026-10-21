export type {
  Config,
  ConfigValues,
  Source,
  SourceLine,
  Invoice,
  InvoiceLine,
  Expected,
  IssueValues,
  RedValues,
} from '../../../server/invoicing/model.js';
export type Page<T> = {
  restricted?: boolean;
  data: T[];
  meta: { page: number; pageSize: number; total: number };
};
export type Item = {
  id: string;
  number?: string;
  contractId?: string;
  merchantId?: string;
  billId?: string;
  status?: string;
  version: number;
  allowedActions: string[];
  payload: Record<string, unknown>;
  [key: string]: unknown;
};
export const endpoint = (kind: string) =>
  kind === 'sources'
    ? 'invoiceSources'
    : kind === 'configs'
      ? 'invoiceConfigs'
      : 'invoices';
export function kindFrom(path: string) {
  const matches = [
    ...path.matchAll(
      /\/(configs|invoiceConfig|sources|invoiceSources|source|invoice|invoices|original)(?=\/|$)/g,
    ),
  ];
  const k = matches.at(-1)?.[1];
  return k === 'configs' || k === 'invoiceConfig'
    ? 'configs'
    : k === 'sources' || k === 'invoiceSources' || k === 'source'
      ? 'sources'
      : 'invoices';
}
