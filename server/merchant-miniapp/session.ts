import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';

// Pathless: reachable only by the trusted application route after WeChat verification.
export function merchantMiniappSession() {
  return {
    id: 'merchant-miniapp-session',
    endpoints: {
      issueMerchantMiniappSession: createAuthEndpoint(
        {
          method: 'POST',
          body: z.object({ userId: z.string() }),
          metadata: { SERVER_ONLY: true, noStore: true },
        },
        async (ctx) => {
          const user = await ctx.context.internalAdapter.findUserById(
            ctx.body.userId,
          );
          if (!user) throw new APIError('UNAUTHORIZED');
          const session = await ctx.context.internalAdapter.createSession(
            user.id,
            true,
          );
          if (!session) throw new APIError('INTERNAL_SERVER_ERROR');
          await setSessionCookie(ctx, { user, session }, true);
          return {
            token: session.token,
            sessionId: session.id,
            expiresAt: session.expiresAt,
          };
        },
      ),
    },
  } as const;
}
