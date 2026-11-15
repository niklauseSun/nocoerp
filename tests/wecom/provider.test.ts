// @vitest-environment node
import { expect, it, vi } from 'vitest';
import {
  wecomProvider,
  wecomChannel,
} from '../../server/wecom/notification.js';
import { WecomError } from '../../server/wecom/client.js';
import type { WecomService } from '../../server/wecom/service.js';
import type { NotificationProviderContext } from '@nocobase/app-plugin-notification/server';
it('validates native recipients and classifies accepted, rejected, unknown and cross-enterprise delivery', async () => {
  const call = vi.fn().mockResolvedValue({ errcode: 0, msgid: 'm' }),
    s = {
      config: {
        enabled: true,
        notifications: true,
        corpId: 'corp',
        agentId: '1',
      },
      appClient: { call },
    } as unknown as WecomService;
  const context = {} as NotificationProviderContext;
  const channel = await wecomChannel().createChannel(context, {
    provider: 'nocoerp-wecom',
  });
  expect(() =>
    channel.validateMessage({
      corpId: 'corp',
      agentId: '1',
      to: '@all|user',
      text: 'x',
    }),
  ).toThrow();
  expect(() =>
    channel.validateMessage({
      corpId: 'corp',
      agentId: '1',
      to: '@all',
      text: 'x',
    }),
  ).toThrow();
  const provider = await wecomProvider(() => s).createProvider(context, {
    provider: 'nocoerp-wecom',
  });
  const input = {
    message: { corpId: 'corp', agentId: '1', to: 'alice', text: 'reminder' },
    notificationId: 'n',
    deliveryId: 'd',
    attemptId: 'a',
    deadline: new Date(Date.now() + 30000).toISOString(),
    signal: new AbortController().signal,
  };
  expect((await provider.send(input)).status).toBe('accepted');
  call.mockRejectedValueOnce(new WecomError(-1, true));
  expect((await provider.send(input)).status).toBe('submission_unknown');
  call.mockResolvedValueOnce({ errcode: 0, invaliduser: 'alice' });
  expect(await provider.send(input)).toMatchObject({
    status: 'failed',
    disposition: 'never',
  });
  expect(
    await provider.send({
      ...input,
      message: { ...input.message, corpId: 'other' },
    }),
  ).toMatchObject({ status: 'failed', disposition: 'never' });
  expect(call).toHaveBeenCalledTimes(3);
});
