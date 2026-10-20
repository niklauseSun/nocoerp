import { useMemo, useRef, useState } from 'react';
import { useApiClient, useToaster, ApiClientError } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import {
  UsersClient,
  type ManagedUser,
} from '@nocobase/app-plugin-users/client/user-client';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from '@nocobase/i18n/client';
export type UserPage = {
  data: ManagedUser[];
  meta: { page: number; pageSize: number; total: number };
};
export function userQuery(params: URLSearchParams) {
  const page = Number(params.get('userPage'));
  return {
    q: params.get('userQ') ?? '',
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    pageSize: 20,
  };
}
export function useUserPermission(action: string, id = '*') {
  return useCan({ resource: { type: 'user', id }, action });
}
/** Password inputs stay in local form state/closures; never put mutation arguments into a query or persistent store. */
export function useUserAction() {
  const api = useApiClient();
  const client = useMemo(() => new UsersClient(api), [api]);
  const cache = useQueryClient();
  const toast = useToaster();
  const { t } = useTranslation();
  const pendingRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  return {
    client,
    busy,
    error,
    clearError: () => setError(undefined),
    run: async (
      task: () => Promise<unknown>,
      message: string,
      name: string,
      onError?: (error: unknown) => void,
    ) => {
      if (pendingRef.current) return false;
      pendingRef.current = true;
      setBusy(true);
      setError(undefined);
      try {
        const result = await task();
        if (
          result &&
          typeof result === 'object' &&
          'id' in result &&
          'name' in result &&
          'email' in result
        ) {
          const record = result as ManagedUser;
          const updated: ManagedUser = {
            id: record.id,
            name: record.name,
            email: record.email,
            username: record.username,
            emailVerified: record.emailVerified,
            disabledAt: record.disabledAt,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            roleScopes: record.roleScopes,
          };
          cache.setQueriesData<UserPage>(
            {
              queryKey: ['organization'],
              predicate: (query) => query.queryKey[3] === 'users',
            },
            (old) =>
              old
                ? {
                    ...old,
                    data: old.data.map((user) =>
                      user.id === updated.id ? updated : user,
                    ),
                  }
                : old,
          );
        }
        await cache.invalidateQueries({ queryKey: ['organization'] });
        toast.show({ title: t(message, { name }) });
        return true;
      } catch (error) {
        setError(error);
        onError?.(error);
        if (error instanceof ApiClientError && error.status === 404)
          await cache.invalidateQueries({ queryKey: ['organization'] });
        return false;
      } finally {
        pendingRef.current = false;
        setBusy(false);
      }
    },
  };
}

export function restoreUserFocus(userId?: string) {
  requestAnimationFrame(() => {
    if (
      document.querySelector(
        '[role="alertdialog"],[data-slot="route-overlay-content"]',
      )
    )
      return;
    const target = userId
      ? document.getElementById('staff-menu-' + userId)
      : document.getElementById('staff-create');
    const fallback = document
      .getElementById('staff-directory-search')
      ?.querySelector('input');
    (target ?? fallback)?.focus();
  });
}
