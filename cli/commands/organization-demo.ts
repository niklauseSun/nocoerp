import { AppCommand } from '@nocobase/app-cli';
import { Flags } from '@oclif/core';
export default class OrganizationDemo extends AppCommand {
  static summary =
    'Run the authorized local organization and project access demonstration';
  static flags = {
    'dry-run': Flags.boolean({
      description:
        'Show the plan without creating accounts or granting access.',
    }),
  };
  async run() {
    const { flags } = await this.parse(OrganizationDemo);
    if (flags['dry-run']) {
      this.setStatus('success-noop');
      return {
        accounts: [
          '组织演示项目甲负责人',
          '组织演示项目甲员工',
          '组织演示项目乙员工',
        ],
        projects: 2,
        access:
          'project-scoped read; manager asset maintenance; no administration or payment',
        flows: [
          'inherit',
          'direct grant',
          'foreign row denial',
          'scope removal',
          'revocation',
          'restore',
        ],
      };
    }
    return this.withApp(async ({ app, env }) => {
      if (env.NODE_ENV === 'production')
        throw Error('Local demonstration only.');
      await app.start();
      const [
          { organizationToken },
          { hylToken },
          { runOrganizationDemo, accessFor },
        ] = await Promise.all([
          import('../../server/providers/organization.js'),
          import('../../server/providers/hyl.js'),
          import('../lib/organization-demo.js'),
        ]),
        org = app.container.resolve(organizationToken),
        hyl = app.container.resolve(hylToken),
        email = String(
          app.config.get('users.initialAdmin.email') ?? 'admin@nocobase.com',
        ),
        admin = (
          await hyl.users.list({ search: email, page: 1, pageSize: 20 })
        ).items.find((x) => x.email === email);
      if (!admin) throw Error('Initial administrator unavailable');
      return runOrganizationDemo(org, hyl, await accessFor(org, admin.id));
    });
  }
}
