import type { Application } from '@nocobase/app-server/application';
import {
  ServiceProvider,
  createServiceToken,
} from '@nocobase/service-provider';
import {
  notificationExtensionRegistryToken,
  notificationServiceToken,
} from '@nocobase/app-plugin-notification/server';
import { userRoleScopeRegistryToken } from '@nocobase/app-plugin-users/server/tokens';
import { jobExecutorServiceToken } from '@nocobase/app-server/jobs';
import type { ScheduleExecutor } from '@nocobase/jobs';
import { organizationToken } from './organization.js';
import { WecomService } from '../wecom/service.js';
import {
  WecomReminders,
  wecomChannel,
  wecomProvider,
} from '../wecom/notification.js';
import { settingsId } from '../wecom/model.js';
export const wecomToken = createServiceToken<WecomService>('nocoerp/wecom');
export const wecomRemindersToken = createServiceToken<WecomReminders>(
  'nocoerp/wecom-reminders',
);
export default class WecomProvider extends ServiceProvider<Application> {
  readonly name = 'nocoerp/wecom';
  private executor?: ScheduleExecutor;
  override register() {
    this.app.container.singleton(
      wecomToken,
      () =>
        new WecomService(
          this.app.container.resolve(organizationToken),
          this.app.container.resolve(userRoleScopeRegistryToken),
          this.app.config.get('wecom')!,
        ),
    );
    this.app.container.singleton(
      wecomRemindersToken,
      () =>
        new WecomReminders(
          this.app.container.resolve(wecomToken),
          this.app.container.resolve(notificationServiceToken),
          (this.app.config.get<string>('app.publicOrigin') || '') +
            (this.app.config.get<string>('app.publicBasePath') || ''),
        ),
    );
    this.app.container
      .resolve(notificationExtensionRegistryToken)
      .registerChannel(wecomChannel())
      .registerProvider(
        wecomProvider(() => this.app.container.resolve(wecomToken)),
      );
  }
  override async boot() {
    const s = this.app.container.resolve(wecomToken);
    s.org.authz.settings.add({
      id: settingsId,
      title: { key: 'wecom.title', ns: 'nocoerp' },
      actions: ['read', 'update'].map((name) => ({
        name,
        title: { key: 'organization.' + name, ns: 'nocoerp' },
      })),
    });
    s.org.authz.ui.place(
      { type: 'settings', id: settingsId },
      { section: 'hyl-organization' },
    );
  }
  override async start() {
    const s = this.app.container.resolve(wecomToken);
    if (!s.config.enabled || !s.config.autoSync) return;
    this.executor = this.app.container
      .resolve(jobExecutorServiceToken)
      .getScheduleExecutor('@nocoerp/wecom');
    await this.executor.addJob({
      name: 'mapped-directory-sync',
      options: { cron: '*/5 * * * *', tz: 'Asia/Shanghai' },
      payload: {},
      execute: async () => {
        // Explicit deployment opt-in is a trusted directory integration, not a cached administrator session.
        const rows = (await s.mappings())
          .filter(
            (m) =>
              m.baseline &&
              m.localExists &&
              m.remoteExists &&
              !['busy', 'unknown'].includes(m.state),
          )
          .reverse()
          .slice(0, 20);
        for (const m of rows) {
          let failure = '';
          try {
            const p = await s.preview(m.id);
            if (p.suggested === 'conflict') failure = 'CONFLICT';
            else await s.sync('wecom-system', m.id, p.fingerprint, 'auto');
          } catch {
            failure = 'CHECK_FAILED';
          }
          if (failure)
            await s.org.db.transaction(async (c) => {
              // Touch only the version inspected by this scan; never replace a concurrently claimed intent.
              const changed = await c
                .repository('hylWecomMappings')
                .updateMany({
                  filter: { id: m.id, version: m.version, state: m.state },
                  values: {
                    state: failure === 'CONFLICT' ? 'conflict' : 'failed',
                    error: failure,
                    updatedAt: new Date().toISOString(),
                  },
                });
              if (changed.updatedCount === 1)
                await s.audit(
                  c,
                  m.id,
                  'wecom-system',
                  'auto',
                  failure === 'CONFLICT' ? 'conflict' : 'failed',
                  failure,
                );
            });
        }
      },
    });
    await this.executor.setup();
  }
  override async shutdown() {
    await this.executor?.shutdown();
  }
}
