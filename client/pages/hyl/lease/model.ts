import type { BusinessRow } from '../model.js';
export interface LeaseEntry {
  id: string;
  reversalBlockers?: {
    reason: string;
    contractId: string;
    entries: string[];
  }[];
  kind: string;
  amountCents: string;
  sourceId: string;
  reverseOf: string | null;
  pairId: string;
  reference: string | null;
  createdAt: string;
  payload: Record<string, unknown>;
}
export interface LeaseSummary {
  id: string;
  status: string;
  version: number;
  actualEnd: string;
  payload: Record<string, unknown>;
  depositTarget: string;
  balance: string;
  entries: LeaseEntry[];
  bills?: { id: string; number: string; remaining: string }[];
  charges: (LeaseEntry & { state: string; remaining: string })[];
  settlements: (BusinessRow & { debtRemaining: string })[];
}
export const permissions: Record<string, string> = {
  receive: 'depositReceive',
  refund: 'depositRefund',
  deduct: 'depositDeduct',
  reverse: 'depositReverse',
  collect: 'collectionReceive',
  reverseCollection: 'collectionReverse',
  charge: 'chargeWrite',
  confirmCharge: 'chargeConfirm',
  cancelCharge: 'chargeConfirm',
  renew: 'renew',
  terminate: 'terminate',
  closeLease: 'closeLease',
  reopenLease: 'reopenLease',
};
