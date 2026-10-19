import { z } from 'zod';
export const preferenceValues = z
  .object({
    enabled: z.boolean(),
    contracts: z.boolean(),
    bills: z.boolean(),
    repairs: z.boolean(),
    purchases: z.boolean(),
    contractDays: z.number().int().min(1).max(90),
    billDays: z.number().int().min(0).max(30),
    locale: z.enum(['zh-CN', 'en-US']),
  })
  .strict();
export const preferenceInput = z
  .object({
    expectedVersion: z.number().int().min(0),
    values: preferenceValues,
  })
  .strict();
export const listInput = z.object({
  q: z.string().max(100).default(''),
  kind: z.enum(['', 'contracts', 'bills', 'repairs', 'purchases']).default(''),
  status: z.enum(['active', 'resolved', 'all']).default('active'),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  order: z
    .enum([
      'dueOn',
      '-dueOn',
      'createdAt',
      '-createdAt',
      'updatedAt',
      '-updatedAt',
    ])
    .default('-updatedAt'),
});
