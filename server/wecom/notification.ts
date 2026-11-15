import { z } from 'zod';
import type {
  NotificationChannelDefinition,
  NotificationProviderDefinition,
  NotificationService,
} from '@nocobase/app-plugin-notification/server';
import type { WecomService } from './service.js';
import { WecomError } from './client.js';
import type { Todo } from '../messages/model.js';
const message = z
  .object({
    corpId: z.string().min(1),
    agentId: z.string().min(1),
    to: z
      .string()
      .regex(/^[a-zA-Z0-9_.@-]{1,64}$/)
      .refine((x) => x !== '@all'),
    text: z
      .string()
      .min(1)
      .refine((x) => Buffer.byteLength(x, 'utf8') <= 2048),
  })
  .strict();
type Message = z.infer<typeof message>;
export function wecomChannel(): NotificationChannelDefinition<
  { provider: string },
  { userId: string },
  Message,
  Message
> {
  return {
    type: 'nocoerp-wecom',
    async createChannel() {
      return {
        type: 'nocoerp-wecom',
        validateMessage(input) {
          const m = message.parse(input);
          return { message: m, recipients: [{ userId: m.to }] };
        },
        async prepare({ message, recipient }) {
          return { ...message, to: recipient.userId };
        },
      };
    },
  };
}
export function wecomProvider(
  service: () => WecomService,
): NotificationProviderDefinition<{ provider: 'nocoerp-wecom' }, Message> {
  return {
    type: 'nocoerp-wecom',
    messageType: 'nocoerp-wecom',
    async createProvider() {
      return {
        type: 'nocoerp-wecom',
        async send({ message: m, signal }) {
          const s = service();
          if (
            !s.config.enabled ||
            !s.config.notifications ||
            m.corpId !== s.config.corpId ||
            m.agentId !== s.config.agentId
          )
            return {
              status: 'failed',
              disposition: 'never',
              error: {
                category: 'configuration',
                message: 'WeCom configuration does not match this delivery.',
              },
            };
          try {
            const r = await s.appClient.call(
              'message/send',
              {},
              {
                touser: m.to,
                msgtype: 'text',
                agentid: Number(m.agentId),
                text: { content: m.text },
              },
              signal,
            );
            if (r.invaliduser || r.unlicenseduser)
              return {
                status: 'failed',
                disposition: 'never',
                error: {
                  category: 'recipient',
                  message: 'WeCom recipient is unavailable.',
                },
              };
            return {
              status: 'accepted',
              providerMessageId:
                typeof r.msgid === 'string' ? r.msgid : undefined,
            };
          } catch (e) {
            const error = {
              category: 'provider' as const,
              message: 'WeCom delivery failed.',
              code: e instanceof WecomError ? String(e.code) : 'UNKNOWN',
            };
            if (!(e instanceof WecomError) || e.uncertain)
              return { status: 'submission_unknown', error };
            return {
              status: 'failed',
              disposition: [-1, 45009].includes(e.code)
                ? 'same_provider'
                : 'never',
              error,
            };
          }
        },
      };
    },
  };
}
interface Frozen {
  id: string;
  userId: string;
  corpId: string;
  payload: Message;
  notificationId: string;
  createdAt: string;
}
export class WecomReminders {
  constructor(
    readonly s: WecomService,
    readonly notifications: NotificationService,
    readonly baseUrl: string,
  ) {}
  async delivery(userId: string, todo: Todo) {
    const frozen = await this.s.org.db
      .repository<Frozen>('hylWecomMessages')
      .findOne({
        filter: { id: 'wecom-' + todo.id + '-' + todo.generation, userId },
      });
    if (!frozen) return { status: 'notSent', canRetry: false };
    if (
      frozen.corpId !== this.s.config.corpId ||
      frozen.payload.agentId !== this.s.config.agentId
    )
      return { status: 'configurationMismatch', canRetry: false };
    const n = frozen.notificationId
      ? await this.notifications.getNotification(frozen.notificationId)
      : await this.notifications.getByIdempotencyKey(frozen.id);
    return {
      status: n?.status || 'pending',
      canRetry:
        !!this.s.config.enabled &&
        !!this.s.config.notifications &&
        (!n || n.deliveries.some((d) => d.status === 'failed')),
    };
  }
  async retry(userId: string, todo: Todo) {
    if (!(await this.delivery(userId, todo)).canRetry) return;
    const id = 'wecom-' + todo.id + '-' + todo.generation,
      n = await this.notifications.getByIdempotencyKey(id);
    if (!n) {
      await this.send(userId, todo);
      return;
    }
    for (const d of n.deliveries)
      if (d.status === 'failed')
        await this.notifications.retryDelivery({
          deliveryId: d.id,
          reason: 'Recipient requested retry',
        });
  }
  async send(userId: string, todo: Todo) {
    if (!this.s.config.enabled || !this.s.config.notifications) return;
    const id = 'wecom-' + todo.id + '-' + todo.generation,
      repo = this.s.org.db.repository<Frozen>('hylWecomMessages');
    let frozen = await repo.findOne({ filter: { id } });
    if (!frozen) {
      const mapping = (await this.s.mappings()).find(
        (x) =>
          x.kind === 'user' &&
          x.localId === userId &&
          x.localExists &&
          x.remoteExists &&
          x.state === 'synced',
      );
      const person = await this.s.org.users.get(userId);
      if (!mapping || !person || person.disabledAt) return;
      const url = new URL(this.baseUrl);
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        url.username ||
        url.password
      )
        return;
      const text =
        String(todo.payload.title) +
        '\n' +
        String(todo.payload.body) +
        '\n' +
        this.baseUrl.replace(/\/$/, '') +
        '/messageTodos/' +
        encodeURIComponent(todo.id);
      const payload = message.parse({
        corpId: this.s.config.corpId,
        agentId: this.s.config.agentId,
        to: mapping.remoteId,
        text,
      });
      const row: Frozen = {
        id,
        userId,
        corpId: this.s.config.corpId,
        payload,
        notificationId: '',
        createdAt: new Date().toISOString(),
      };
      // The personal reminder lease serializes normal callers; unique id protects recovery.
      await repo.upsertOne({ filter: { id }, create: row, update: { id } });
      frozen = (await repo.findOne({ filter: { id } }))!;
    }
    if (
      frozen.corpId !== this.s.config.corpId ||
      frozen.payload.agentId !== this.s.config.agentId ||
      frozen.notificationId
    )
      return;
    const result = await this.notifications.send({
      idempotencyKey: id,
      source: { type: 'wecomReminder', referenceId: todo.id },
      messages: { wecom: frozen.payload },
    });
    await repo.updateMany({
      filter: { id, notificationId: '' },
      values: { notificationId: result.notificationId },
    });
  }
}
