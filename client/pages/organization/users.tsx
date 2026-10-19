import { OrgEmpty } from './common.js';
import { useOrg, useSetting } from './hooks.js';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import type {
  UsersOptions,
  ManagedUser,
} from '@nocobase/app-plugin-users/client/user-client';
import { Badge } from '#components/ui/badge';
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
} from './common.js';
export default function Users() {
  const { t } = useTranslation(),
    [q, setQ] = useSearchParams(),
    can = useCan({ resource: { type: 'user', id: '*' }, action: 'read' }),
    roles = useSetting('authorization.permission-sets'),
    page = Number(q.get('userPage')) || 1,
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
  return (
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
          <Search
            value={search}
            onChange={(v) => update('userQ', v)}
            placeholder={t('organization.searchUsers')}
          />
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
                      {['name', 'email', 'status', 'directRoles'].map((k) => (
                        <TableHead key={k}>{t('organization.' + k)}</TableHead>
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
                          <Badge variant='secondary'>
                            {t(
                              u.disabledAt
                                ? 'organization.inactive'
                                : 'organization.active',
                            )}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className='flex flex-wrap gap-2'>
                            {Object.values(u.roleScopes)
                              .flatMap((x) => (typeof x === 'string' ? [x] : x))
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
            />
          )}
        </>
      )}
    </Group>
  );
}
