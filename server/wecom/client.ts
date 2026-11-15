import { z } from 'zod';

export class WecomError extends Error {
  constructor(
    readonly code: number,
    readonly uncertain = false,
  ) {
    super('WeCom request failed.');
  }
}
const envelope = z
  .object({ errcode: z.number().int().optional() })
  .passthrough();
/** Fixed origin, no redirects, bounded responses, no raw remote errors or URLs in exceptions. */
export class WecomClient {
  private token?: { value: string; until: number };
  private acquiring?: Promise<string>;
  constructor(
    readonly corpId: string,
    private readonly secret: string,
    private readonly transport: typeof fetch = fetch,
  ) {}
  private async request(
    path: string,
    query: Record<string, string>,
    body?: object,
    signal?: AbortSignal,
  ) {
    const url = new URL('https://qyapi.weixin.qq.com/cgi-bin/' + path);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    let posted = false;
    try {
      const abort = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(12000)])
        : AbortSignal.timeout(12000);
      if (abort.aborted) throw new WecomError(-1);
      posted = !!body;
      const response = await this.transport(url, {
        method: body ? 'POST' : 'GET',
        redirect: 'error',
        signal: abort,
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok || !response.body) throw new WecomError(-1, posted);
      const reader = response.body.getReader();
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        for (;;) {
          const next:
            | { done: true; value?: Uint8Array }
            | { done?: false; value: Uint8Array } = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > 2_000_000) {
            await reader.cancel();
            throw new WecomError(-2, posted);
          }
          chunks.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
      const data = envelope.parse(
        JSON.parse(Buffer.concat(chunks).toString('utf8')),
      );
      if (path !== 'gettoken' && typeof data.errcode !== 'number')
        throw new WecomError(-2, posted);
      if (data.errcode && data.errcode !== 0)
        throw new WecomError(data.errcode);
      return data;
    } catch (e) {
      if (e instanceof WecomError) throw e;
      throw new WecomError(-1, posted);
    }
  }
  async accessToken(signal?: AbortSignal): Promise<string> {
    if (this.token && this.token.until > Date.now()) return this.token.value;
    if (this.acquiring) return this.acquiring;
    this.acquiring = (async () => {
      if (!this.corpId || !this.secret) throw new WecomError(-3);
      const raw = await this.request(
        'gettoken',
        { corpid: this.corpId, corpsecret: this.secret },
        undefined,
        signal,
      );
      const data = z
        .object({
          access_token: z.string().min(1),
          expires_in: z.number().positive(),
        })
        .safeParse(raw);
      if (!data.success) throw new WecomError(-2);
      this.token = {
        value: data.data.access_token,
        until: Date.now() + Math.max(0, data.data.expires_in - 120) * 1000,
      };
      return this.token.value;
    })();
    try {
      return await this.acquiring;
    } finally {
      this.acquiring = undefined;
    }
  }
  async call(
    path: string,
    query: Record<string, string> = {},
    body?: object,
    signal?: AbortSignal,
  ) {
    for (let attempt = 0; ; attempt++) {
      const token = await this.accessToken(signal);
      try {
        return await this.request(
          path,
          { ...query, access_token: token },
          body,
          signal,
        );
      } catch (e) {
        // Only explicit token rejection is safe to replay; network/timeout on POST is unknown.
        if (
          attempt === 0 &&
          e instanceof WecomError &&
          [40014, 42001].includes(e.code)
        ) {
          this.token = undefined;
          continue;
        }
        throw e;
      }
    }
  }
}
