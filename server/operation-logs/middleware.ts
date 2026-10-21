import { randomUUID } from 'node:crypto';
import {
  defineHttpMiddleware,
  getRequestId,
  apiErrorStatusCodes,
} from '@nocobase/app-server/router';
import type { Application } from '@nocobase/app-server/application';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import { loggingToken } from '@nocobase/app-server/logging';
import type { MiddlewareHandler } from 'hono';
import { operationLogsToken } from '../providers/operation-logs.js';
import { operations } from './operations.js';
const patterns = operations.map((o) => ({
  ...o,
  matcher: new RegExp('^' + o.path.replace(/\{[^}]+\}/g, '([^/]+)') + '/?$'),
  params: [...o.path.matchAll(/\{([^}]+)\}/g)].map((x) => x[1]),
}));
const identifiers = /^[a-zA-Z0-9_-]{1,100}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fixedId = (value: string) =>
  uuid.test(value) || /^[0-9]{1,25}$/.test(value);
const actions = new Set([
  'accept',
  'activate',
  'allocate',
  'applyDeposit',
  'approve',
  'archive',
  'assign',
  'bill',
  'cancel',
  'cancelCharge',
  'charge',
  'close',
  'closeLease',
  'collect',
  'complete',
  'confirm',
  'confirmCharge',
  'convert',
  'deactivate',
  'deduct',
  'delete',
  'discard',
  'edit',
  'execute',
  'feedback',
  'finish',
  'generate',
  'issue',
  'keepLocal',
  'markRead',
  'markUnread',
  'move',
  'pass',
  'pause',
  'pay',
  'post',
  'progress',
  'publish',
  'read',
  'reassign',
  'receive',
  'recover',
  'rectify',
  'refund',
  'reject',
  'renew',
  'reopen',
  'reopenLease',
  'reply',
  'report',
  'resume',
  'retry',
  'return',
  'reverse',
  'reverseAllocation',
  'reverseCollection',
  'reverseRefund',
  'review',
  'save',
  'schedule',
  'settle',
  'star',
  'start',
  'stop',
  'submit',
  'suspend',
  'terminate',
  'toRepair',
  'transfer',
  'unstar',
  'update',
  'useRemote',
  'void',
  'withdraw',
]);
export const operationLogMiddleware = defineHttpMiddleware<Application>({
  name: 'nocoerp/operationLogs',
  register(router, app) {
    const auth = app.container.resolve(authenticationToken);
    for (const root of new Set(operations.map((o) => o.path.split('/')[2]))) {
      // Public root middleware runs before plugin/application APIs, including forwarded permission routes.
      // Explicit owned prefixes keep authentication, pages and unrelated plugin traffic out.
      const capture: MiddlewareHandler<AuthEnv> = async (c, next) => {
        const operation = patterns.find(
          (o) => o.method === c.req.method && o.matcher.test(c.req.path),
        );
        if (!operation) {
          await next();
          return;
        }
        const started = Date.now(),
          id = randomUUID();
        let action: string = operation.operation;
        // Resolve identity without adding authentication policy or origin checks to the owning route.
        let session: Awaited<ReturnType<typeof auth.getSession>> = null;
        try {
          session = await auth.getSession(c.req.raw.headers);
        } catch {
          /* The owning route rejects invalid credentials. */
        }
        await next();
        const body = c.req.valid('json' as never) as
          { action?: unknown } | undefined;
        if (typeof body?.action === 'string' && actions.has(body.action))
          action = body.action;
        const captures = operation.matcher.exec(c.req.path);
        const actionPosition = operation.params.indexOf('action');
        if (
          actionPosition >= 0 &&
          actions.has(captures?.[actionPosition + 1] ?? '')
        )
          action = captures![actionPosition + 1];
        const parameter = [
          'assignmentId',
          'id',
          'userId',
          'invitationId',
          'scheduleId',
          'messageId',
        ].find((p) => operation.params.includes(p));
        const position = parameter ? operation.params.indexOf(parameter) : -1;
        const captured = position >= 0 ? (captures?.[position + 1] ?? '') : '';
        let targetId = fixedId(captured) ? captured : '';
        let errorCode = '';
        // Project only structural IDs and canonical status codes from small JSON responses.
        if (c.res.headers.get('content-type')?.includes('application/json')) {
          try {
            const payload = (await c.res.clone().json()) as {
              data?: { id?: unknown; key?: unknown };
              error?: { status?: unknown };
            };
            if (
              !targetId &&
              typeof payload.data?.id === 'string' &&
              fixedId(payload.data.id)
            )
              targetId = payload.data.id;
            if (
              !targetId &&
              c.res.status < 400 &&
              operation.module === 'authorization' &&
              typeof payload.data?.key === 'string' &&
              identifiers.test(payload.data.key)
            )
              targetId = payload.data.key;
            if (
              typeof payload.error?.status === 'string' &&
              Object.hasOwn(apiErrorStatusCodes, payload.error.status)
            )
              errorCode = payload.error.status;
          } catch {
            /* Nonstandard response metadata is omitted. */
          }
        }
        if (
          !targetId &&
          c.res.status < 400 &&
          operation.module === 'authorization'
        ) {
          const keyPosition = operation.params.indexOf('key');
          const key =
            keyPosition >= 0 ? (captures?.[keyPosition + 1] ?? '') : '';
          if (identifiers.test(key)) targetId = key;
        }
        const requestId = getRequestId(c);
        try {
          await app.container.resolve(operationLogsToken).append({
            id,
            createdAt: new Date(started).toISOString(),
            actorId: session?.user.id ?? '',
            actorName: session?.user.name?.slice(0, 150) ?? '',
            module: operation.module,
            action,
            targetId,
            method: operation.method,
            pathTemplate: operation.path,
            result: c.res.status < 400 ? 'success' : 'failure',
            httpStatus: c.res.status,
            errorCode,
            requestId: uuid.test(requestId) ? requestId : randomUUID(),
            durationMs: Math.min(Date.now() - started, 2147483647),
          });
        } catch {
          // The business transaction may already be committed; never turn it into a false failure.
          app.container
            .resolve(loggingToken)
            .getLogger('operationLogs')
            .error({ operationLogId: id }, 'Operation log append failed');
        }
      };
      router.use('/api/' + root + '/*', capture as MiddlewareHandler);
    }
  },
});
