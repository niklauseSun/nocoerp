// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { MessageSources } from '../../server/messages/sources.js';
import type { HylService, Access } from '../../server/hyl/service.js';
import type { Preferences } from '../../server/messages/model.js';
it('TEST settlement reminders require current confirm capability and resolve when confirmed or unsubscribed', async () => {
  const row = {
    id: 'TEST',
    number: 'TEST-JS',
    createdAt: '2026-10-20T01:00:00Z',
    status: 'confirmation',
    confirmationModes: ['online'],
  };
  const hyl = {
    db: { connection: () => ({}) },
    detail: vi.fn(async () => row),
  } as unknown as HylService;
  const sources = new MessageSources(hyl),
    p = { enabled: true, bills: true } as Preferences,
    a = {} as Access;
  expect(
    (await sources.inspect(a, 'bills', 'settlements', 'TEST', p)).candidates[0]
      .reason,
  ).toBe('settlementConfirm');
  row.confirmationModes = [];
  expect(
    (await sources.inspect(a, 'bills', 'settlements', 'TEST', p)).candidates,
  ).toEqual([]);
  row.confirmationModes = ['offline'];
  row.status = 'payable';
  expect(
    (await sources.inspect(a, 'bills', 'settlements', 'TEST', p)).candidates,
  ).toEqual([]);
  row.status = 'confirmation';
  p.enabled = false;
  expect(
    (await sources.inspect(a, 'bills', 'settlements', 'TEST', p)).candidates,
  ).toEqual([]);
});
