import { ApiClientError } from '@nocobase/app-client';
import { UserError } from './user-error.js';
import { useState } from 'react';
import { UserActions } from './actions.js';
import {
  userQuery,
  useUserAction,
  useUserPermission,
  restoreUserFocus,
} from './hooks.js';
import { Confirm } from '../../cashier/common.js';
import { StatusBadge } from '#components/status-badge';
import { OrgEmpty } from '../common.js';
import { useOrg, useSetting } from '../hooks.js';
import { Link, Outlet, useSearchParams, useLocation } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import type {
  UsersOptions,
  ManagedUser,
} from '@nocobase/app-plugin-users/client/user-client';
import { Button } from '#components/ui/button';
import {
  Table,
  TableHead,
  TableHeader,
  TableRow,
  TableCell,
  TableBody,
} from '#components/ui/table';
import {
  Group,
  Denied,
  ErrorBox,
  LoadingRows,
  Search,
  Paged,
  Truncated,
} from '../common.js';
export default function Users() {
  const { t } = useTranslation(),
    location = useLocation(),
    create = useUserPermission('create'),
    assign = useUserPermission('assign-role'),
    w = useUserAction(),
    [statusTarget, setStatusTarget] = useState<ManagedUser | null>(null),
    [q, setQ] = useSearchParams(),
    can = useCan({ resource: { type: 'user', id: '*' }, action: 'read' }),
    roles = useSetting('authorization.permission-sets'),
    page = userQuery(q).page,
    search = q.get('userQ') ?? '',
    r = useOrg<{
      data: ManagedUser[];
      meta: { page: number; pageSize: number; total: number };
    }>('users', { q: search, page, pageSize: 20 }, can.can);
  const options = useOrg<{ data: UsersOptions }>(
      'users/options',
      undefined,
      can.can,
    ),
    roleLabels = new Map(
      (options.data?.data.roleScopes ?? []).flatMap((scope) =>
        scope.options.map(
          (role) =>
            [
              role.value,
              role.labelI18nKey
                ? t(role.labelI18nKey, { ns: role.labelI18nNs })
                : role.label,
            ] as const,
        ),
      ),
    );
  const update = (key: string, value: string) => {
    const n = new URLSearchParams(q);
    if (value) n.set(key, value);
    else n.delete(key);
    if (key === 'userQ') n.delete('userPage');
    setQ(n, { replace: true });
  };
  const trulyEmpty = !!r.data && r.data.meta.total === 0 && !search;
  const addButton =
    create.can && assign.can ? (
      <Button
        id='staff-create'
        nativeButton={false}
        render={
          <Link
            to={{
              pathname: '/organization/users/new',
              search: location.search,
            }}
          />
        }
      >
        {t('organization.newEmployee')}
      </Button>
    ) : null;
  return (
    <>
      <Group
        title={t('organization.users')}
        busy={r.isFetching}
        description={t('organization.userHint')}
      >
        {!can.can ? (
          <Denied />
        ) : (
          <>
            <ErrorBox
              error={options.error}
              retry={() => void options.refetch()}
            />
            {!trulyEmpty && r.data ? (
              <div className='flex justify-end'>{addButton}</div>
            ) : null}
            <div id='staff-directory-search'>
              <Search
                value={search}
                onChange={(v) => update('userQ', v)}
                placeholder={t('organization.searchUsers')}
              />
            </div>
            {search ? (
              <Button variant='outline' onClick={() => update('userQ', '')}>
                {t('organization.clear')}
              </Button>
            ) : null}
            {r.error ? (
              <ErrorBox error={r.error} retry={() => void r.refetch()} />
            ) : !r.data ? (
              <LoadingRows />
            ) : r.data.data.length ? (
              <>
                <div className='overflow-x-auto'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {[
                          'name',
                          'email',
                          'status',
                          'directRoles',
                          'actions',
                        ].map((k) => (
                          <TableHead key={k}>
                            {t('organization.' + k)}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {r.data.data.map((u) => (
                        <TableRow key={u.id}>
                          <TableCell>
                            <Truncated>{u.name}</Truncated>
                          </TableCell>
                          <TableCell>
                            <Truncated>{u.email}</Truncated>
                          </TableCell>
                          <TableCell>
                            <StatusBadge
                              tone={u.disabledAt ? 'neutral' : 'success'}
                            >
                              {t(
                                u.disabledAt
                                  ? 'organization.inactive'
                                  : 'organization.active',
                              )}
                            </StatusBadge>
                          </TableCell>
                          <TableCell>
                            <div className='flex flex-wrap gap-2'>
                              {Object.values(u.roleScopes)
                                .flatMap((x) =>
                                  typeof x === 'string' ? [x] : x,
                                )
                                .map((role) =>
                                  roles.can ? (
                                    <Link
                                      key={role}
                                      className='underline underline-offset-4'
                                      to={
                                        '/organization/roles/' +
                                        encodeURIComponent(role)
                                      }
                                    >
                                      {roleLabels.get(role) ?? role}
                                    </Link>
                                  ) : (
                                    <span key={role}>
                                      {roleLabels.get(role) ?? role}
                                    </span>
                                  ),
                                )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <UserActions
                              user={u}
                              busy={w.busy}
                              onStatus={(user) => {
                                w.clearError();
                                setStatusTarget(user);
                              }}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <Paged
                  meta={r.data.meta}
                  onChange={(p) => update('userPage', String(p))}
                />
              </>
            ) : (
              <OrgEmpty
                title={t(
                  search ? 'organization.noResults' : 'organization.noUsers',
                )}
                description={t('organization.userHint')}
                action={trulyEmpty ? addButton : undefined}
              />
            )}
          </>
        )}
      </Group>
      <Confirm
        open={!!statusTarget}
        onOpenChange={(open) => {
          if (!open && !w.busy) {
            setStatusTarget(null);
            restoreUserFocus(statusTarget?.id);
          }
        }}
        title={t(
          statusTarget?.disabledAt
            ? 'organization.enableEmployeeNamed'
            : 'organization.disableEmployeeNamed',
          { name: statusTarget?.name },
        )}
        rich
        destructive={!statusTarget?.disabledAt}
        label={t(
          statusTarget?.disabledAt
            ? 'organization.enable'
            : 'organization.disable',
        )}
        busy={w.busy}
        confirmDisabled={
          w.error instanceof ApiClientError && w.error.status === 404
        }
        onConfirm={() => {
          const target = statusTarget;
          if (!target) return;
          void w
            .run(
              () =>
                target.disabledAt
                  ? w.client.enable(target.id)
                  : w.client.disable(target.id),
              target.disabledAt
                ? 'organization.employeeEnabled'
                : 'organization.employeeDisabled',
              target.name,
            )
            .then((ok) => {
              if (ok) {
                setStatusTarget(null);
                restoreUserFocus(target.id);
              }
            });
        }}
      >
        <>
          <p>
            {t(
              statusTarget?.disabledAt
                ? 'organization.enableEmployeeHint'
                : 'organization.disableEmployeeHint',
            )}
          </p>
          <UserError error={w.error} />
        </>
      </Confirm>
      <Outlet />
    </>
  );
}
