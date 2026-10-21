export const feeTypes = [
  'rent',
  'property',
  'water',
  'electricity',
  'gas',
  'other',
] as const;
export const utilities = ['water', 'electricity', 'gas'] as const;
export type UtilityType = (typeof utilities)[number];
export interface Meter {
  uiKey?: string;
  assetId: string;
  meterCode: string;
  feeType: UtilityType;
  activeFrom: string;
  activeTo?: string;
  openingReading: string;
  openingEvidence: string;
  stopReading?: string;
  stopEvidence: string;
}
export interface Configuration {
  effectiveFrom: string;
  rentChannel: 'bill' | 'settlement';
  property: { enabled: boolean; method: 'fixed' | 'area'; price: string };
  utilities: Partial<Record<UtilityType, string>>;
  meters: Meter[];
  notes: string;
}
export interface Reading {
  uiKey?: string;
  assetId: string;
  meterCode: string;
  feeType: UtilityType;
  start: string;
  end: string;
  previous: string;
  current: string;
  multiplier: string;
  evidence: string;
  notes: string;
}
export interface Other {
  uiKey?: string;
  title: string;
  amount: string;
  reference: string;
  reason: string;
  evidence: string;
}
export interface BillInput {
  month: string;
  part: 'month' | 'first' | 'second';
  dueDate: string;
  fees: string[];
  readings: Reading[];
  others: Other[];
  acknowledgeGaps: boolean;
  zeroReason: string;
  zeroEvidence: string;
  notes: string;
}
export interface ConfigRecord {
  id: string;
  version: number;
  effectiveFrom: string;
  payload: Configuration;
}
export interface ConfigResponse {
  contract: {
    id: string;
    number: string;
    title: string;
    merchantId: string;
    version: number;
    start: string;
    end: string;
    cycle: string;
    rent: string;
  };
  lease: Lease;
  history: ConfigRecord[];
  version: number;
  channelLocked: boolean;
  assets: {
    assetId: string;
    snapshot: { name: string; lettableArea: string };
  }[];
  allowedActions: string[];
}
export interface Lease {
  version: number;
  status: string;
  actualEnd: string;
  payload?: { predecessorId?: string };
}
export interface AuditEvent {
  action: string;
  actor: string;
  at: string;
  reason?: string;
  evidence?: string;
  reference?: string;
}
export interface LedgerEntry {
  id: string;
  kind: string;
  amountCents: string;
  receiptId?: string;
  billId?: string;
  sourceId?: string;
  sourceType?: string;
  sourceNumber?: string | null;
  reference?: string | null;
  reverseOf: string | null;
  reversed?: boolean;
  payload: Record<string, unknown>;
  createdAt: string;
}
export interface Line {
  id: string;
  feeType: string;
  assetId: string;
  meterCode: string;
  start: string;
  end: string;
  amountCents: string;
  payload: Record<string, unknown>;
}
export interface Bill {
  id: string;
  number: string;
  contractId: string;
  merchantId: string;
  version: number;
  status: string;
  displayStatus: string;
  start: string;
  end: string;
  date: string;
  cycleStart: string;
  cycleEnd: string;
  dueDate: string;
  amountCents: string;
  depositCents: string;
  allocatedCents: string;
  remainingCents: string;
  overdue: boolean;
  merchantName?: string | null;
  contractNumber?: string | null;
  contractTitle?: string | null;
  allowedActions: string[];
  lease: Lease;
  depositBalance: string | null;
  payload: {
    input: BillInput;
    configVersion: number;
    contract: Record<string, unknown>;
    config: Configuration;
    actor: string;
    notes: string;
  };
  events?: AuditEvent[];
  eventsMeta?: Meta;
  lines: Line[];
  linesMeta: Meta;
  ledger: LedgerEntry[];
  ledgerMeta: Meta;
}
export interface Receipt {
  id: string;
  number: string;
  contractId: string;
  merchantId: string;
  version: number;
  status: string;
  displayStatus: string;
  date: string;
  reference: string;
  amountCents: string;
  allocatedCents: string;
  refundedCents: string;
  unusedCents: string;
  payload: { method: string; evidence: string; notes: string; actor: string };
  merchantName?: string | null;
  contractNumber?: string | null;
  contractTitle?: string | null;
  allowedActions: string[];
  events?: AuditEvent[];
  eventsMeta?: Meta;
  entries: LedgerEntry[];
  entriesMeta: Meta;
  lease: Lease;
}
export interface Meta {
  total: number;
  page: number;
  pageSize: number;
}
export interface ListResponse<T> {
  data: T[];
  meta: Meta;
  totals: Record<string, string>;
}
export interface Preview {
  config: ConfigRecord;
  start: string;
  end: string;
  cycleStart: string;
  cycleEnd: string;
  events?: AuditEvent[];
  eventsMeta?: Meta;
  lines: Line[];
  total: string;
  warnings: string[];
}
export interface BillingBlocker {
  kind: string;
  id: string;
  number: string;
  date: string;
  end?: string;
  feeType?: string;
  meterCode?: string;
  status: string;
}
export interface Summary {
  blockers?: BillingBlocker[];
  config: ConfigRecord | null;
  bills: ListResponse<Bill>;
  receipts: ListResponse<Receipt> | null;
  allowedActions: string[];
  lease: Lease;
}
