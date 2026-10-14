export type Kind =
  'merchants' | 'contracts' | 'revenueReports' | 'expenses' | 'settlements';
export type Values = Record<string, string | boolean>;
export interface BusinessRow {
  id: string;
  number: string;
  name: string;
  merchantId: string;
  status: string;
  date: string;
  updatedAt: string;
  amountCents: string;
  version: number;
  settlementId: string | null;
  payload: Record<string, unknown>;
  confirmationModes?: string[];
  events?: Record<string, unknown>[];
  payments?: Record<string, unknown>[];
}
export interface FieldSpec {
  key: string;
  type?:
    | 'money'
    | 'date'
    | 'month'
    | 'boolean'
    | 'select'
    | 'merchant'
    | 'contract'
    | 'notes';
  options?: string[];
  optional?: boolean;
}
const f = (
  key: string,
  type?: FieldSpec['type'],
  options?: string[],
  optional = false,
): FieldSpec => ({ key, type, options, optional });
export const specs: Record<Kind, FieldSpec[]> = {
  merchants: [
    f('code'),
    f('name'),
    f('unit'),
    f(
      'category',
      'select',
      [
        'merchantDining',
        'merchantRetail',
        'merchantCulture',
        'merchantLeisure',
        'merchantServices',
        'other',
      ],
      true,
    ),
    f('categoryName', undefined, undefined, true),
    f('legalRepresentative', undefined, undefined, true),
    f('creditCode', undefined, undefined, true),
    f('businessHours', 'notes', undefined, true),
    f('contact'),
    f('phone'),
    f('accountName'),
    f('bank'),
    f('account'),
    f('userId', undefined, undefined, true),
    f('active', 'boolean'),
    f('notes', 'notes', undefined, true),
  ],
  contracts: [
    f('number'),
    f('merchantId', 'merchant'),
    f('start', 'date'),
    f('end', 'date'),
    f('cycle', 'select', ['month', 'half']),
    f('method', 'select', ['commission', 'fixed', 'minimum']),
    f('basis', 'select', ['receipts', 'turnover']),
    f('rate', 'money'),
    f('fixedFee', 'money'),
    f('minimum', 'money'),
    f('rent', 'money'),
    f('includeActivity', 'boolean'),
    f('includeCash', 'boolean'),
    f('includeHospitality', 'boolean'),
    f('notes', 'notes', undefined, true),
  ],
  revenueReports: [
    f('merchantId', 'merchant'),
    f('date', 'date'),
    f('source', 'select', [
      'cash',
      'bank',
      'pos',
      'wechat',
      'alipay',
      'meituan',
      'douyin',
      'other',
    ]),
    f('reference'),
    f('receipts', 'money'),
    f('refunds', 'money'),
    f('activity', 'money'),
    f('cash', 'money'),
    f('hospitality', 'money'),
    f('collected', 'money'),
    f('evidence'),
    f('notes', 'notes', undefined, true),
  ],
  expenses: [
    f('merchantId', 'merchant'),
    f('date', 'date'),
    f('category', 'select', [
      'materials',
      'consumables',
      'water',
      'electricity',
      'gas',
      'property',
      'labor',
      'other',
    ]),
    f('amount', 'money'),
    f('responsibility', 'select', ['company', 'merchant']),
    f('reference'),
    f('evidence'),
    f('notes', 'notes', undefined, true),
  ],
  settlements: [
    f('merchantId', 'merchant'),
    f('contractId', 'contract'),
    f('month', 'month'),
    f('part', 'select', ['month', 'first', 'second']),
  ],
};
export const states: Record<Kind, string[]> = {
  merchants: ['active', 'inactive'],
  contracts: ['active'],
  revenueReports: ['draft', 'pending', 'approved', 'returned'],
  expenses: ['draft', 'pending', 'approved', 'returned'],
  settlements: [
    'review',
    'confirmation',
    'disputed',
    'payable',
    'partial',
    'paid',
    'settled',
    'due',
    'cancelled',
  ],
};
export function defaults(kind: Kind): Values {
  return Object.fromEntries(
    specs[kind].map((s) => [
      s.key,
      s.type === 'boolean'
        ? s.key !== 'includeHospitality'
        : s.type === 'money'
          ? '0'
          : (s.options?.[0] ?? ''),
    ]),
  );
}
export function amountText(value: unknown, locale: string): string {
  const n = Number(value);
  return Number.isFinite(n)
    ? new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'CNY',
      }).format(n)
    : '—';
}
export function availableActions(kind: Kind, row: BusinessRow): string[] {
  if (kind === 'merchants' || kind === 'contracts') return ['edit'];
  if (kind === 'settlements')
    return (
      (
        {
          review: ['review', 'cancel'],
          confirmation: ['confirm', 'dispute'],
          disputed: ['cancel'],
          payable: ['pay'],
          partial: ['pay'],
        } as Record<string, string[]>
      )[row.status] ?? []
    );
  if (row.settlementId) return [];
  return (
    (
      {
        draft: ['edit', 'submit'],
        returned: ['edit', 'submit'],
        pending: ['approve', 'return'],
        approved: ['return'],
      } as Record<string, string[]>
    )[row.status] ?? []
  );
}
export const permissionFor = (action: string): string =>
  action === 'edit'
    ? 'write'
    : action === 'approve' ||
        action === 'return' ||
        action === 'cancel' ||
        action === 'review'
      ? 'review'
      : action === 'dispute'
        ? 'confirm'
        : action;

export function scalar(value: unknown): string {
  return typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
    ? String(value)
    : '';
}
