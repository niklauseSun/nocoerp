import { verifyEmployeeLogins } from '../lib/test-employee-logins.js';
import { AppCommand } from '@nocobase/app-cli';
import { Flags } from '@oclif/core';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import {
  jobs,
  employeeEmail,
  provisionTestEmployees,
  type Job,
} from '../lib/test-employees.js';
export default class TestEmployees extends AppCommand {
  static summary =
    'Provision explicitly labelled local TEST employees, departments, jobs and project scopes';
  static flags = {
    tag: Flags.string({ required: true }),
    'dry-run': Flags.boolean(),
  };
  async run() {
    const { flags } = await this.parse(TestEmployees),
      tag = flags.tag;
    if (!/^[a-z0-9-]{4,24}$/.test(tag)) throw Error('Invalid test tag');
    if (flags['dry-run']) {
      this.setStatus('success-noop');
      return {
        accounts: jobs.map((j) => ({
          job: j.title,
          email: employeeEmail(j.key, tag),
        })),
        projects: 2,
        scope:
          'business staff TEST A only; TEST B denied; administrator manages organization/users without financial payment',
        passwords: 'generated individually; private ignored manifest only',
      };
    }
    return this.withApp(async ({ app, env }) => {
      if (env.NODE_ENV === 'production')
        throw Error('Local TEST provisioning only');
      await app.start();
      const [{ organizationToken }, { hylToken }, { accessFor }] =
        await Promise.all([
          import('../../server/providers/organization.js'),
          import('../../server/providers/hyl.js'),
          import('../lib/organization-demo.js'),
        ]);
      const org = app.container.resolve(organizationToken),
        hyl = app.container.resolve(hylToken),
        users = app.container.resolve(userManagementServiceToken);
      const email = String(
        app.config.get('users.initialAdmin.email') ?? 'admin@nocobase.com',
      );
      const admin = (
        await hyl.users.list({ search: email, page: 1, pageSize: 20 })
      ).items.find((u) => u.email === email);
      if (!admin) throw Error('Configured administrator unavailable');
      const passwords = Object.fromEntries(
        jobs.map((j) => [j.key, 'T9!' + randomBytes(12).toString('base64url')]),
      ) as Record<Job, string>;
      const directory = path.join(this.rootDir, 'storage', 'test-employees'),
        file = path.join(directory, tag + '.json');
      await mkdir(directory, { recursive: true });
      // Exclusive creation prevents overwriting a previously delivered credential manifest.
      await writeFile(
        file,
        JSON.stringify(
          {
            tag,
            status: 'preparing',
            accounts: jobs.map((j) => ({
              ...j,
              email: employeeEmail(j.key, tag),
              password: passwords[j.key],
            })),
          },
          null,
          2,
        ),
        { mode: 0o600, flag: 'wx' },
      );
      const result = await provisionTestEmployees(
        org,
        hyl,
        users,
        await accessFor(org, admin.id),
        tag,
        passwords,
      );
      await writeFile(
        file,
        JSON.stringify(
          {
            ...result,
            status: 'provisioned',
            accounts: result.accounts.map((a) => ({
              ...a,
              password: passwords[a.job],
            })),
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      const loginEvidence = await verifyEmployeeLogins(
        app,
        result.accounts,
        passwords,
      );
      await writeFile(
        file,
        JSON.stringify(
          {
            ...result,
            status: 'verified',
            loginEvidence,
            accounts: result.accounts.map((a) => ({
              ...a,
              password: passwords[a.job],
            })),
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      this.setStatus('success');
      return { ...result, loginEvidence, credentialsFile: file };
    });
  }
}
