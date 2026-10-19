import { AppCommand } from '@nocobase/app-cli';
import { Flags } from '@oclif/core';
export default class FinanceDemo extends AppCommand {
  static summary =
    'Run an isolated local financial report demonstration with simulated journals';
  static flags = {
    'dry-run': Flags.boolean({
      description: 'Show the plan without changing data',
    }),
  };
  async run() {
    const { flags } = await this.parse(FinanceDemo);
    if (flags['dry-run']) {
      this.setStatus('success-noop');
      return {
        project: 'new labelled finance demo project',
        payments: 'simulated journals only',
        flows: [
          'bills',
          'deposits',
          'merged cashier',
          'partial allocation',
          'topup',
          'refund and reversal',
          'merchant payout',
          'supplier acceptance/payment/reversal',
          'independent reconciliation',
        ],
      };
    }
    return this.withApp(async ({ app, env }) => {
      if (env.NODE_ENV === 'production')
        throw Error('Local development demonstration only');
      await app.start();
      const [{ approvalToken }, { runFinanceDemo }] = await Promise.all([
        import('../../server/providers/approvals.js'),
        import('../lib/finance-demo.js'),
      ]);
      const approvals = app.container.resolve(approvalToken),
        email = String(
          app.config.get('users.initialAdmin.email') ?? 'admin@nocobase.com',
        ),
        admin = (
          await approvals.hyl.users.list({
            search: email,
            page: 1,
            pageSize: 20,
          })
        ).items.find((u) => u.email === email);
      if (!admin) throw Error('Configured initial administrator unavailable');
      const result = await runFinanceDemo(
        approvals.hyl,
        await approvals.accessFor(admin.id),
      );
      this.setStatus('success');
      return result;
    });
  }
}
