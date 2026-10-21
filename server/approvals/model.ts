import {
  defineLifecycle,
  normalizeReviewerSelections,
  type LifecycleTypes,
  type ParameterGroup,
} from '@nocobase/lifecycle';
import { z } from 'zod';
import type { Kind } from './schema.js';
export interface Level {
  name: string;
  reviewers: { group: number; type: string; referenceId: string }[];
}
export interface Stage {
  name: string;
  candidates: { id: string; name: string }[];
}
export interface Request {
  id: string;
  kind: Kind;
  sourceId: string;
  projectId: string;
  scope: string;
  applicantId: string;
  status: string;
  version: number;
  round: number;
  level: number;
  sourceVersion: number;
  payload: {
    number: string;
    title: string;
    source: Record<string, unknown>;
    stages: Stage[];
    configRevision: number;
    comment: string;
  };
  lifecycleVersion: number;
  statusChangedAt: string;
  createdAt: string;
  updatedAt: string;
}
export interface Opinion {
  id: string;
  requestId: string;
  round: number;
  level: number;
  actor: string;
  action: string;
  comment: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
export const parameterCollections = {
  heads: 'hylApprovalParameterHeads',
  versions: 'hylApprovalParameterVersions',
  selections: 'hylApprovalParameterSelections',
  requests: 'hylApprovalParameterRequests',
  snapshots: 'hylApprovalParameterSnapshots',
  usages: 'hylApprovalParameterUsages',
} as const;
const levels = z
  .array(
    z
      .object({
        name: z.string().trim().min(1).max(60),
        reviewers: z.unknown(),
      })
      .strict(),
  )
  .max(5);
export const group: ParameterGroup = {
  key: 'approval',
  title: 'Approval configuration',
  schemaVersion: 1,
  fields: {
    enabled: {
      type: 'boolean',
      title: 'Enabled',
      parse: (v) => z.boolean().parse(v),
    },
    levels: {
      type: 'object',
      title: 'Sequential approval levels',
      parse: (v) =>
        levels.parse(v).map((l) => ({
          name: l.name,
          reviewers: normalizeReviewerSelections(l.reviewers, ['user']),
        })),
    },
  },
  validate: (v) => {
    if (v.enabled && (!Array.isArray(v.levels) || !v.levels.length))
      throw Error('APPROVAL_LEVELS_REQUIRED');
  },
  sameReadMode: [['enabled', 'levels']],
};
export const approvalLifecycle = defineLifecycle<
  LifecycleTypes & { parameters: { enabled: boolean; levels: unknown[] } }
>({
  name: 'hylApprovalRequests',
  initial: 'draft',
  states: [
    'draft',
    'pending',
    'rejected',
    { name: 'approved', final: true },
    { name: 'cancelled', final: true },
  ],
  parameters: { enabled: false, levels: [] },
  parameterConfiguration: {
    readMode: 'snapshot',
    snapshotTransition: 'submit',
    groups: [group],
  },
  transitions: {
    submit: { from: ['draft', 'rejected'], to: 'pending' },
    advance: { from: 'pending', to: 'pending' },
    approve: { from: 'pending', to: 'approved' },
    reject: { from: 'pending', to: 'rejected' },
    cancel: { from: ['pending', 'rejected'], to: 'cancelled' },
  },
});
export const contractLifecycle = defineLifecycle<LifecycleTypes>({
  name: 'hylContracts',
  initial: 'draft',
  states: ['draft', 'active'],
  transitions: {
    activate: { from: 'draft', to: 'active', manual: false },
    prepareApproval: { from: 'active', to: 'draft', manual: false },
  },
});
