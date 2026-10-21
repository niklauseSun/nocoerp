export type Method = 'bank' | 'cash' | 'other';
export interface Target {
  billId: string;
  contractId: string;
  expectedBillVersion: number;
  expectedLeaseVersion: number;
  amount: string;
  deposit: string;
  number?: string;
  contractNumber?: string;
}
export interface Payment {
  key: string;
  method: Method;
  amount: string;
  reference: string;
  evidence: string;
  splits: { contractId: string; amount: string }[];
}
export interface Checkout {
  merchantId: string;
  date: string;
  notes: string;
  targets: Target[];
  payments: Payment[];
}
export interface RefundSource {
  receiptId: string;
  expectedVersion: number;
  amount: string;
  method: Method;
  allocations: {
    entryId: string;
    amount: string;
    expectedBillVersion: number;
  }[];
  number?: string;
}
export interface RefundInput {
  date: string;
  reference: string;
  reason: string;
  evidence: string;
  notes: string;
  sources: RefundSource[];
}
export interface CashEvent {
  id: string;
  contractId: string;
  receiptId?: string;
  number: string;
  at: string;
  date: string;
  actor: string;
  method: string;
  kind: string;
  category: string;
  amountCents: string;
}
export interface Report {
  day: string;
  scope: 'own' | 'authorized';
  sourceHash: string;
  cashCents: string;
  netCents: string;
  receivedCents: string;
  refundedCents: string;
  events: CashEvent[];
  channels: Record<
    string,
    {
      receivedCents: string;
      outCents: string;
      correctionCents: string;
      netCents: string;
    }
  >;
  unclassified: boolean;
}
export interface CashRow {
  id: string;
  number: string;
  merchantId: string;
  merchantName?: string;
  version: number;
  status: string;
  day: string;
  actor: string;
  revision: number;
  receivedCents: string;
  allocatedCents: string;
  refundedCents: string;
  unusedCents: string;
  amountCents: string;
  netCents: string;
  differenceCents: string;
  createdAt: string;
  updatedAt: string;
  payload: Record<string, unknown>;
  members?: {
    kind: string;
    sourceId: string;
    contractId: string;
    number?: string;
  }[];
  contracts?: { id: string; number: string }[];
  allowedActions?: string[];
  laterEvents?: number;
  closed?: boolean;
  events?: { action: string; at: string; actor: string }[];
}
export const apiPaths = {
  orders: 'cashierOrders',
  refunds: 'cashierRefunds',
  reconciliations: 'cashierReconciliations',
};
export type Kind = keyof typeof apiPaths;
