export interface RuleValues {
  enabled: boolean;
  effectiveFrom: string;
  billFeeTypes: string[];
  recipients: {
    key: string;
    kind: 'project' | 'partner';
    name: string;
    accountLabel: string;
    rate: string;
  }[];
  notes: string;
}
export interface Rule {
  allowedActions?: string[];
  closed?: boolean;
  merchantName?: string;
  contractNumber?: string;
  id: string;
  contractId: string;
  merchantId: string;
  version: number;
  effectiveFrom: string;
  enabled: boolean;
  payload: RuleValues;
  actor: string;
  createdAt: string;
  updatedAt: string;
  searchText: string;
}
export interface Line {
  key: string;
  kind: string;
  name: string;
  accountLabel: string;
  rate: string;
  targetCents: string;
  grossPaidCents: string;
  recoveredCents: string;
  netPaidCents: string;
  remainingCents: string;
  recoveryCents: string;
}
export interface Snapshot {
  sourceKind: 'bill' | 'settlement';
  sourceId: string;
  sourceNumber: string;
  sourceStart: string;
  contractId: string;
  contractNumber: string;
  merchantId: string;
  merchantName: string;
  rule: Rule;
  sourceFundsCents: string;
  shareBaseCents: string;
  retainedTargetCents: string;
  costTargetCents: string;
  fundingGapCents: string;
  grossPaidCents: string;
  recoveredCents: string;
  netPaidCents: string;
  remainingCents: string;
  recoveryCents: string;
  lines: Line[];
  sources: {
    id: string;
    kind: string;
    number: string;
    amountCents: string;
    allocationId?: string;
  }[];
  operatingComposition?: Record<string, string>;
  feeComposition?: {
    id: string;
    feeType: string;
    amountCents: string;
    cashCents: string;
    included: boolean;
  }[];
  excludedDepositCents?: string;
  sourceHash: string;
  sourceVersion: number;
}
export interface Order {
  id: string;
  number: string;
  contractId: string;
  merchantId: string;
  sourceKind: 'bill' | 'settlement';
  sourceId: string;
  activeRevision: number;
  status: string;
  version: number;
  lifecycleVersion: number;
  statusChangedAt: string;
  sourceHash: string;
  sourceFundsCents: string;
  netPaidCents: string;
  remainingCents: string;
  recoveryCents: string;
  payload: { snapshot: Snapshot; reviewedHash: string; history?: unknown[] };
  searchText: string;
  createdAt: string;
  updatedAt: string;
}
export interface Transfer {
  id: string;
  orderId: string;
  contractId: string;
  merchantId: string;
  recipientKey: string;
  kind: string;
  amountCents: string;
  reference: string | null;
  sourceTransferId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}
