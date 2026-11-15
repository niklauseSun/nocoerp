import { z } from 'zod';
import { createHash } from 'node:crypto';
import { ApiError } from '@nocobase/app-server/router';

export const settingsId = 'hyl.wecom';
export const mappingInput = z
  .object({
    kind: z.enum(['department', 'user']),
    localId: z.string().trim().max(100).default(''),
    remoteId: z
      .string()
      .trim()
      .max(64)
      .regex(/^[a-zA-Z0-9_.@-]*$/)
      .default(''),
  })
  .strict()
  .refine((x) => x.localId || x.remoteId, { path: ['localId'] });
export const syncInput = z
  .object({
    fingerprint: z.string().length(64),
    direction: z.enum(['pull', 'push', 'auto']),
  })
  .strict();
export type Kind = 'department' | 'user';
export type Snapshot = {
  name: string;
  parent?: string;
  email?: string;
  departments?: string[];
  primary?: string;
  enabled: boolean;
};
export interface Mapping {
  id: string;
  corpId: string;
  kind: Kind;
  localId: string;
  remoteId: string;
  localExists: boolean;
  remoteExists: boolean;
  baseline: Snapshot | null;
  state: string;
  version: number;
  updatedAt: string;
  error: string;
  intent: Snapshot | null;
  intentDirection: string;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export function hash(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
export function equal(a: unknown, b: unknown) {
  return hash(a) === hash(b);
}
export function direction(
  base: Snapshot | null,
  local: Snapshot | null,
  remote: Snapshot | null,
) {
  if (equal(local, remote)) return 'equal';
  if (!base) return 'conflict';
  if (!local || !remote) return 'conflict';
  const l = !equal(base, local),
    r = !equal(base, remote);
  return l && r ? 'conflict' : l ? 'push' : 'pull';
}
export function refuse(
  reason: string,
  status:
    | 'INVALID_ARGUMENT'
    | 'ABORTED'
    | 'NOT_FOUND'
    | 'PERMISSION_DENIED' = 'INVALID_ARGUMENT',
): never {
  throw new ApiError({
    status,
    reason: 'WECOM_' + reason,
    domain: 'wecom',
    message: 'WeCom operation could not be completed.',
  });
}
