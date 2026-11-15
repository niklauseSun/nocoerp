// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { WechatIdentity } from '../../server/merchant-miniapp/wechat.js';

const appId = 'wx0123456789abcdef';
const config = { appId, appSecret: 'fixture', enabled: true };
const body = { loginCode: 'mock-login', phoneCode: 'mock-phone' };
it('exchanges both codes server-side, caches only the platform token, and rejects expired proof', async () => {
  let timestamp = Math.floor(Date.now() / 1000);
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin).toBe('https://api.weixin.qq.com');
    expect(init?.redirect).toBe('error');
    if (url.pathname === '/sns/jscode2session') {
      expect(url.searchParams.get('js_code')).toBe(body.loginCode);
      return Response.json({ openid: 'open-a', session_key: 'unused' });
    }
    if (url.pathname === '/cgi-bin/token')
      return Response.json({ access_token: 'access', expires_in: 7200 });
    expect(url.pathname).toBe('/wxa/business/getuserphonenumber');
    expect(url.searchParams.get('access_token')).toBe('access');
    expect(JSON.parse(String(init?.body))).toEqual({ code: body.phoneCode });
    return Response.json({
      errcode: 0,
      phone_info: {
        purePhoneNumber: '13800000001',
        countryCode: '86',
        watermark: { appid: appId, timestamp },
      },
    });
  });
  const service = new WechatIdentity(config, fetcher);
  await expect(service.verify(body)).resolves.toEqual({
    appId,
    openId: 'open-a',
    phone: '13800000001',
  });
  timestamp -= 700;
  await expect(service.verify(body)).rejects.toMatchObject({
    reason: 'MINIAPP_WECHAT_REJECTED',
  });
  expect(
    fetcher.mock.calls.filter(([url]) =>
      String(url).includes('/cgi-bin/token'),
    ),
  ).toHaveLength(1);
});
it('fails closed without configuration and never relays network errors or secrets', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new Error('fixture secret and vendor URL'));
  await expect(
    new WechatIdentity({ ...config, enabled: false }, fetcher).verify(body),
  ).rejects.toMatchObject({ reason: 'MINIAPP_UNAVAILABLE' });
  expect(fetcher).not.toHaveBeenCalled();
  await expect(
    new WechatIdentity(config, fetcher).verify(body),
  ).rejects.toMatchObject({
    reason: 'MINIAPP_UNAVAILABLE',
    message: 'Merchant mini-program is unavailable.',
  });
});
