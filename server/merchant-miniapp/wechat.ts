import { ApiError } from '@nocobase/app-server/router';
import { z } from 'zod';
import type { MiniappConfig } from '../config/merchant-miniapp.js';

export const phone = z.string().regex(/^1[3-9]\d{9}$/);
export const loginInput = z
  .object({
    loginCode: z.string().min(1).max(256),
    phoneCode: z.string().min(1).max(256),
  })
  .strict();

export function unavailable(): never {
  throw new ApiError({
    status: 'UNAVAILABLE',
    domain: 'merchantMiniapp',
    reason: 'MINIAPP_UNAVAILABLE',
    message: 'Merchant mini-program is unavailable.',
  });
}
function invalid(): never {
  throw new ApiError({
    status: 'UNAUTHENTICATED',
    domain: 'merchantMiniapp',
    reason: 'MINIAPP_WECHAT_REJECTED',
    message: 'WeChat did not verify the login.',
  });
}
export class WechatIdentity {
  private token?: { value: string; expires: number };
  private pending?: Promise<string>;
  constructor(
    readonly config: MiniappConfig,
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
  ) {}
  private async request(
    path: string,
    query: Record<string, string>,
    body?: object,
  ) {
    const url = new URL(path, 'https://api.weixin.qq.com');
    url.search = new URLSearchParams(query).toString();
    try {
      const response = await this.fetcher(url, {
        ...(body && {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) unavailable();
      return z.record(z.string(), z.unknown()).parse(await response.json());
    } catch {
      // Do not propagate URLs, vendor payloads or credentials into diagnostics.
      unavailable();
    }
  }
  private async accessToken() {
    if (this.token && this.token.expires > Date.now()) return this.token.value;
    this.pending ??= this.request('/cgi-bin/token', {
      grant_type: 'client_credential',
      appid: this.config.appId,
      secret: this.config.appSecret,
    })
      .then((r) => {
        if (
          typeof r.access_token !== 'string' ||
          typeof r.expires_in !== 'number' ||
          r.expires_in <= 60
        )
          unavailable();
        this.token = {
          value: r.access_token,
          expires: Date.now() + (r.expires_in - 60) * 1000,
        };
        return this.token.value;
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
  async verify(input: z.infer<typeof loginInput>) {
    const { appId, appSecret, enabled } = this.config;
    if (!enabled || !/^wx[a-zA-Z0-9]{16}$/.test(appId) || !appSecret)
      unavailable();
    const identity = await this.request('/sns/jscode2session', {
      appid: appId,
      secret: appSecret,
      js_code: input.loginCode,
      grant_type: 'authorization_code',
    });
    const openId = z.string().min(1).max(128).safeParse(identity.openid);
    if (!openId.success || (identity.errcode && identity.errcode !== 0))
      invalid();
    let result = await this.request(
      '/wxa/business/getuserphonenumber',
      { access_token: await this.accessToken() },
      { code: input.phoneCode },
    );
    if ([40001, 42001].includes(Number(result.errcode))) {
      this.token = undefined;
      result = await this.request(
        '/wxa/business/getuserphonenumber',
        { access_token: await this.accessToken() },
        { code: input.phoneCode },
      );
    }
    const verified = z
      .object({
        errcode: z.literal(0),
        phone_info: z.object({
          purePhoneNumber: phone,
          countryCode: z.literal('86'),
          watermark: z.object({
            appid: z.literal(appId),
            timestamp: z.number().int().positive(),
          }),
        }),
      })
      .safeParse(result);
    if (
      !verified.success ||
      Math.abs(
        Date.now() / 1000 - verified.data.phone_info.watermark.timestamp,
      ) > 600
    )
      invalid();
    return {
      appId,
      openId: openId.data,
      phone: verified.data.phone_info.purePhoneNumber,
    };
  }
}
