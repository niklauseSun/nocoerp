import { z } from 'zod';
export const logSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  actorId: z.string(),
  actorName: z.string(),
  module: z.string(),
  action: z.string(),
  targetId: z.string(),
  method: z.string(),
  pathTemplate: z.string(),
  result: z.enum(['success', 'failure']),
  httpStatus: z.number(),
  errorCode: z.string(),
  requestId: z.string(),
  durationMs: z.number(),
});
export type OperationLog = z.infer<typeof logSchema>;
const instant = z.string().datetime({ offset: true });
export const querySchema = z
  .object({
    q: z.string().trim().max(100).default(''),
    module: z.string().max(100).default(''),
    result: z.enum(['', 'success', 'failure']).default(''),
    from: instant.optional(),
    to: instant.optional(),
    order: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((v) => !v.from || !v.to || Date.parse(v.from) <= Date.parse(v.to), {
    message: 'Invalid date range',
  });
export type LogQuery = z.infer<typeof querySchema>;
