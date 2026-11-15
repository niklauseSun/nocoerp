// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { WecomClient, WecomError } from '../../server/wecom/client.js';
import { direction } from '../../server/wecom/model.js';
it('compares baselines without resolving competing changes or absence by timestamp', () => {
  const base = { name: 'A', enabled: true },
    local = { ...base, name: 'B' },
    remote = { ...base, name: 'C' };
  expect(direction(base, local, base)).toBe('push');
  expect(direction(base, base, remote)).toBe('pull');
  expect(direction(base, local, remote)).toBe('conflict');
  expect(direction(base, null, remote)).toBe('conflict');
  expect(direction(null, base, base)).toBe('equal');
});
it('caches token, refreshes only explicit token rejection, and sanitizes uncertain POST errors', async () => {
  let tokens = 0,
    updates = 0;
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(String(input));
      expect(u.origin).toBe('https://qyapi.weixin.qq.com');
      expect(init?.redirect).toBe('error');
      if (u.pathname.endsWith('gettoken'))
        return Response.json({
          access_token: 'token-' + ++tokens,
          expires_in: 7200,
        });
      updates++;
      return Response.json(
        updates === 1
          ? { errcode: 42001, errmsg: 'sensitive-secret' }
          : { errcode: 0 },
      );
    },
  );
  const c = new WecomClient('corp', 'secret', fetcher);
  await c.call('user/update', {}, {});
  await c.call('user/update', {}, {});
  expect(tokens).toBe(2);
  expect(updates).toBe(3);
  fetcher.mockImplementationOnce(async () => {
    throw Error('secret-access-token');
  });
  await expect(c.call('user/update', {}, {})).rejects.toMatchObject({
    uncertain: true,
    message: 'WeCom request failed.',
  });
  expect(fetcher).toHaveBeenCalledTimes(6);
});
it('single-flights token fetch and fails malformed token responses before writes', async () => {
  const f = vi.fn(async () =>
    Response.json({ access_token: 'cached', expires_in: 7200 }),
  );
  const c = new WecomClient('corp', 'secret', f);
  await Promise.all([c.accessToken(), c.accessToken()]);
  expect(f).toHaveBeenCalledTimes(1);
  const bad = new WecomClient('corp', 'secret', async () =>
    Response.json({ errcode: 0 }),
  );
  await expect(bad.call('user/create', {}, {})).rejects.toEqual(
    new WecomError(-2),
  );
});
