import { buildFilter } from '@nocobase/repository-input';
import { ApiError } from '@nocobase/app-server/router';
import { z } from 'zod';
import type { Kind } from './schema.js';

export const viewSchema = z.enum(['monthRevenue', 'unsettled', 'unpaid']);
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export interface BusinessFilters {
  q?: string;
  from?: string;
  to?: string;
  status?: string;
  merchantId?: string;
  view?: z.infer<typeof viewSchema>;
  month?: string;
}

/** Dashboard totals and their destination lists must select exactly the same sources. */
export function businessFilter(kind: Kind, input: BusinessFilters) {
  if (
    input.view &&
    ((input.view === 'unpaid' && kind !== 'settlements') ||
      (input.view !== 'unpaid' && kind !== 'revenueReports') ||
      (input.view === 'monthRevenue' &&
        !monthSchema.safeParse(input.month).success))
  )
    throw new ApiError({
      status: 'INVALID_ARGUMENT',
      reason: 'INVALID_DASHBOARD_FILTER',
      domain: 'hyl',
      message: 'Invalid dashboard filter.',
    });
  return buildFilter((f) =>
    f.and([
      ...(input.q
        ? [
            f.or([
              f.string('number').includes(input.q),
              f.string('name').includes(input.q),
            ]),
          ]
        : []),
      ...(input.status ? [f.string('status').eq(input.status)] : []),
      ...(input.merchantId
        ? [f.string('merchantId').eq(input.merchantId)]
        : []),
      ...(input.view === 'monthRevenue'
        ? [
            f.string('status').eq('approved'),
            f.string('date').startsWith(`${input.month}-`),
          ]
        : []),
      ...(input.view === 'unsettled'
        ? [f.string('status').eq('approved'), f.string('settlementId').eq(null)]
        : []),
      ...(input.view === 'unpaid'
        ? [
            f.or([
              f.string('status').eq('payable'),
              f.string('status').eq('partial'),
            ]),
          ]
        : []),
    ]),
  );
}
