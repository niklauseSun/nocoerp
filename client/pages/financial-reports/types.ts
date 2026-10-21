export type { Line, Check } from '../../../server/finance/model.js';
import type { Line, Check } from '../../../server/finance/model.js';
export interface Report {
  data: {
    generatedAt: string;
    from: string;
    to: string;
    currency: string;
    projects: { id: string; name: string }[];
    summary: Record<string, string>;
    categories: {
      type: string;
      receivedCents: string;
      paidCents: string;
      netCents: string;
    }[];
    checks: Check[];
    items: (Line | Check)[];
  };
  meta: { page: number; pageSize: number; total: number };
}
