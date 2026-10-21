import { z } from 'zod';
export const kinds = ['contracts', 'bills', 'purchases'] as const;
export type Kind = (typeof kinds)[number];
const text = (n: number) => z.string().trim().min(1).max(n);
export const configValues = z
  .object({
    enabled: z.boolean(),
    levels: z
      .array(
        z
          .object({
            name: text(60),
            userIds: z
              .array(text(100))
              .min(1)
              .max(20)
              .refine((v) => new Set(v).size === v.length),
          })
          .strict(),
      )
      .max(5),
  })
  .strict()
  .refine((v) => !v.enabled || v.levels.length > 0, {
    path: ['levels'],
    message: 'APPROVAL_LEVELS_REQUIRED',
  });
export const configSave = z
  .object({
    requestId: z.uuid(),
    expectedRevision: z.number().int().min(0),
    projectId: z.uuid(),
    kind: z.enum(kinds),
    values: configValues,
  })
  .strict();
export const submission = z
  .object({
    requestId: z.uuid(),
    kind: z.enum(kinds),
    sourceId: z.uuid(),
    expectedVersion: z.number().int().min(0),
    comment: text(2000),
  })
  .strict();
export const actionInput = z
  .object({
    requestId: z.uuid(),
    expectedVersion: z.number().int().min(0),
    action: z.enum(['approve', 'reject', 'cancel']),
    comment: text(2000),
  })
  .strict();
export const listInput = z.object({
  q: z.string().max(100).default(''),
  kind: z.enum(['', ...kinds]).default(''),
  status: z
    .enum(['', 'pending', 'approved', 'rejected', 'cancelled'])
    .default(''),
  view: z.enum(['pending', 'submitted', 'all']).default('pending'),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  order: z
    .enum(['updatedAt', '-updatedAt', 'createdAt', '-createdAt'])
    .default('-updatedAt'),
});
export const personDto = z.object({ id: z.string(), name: z.string() });
export const stageDto = z.object({
  name: z.string(),
  candidates: z.array(personDto),
});
export const configDto = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  kind: z.enum(kinds),
  revision: z.number(),
  enabled: z.boolean(),
  updatedAt: z.string(),
  levels: z.array(
    z.object({
      name: z.string(),
      userIds: z.array(z.string()),
      users: z.array(personDto.extend({ active: z.boolean() })),
    }),
  ),
});
export const requestDto = z.object({
  id: z.string(),
  kind: z.enum(kinds),
  sourceId: z.string(),
  projectId: z.string(),
  applicantId: z.string(),
  status: z.string(),
  version: z.number(),
  round: z.number(),
  level: z.number(),
  sourceVersion: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  applicantName: z.string(),
  sourcePath: z.string(),
  canDecide: z.boolean(),
  canCancel: z.boolean(),
  canResubmit: z.boolean(),
  payload: z.object({
    number: z.string(),
    title: z.string(),
    comment: z.string(),
    configRevision: z.number(),
    source: z.record(z.string(), z.unknown()),
    stages: z.array(stageDto),
  }),
});
export const detailDto = requestDto.extend({
  events: z.object({
    data: z.array(
      z.object({
        id: z.string(),
        round: z.number(),
        level: z.number(),
        actor: z.string(),
        action: z.string(),
        comment: z.string(),
        payload: z.record(z.string(), z.unknown()),
        createdAt: z.string(),
      }),
    ),
    meta: z.object({
      page: z.number(),
      pageSize: z.number(),
      total: z.number(),
    }),
  }),
});
export const sourceDto = z.object({
  kind: z.enum(kinds),
  id: z.string(),
  projectId: z.string(),
  number: z.string(),
  title: z.string(),
  version: z.number(),
  status: z.string(),
  path: z.string(),
  snapshot: z.record(z.string(), z.unknown()),
  required: z.boolean(),
  canSubmit: z.boolean(),
  request: z
    .object({
      id: z.string(),
      status: z.string(),
      level: z.number(),
      round: z.number(),
    })
    .nullable(),
  levels: z.array(z.object({ name: z.string(), count: z.number() })),
});
