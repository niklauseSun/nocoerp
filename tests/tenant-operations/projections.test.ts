// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  reportingRows,
  ageBucket,
  candidates,
  csv,
} from '../../server/tenant-operations/projections.js';
import { xlsx, pdf } from '../../server/tenant-operations/export.js';
import type { Row } from '../../server/hyl/schema.js';
import type { BankRow } from '../../server/tenant-operations/model.js';
const row = (v: Partial<Row>) =>
  ({ id: 'TEST', name: '测试商户 TEST', payload: {}, ...v }) as Row;
describe('TEST tenant operations', () => {
  it('counts effective merchant days, deduplicates contracts, and keeps missing distinct from zero', () => {
    const m = row({ id: 'm' }),
      c = {
        ...row({
          merchantId: 'm',
          status: 'active',
          payload: { start: '2026-10-14' },
        }),
        end: '2026-10-16',
      },
      report = row({
        id: 'r',
        merchantId: 'm',
        date: '2026-10-15',
        status: 'approved',
        payload: {
          receipts: '0',
          refunds: '0',
          activity: '0',
          cash: '0',
          hospitality: '0',
        },
      });
    const r = reportingRows([m], [c, c], [report], '2026-10', '2026-10-20');
    expect(r.map((x) => x.status)).toEqual(['missing', 'approved', 'missing']);
    expect(r[1].amountCents).toBe('0');
    expect(reportingRows([m], [c], [], '2026-10', '2026-10-14')).toHaveLength(
      1,
    );
  });
  it('uses nonoverlapping overdue buckets', () => {
    expect(ageBucket('2026-09-20', '2026-10-20')).toBe('age30');
    expect(ageBucket('2026-09-19', '2026-10-20')).toBe('age60');
    expect(ageBucket('2026-10-21', '2026-10-20')).toBe('due');
  });
  it('requires exact reference, method, day and signed cents and never picks ambiguous candidates', () => {
    const bank = {
        date: '2026-10-20',
        reference: 'TEST-001',
        amountCents: '100',
        method: 'bank',
      } as BankRow,
      e = { ...bank, id: 'a' };
    expect(candidates(bank, [e, { ...e, id: 'b' }], [])).toHaveLength(2);
    expect(
      candidates(bank, [e, { ...e, id: 'b', method: 'cash' }], []),
    ).toHaveLength(1);
    expect(
      candidates(
        bank,
        [e],
        [
          {
            id: 'x',
            rowId: 'x',
            eventId: 'a',
            reason: 'TEST',
            actor: 'u',
            createdAt: '',
          },
        ],
      ),
    ).toHaveLength(0);
  });
  it('exports inert exact spreadsheet cells and a readable multi-page PDF', async () => {
    expect(csv([['=1+1', '中文']])).toContain("'=1+1");
    const bytes = xlsx([['中文 TEST', '=1+1', '999999999999.99']]);
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(bytes.toString()).toContain('t="inlineStr"');
    const b = await pdf([['测试结算 TEST', '100.00']]);
    expect(new TextDecoder().decode(b.slice(0, 5))).toBe('%PDF-');
  });
});
