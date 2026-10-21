// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { TenantOperations } from '../../server/tenant-operations/service.js';
import labels from '../../server/locales/operations-zh-CN.js';
import type { Row } from '../../server/hyl/schema.js';
import {
  wrapPdfLine,
  statementRows,
} from '../../server/tenant-operations/export.js';
import { differences } from '../../server/tenant-operations/projections.js';
import {
  followupBack,
  matchFollowupSearch,
} from '../../client/pages/tenant-operations/return-path.js';
import type { HylService, Access } from '../../server/hyl/service.js';
import type { BankRow, Match } from '../../server/tenant-operations/model.js';
it('TEST long Chinese text wraps within printable width without loss', () => {
  const text = '海源里测试商户名称'.repeat(20),
    lines = wrapPdfLine(text);
  expect(lines.join('')).toBe(text);
  expect(lines.every((l) => l.length <= 40)).toBe(true);
});
it('TEST follow-up cancel restores only its original matching context and filters', () => {
  const id = '11111111-1111-4111-8111-111111111111',
    q = matchFollowupSearch(id, '?view=reconciliation&q=TEST&month=2026-10');
  expect(followupBack('bank', id, q)).toEqual({
    pathname: '/tenantOperations/match/' + id,
    search: 'view=reconciliation&q=TEST&month=2026-10',
  });
  expect(followupBack('bank', 'other', q).pathname).toBe('/tenantOperations');
});
it('TEST discrepancy comparison exposes signed cent difference without recommending wrong amount', () => {
  const row = {
    reference: 'TEST',
    date: '2026-10-20',
    amountCents: '10000',
    method: 'bank',
  } as BankRow;
  expect(
    differences(row, [{ id: 'x', ...row, amountCents: '9000' }])[0]
      .differenceCents,
  ).toBe('1000');
});
it('TEST idempotent confirmation rechecks current source visibility and current write grant', async () => {
  const record: Match = {
      id: 'request',
      rowId: 'bank',
      eventId: 'cash',
      actor: 'actor',
      reason: 'TEST',
      createdAt: '',
    },
    createOne = vi.fn(),
    hyl = {
      db: { repository: () => ({ findOne: async () => record, createOne }) },
    } as unknown as HylService;
  const service = new TenantOperations(hyl),
    row = {} as BankRow,
    detail = {
      row,
      match: record,
      candidates: [],
      events: [],
      canWrite: false,
      mayConfirm: true,
      differences: [],
    },
    spy = vi.spyOn(service, 'matchDetail').mockResolvedValue(detail),
    input = {
      requestId: 'request',
      rowId: 'bank',
      eventId: 'cash',
      reason: 'TEST',
    },
    access = { actor: 'actor' } as Access;
  expect(await service.match(access, input)).toEqual(record);
  spy.mockResolvedValue({ ...detail, match: undefined });
  await expect(service.match(access, input)).rejects.toMatchObject({
    reason: 'ACCESS_DENIED',
  });
  spy.mockResolvedValue({ ...detail, mayConfirm: false });
  await expect(service.match(access, input)).rejects.toMatchObject({
    reason: 'ACCESS_DENIED',
  });
  expect(createOne).not.toHaveBeenCalled();
});

it('TEST delivered statement identifies the tenant and retains separate company and tenant costs', () => {
  const row = {
    name: 'TEST测试商户',
    number: 'TEST-JS',
    status: 'payable',
    payload: {
      start: '2026-10-01',
      end: '2026-10-15',
      contractId: 'TEST-CONTRACT',
      contract: {
        number: '',
        method: 'fixed',
        basis: 'receipts',
        rate: '0',
        fixedFee: '100',
        minimum: '0',
        rent: '0',
      },
      amounts: {
        fee: '100.00',
        deductions: '20.00',
        ownCost: '10.00',
        payable: '80.00',
      },
      revenues: [],
      expenses: [],
    },
  } as unknown as Row;
  const rows = statementRows(row, [], labels.statement);
  expect(rows).toContainEqual(['商户名称', 'TEST测试商户']);
  expect(rows).toContainEqual(['公司代付（扣除）', '20.00']);
  expect(rows).toContainEqual(['商户自付（仅统计）', '10.00']);
  expect(rows[4]).toContain('TEST-CONTRACT');
});
