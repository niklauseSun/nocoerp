import type { Application } from '@nocobase/app-server/application';
import {
  ServiceProvider,
  createServiceToken,
} from '@nocobase/service-provider';
import { jobExecutorServiceToken } from '@nocobase/app-server/jobs';
import type { ScheduleExecutor } from '@nocobase/jobs';
import { notificationServiceToken } from '@nocobase/app-plugin-notification/server';
import { authorizationToken } from '@nocobase/app-plugin-authorization';
import { i18nToken } from '@nocobase/app-server/i18n';
import { hylToken } from './hyl.js';
import { MessageService } from '../messages/service.js';
export const messageToken =
  createServiceToken<MessageService>('nocoerp/messages');
export default class MessagesProvider extends ServiceProvider<Application> {
  readonly name = 'nocoerp/messages';
  private executor: ScheduleExecutor | undefined;
  override register() {
    this.app.container.singleton(messageToken, () => {
      const i18n = this.app.container.resolve(i18nToken);
      return new MessageService(
        this.app.container.resolve(hylToken),
        this.app.container.resolve(notificationServiceToken),
        async (locale, reason) => {
          await i18n.ensureLocaleLoaded(locale);
          const t = i18n.getFixedT('nocoerp', locale);
          return { title: t('messages.title'), body: t('messages.' + reason) };
        },
      );
    });
  }
  override async start() {
    this.executor = this.app.container
      .resolve(jobExecutorServiceToken)
      .getScheduleExecutor('@nocoerp/messages');
    await this.executor.addJob({
      name: 'personal-reminder-scan',
      options: { cron: '*/5 * * * *', tz: 'Asia/Shanghai' },
      payload: {},
      execute: async () => {
        await this.app.container
          .resolve(messageToken)
          .tick(this.app.container.resolve(authorizationToken));
      },
    });
    await this.executor.setup();
  }
  override async shutdown() {
    await this.executor?.shutdown();
  }
}
