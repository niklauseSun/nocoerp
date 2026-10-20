import type { Application } from '@nocobase/app-server/application';
import type { Job } from './test-employees.js';
export async function verifyEmployeeLogins(
  app: Application,
  accounts: { job: Job; email: string }[],
  passwords: Record<Job, string>,
) {
  const origin = String(
    app.config.get('app.publicOrigin') ?? 'http://127.0.0.1:13000',
  ).replace(/\/$/, '');
  const loginEvidence = [];
  for (const account of accounts) {
    const response = await app.router.request(
      origin + '/api/auth/sign-in/email',
      {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({
          email: account.email,
          password: passwords[account.job],
        }),
      },
    );
    if (response.status !== 200)
      throw Error(
        'Login verification failed ' + account.job + ': ' + response.status,
      );
    const cookie = response.headers
      .getSetCookie()
      .map((s) => s.split(';')[0])
      .join('; ');
    if (!cookie) throw Error('Missing session cookie');
    try {
      const permissions = await app.router.request(
        origin + '/api/authorization/permissions',
        { headers: { cookie } },
      );
      if (permissions.status !== 200)
        throw Error('Session verification failed');
      const finance = await app.router.request(
        origin + '/api/financialReports',
        { headers: { cookie } },
      );
      const expected = ['finance', 'management'].includes(account.job)
        ? 200
        : 403;
      if (finance.status !== expected)
        throw Error(
          'Financial API permission mismatch ' +
            account.job +
            ': ' +
            finance.status,
        );
      loginEvidence.push({
        job: account.job,
        login: response.status,
        permissions: permissions.status,
        financialReports: finance.status,
      });
    } finally {
      await app.router.request(origin + '/api/auth/sign-out', {
        method: 'POST',
        headers: { origin, cookie, 'content-type': 'application/json' },
        body: '{}',
      });
    }
  }

  return loginEvidence;
}
