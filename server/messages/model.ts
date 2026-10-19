import { defineLifecycle, type LifecycleTypes } from '@nocobase/lifecycle';
export const todoLifecycle = defineLifecycle<LifecycleTypes>({
  name: 'hylMessageTodos',
  initial: 'active',
  states: ['active', 'resolved'],
  transitions: {
    resolve: { from: 'active', to: 'resolved' },
    reopen: { from: 'resolved', to: 'active' },
  },
});
export interface Preferences {
  userId: string;
  version: number;
  enabled: boolean;
  contracts: boolean;
  bills: boolean;
  repairs: boolean;
  purchases: boolean;
  contractDays: number;
  billDays: number;
  locale: 'zh-CN' | 'en-US';
  scanToken: string;
  leaseUntil: string;
  lastCheckedAt: string;
  lastError: string;
  createdAt: string;
  updatedAt: string;
}
export type Kind = 'contracts' | 'bills' | 'repairs' | 'purchases';
export interface Todo {
  id: string;
  userId: string;
  dedupeKey: string;
  kind: Kind;
  sourceType: string;
  sourceId: string;
  reason: string;
  dueOn: string;
  status: string;
  generation: number;
  notificationId: string;
  payload: Record<string, unknown>;
  lifecycleVersion: number;
  statusChangedAt: string;
  createdAt: string;
  updatedAt: string;
}
export interface Candidate {
  kind: Kind;
  sourceType: string;
  sourceId: string;
  number: string;
  title: string;
  reason: string;
  dueOn: string;
  path: string;
}
