import { OrgEmpty } from './common.js';
import { useOrg, useSetting } from './hooks.js';
import { Link, Outlet, useLocation } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { Button } from '#components/ui/button';
import type { PermissionSet } from '@nocobase/app-plugin-authorization/client';
import { Group, Denied, ErrorBox, LoadingRows } from './common.js';
export default function Roles() {
  const { t } = useTranslation(),
    l = useLocation(),
    can = useSetting('authorization.permission-sets'),
    create = useSetting('authorization.permission-sets', 'create'),
    r = useOrg<{ data: PermissionSet[] }>(
      'authorization/permissionSets',
      undefined,
      can.can,
    );
  return (
    <>
      <Group
        title={t('organization.roles')}
        description={t('organization.roleHint')}
      >
        {!can.can ? (
          <Denied />
        ) : r.error ? (
          <ErrorBox error={r.error} retry={() => void r.refetch()} />
        ) : !r.data ? (
          <LoadingRows />
        ) : (
          <>
            {r.data.data.map((x) => (
              <Button
                key={x.key}
                variant='ghost'
                className='justify-start whitespace-normal'
                nativeButton={false}
                render={
                  <Link
                    to={{
                      pathname:
                        '/organization/roles/' + encodeURIComponent(x.key),
                      search: l.search,
                    }}
                  />
                }
              >
                {typeof x.title === 'string'
                  ? x.title
                  : x.title
                    ? t(x.title.key, { ns: x.title.ns })
                    : x.key}
              </Button>
            ))}
            {!r.data.data.length ? (
              <OrgEmpty
                title={t('organization.noRoles')}
                description={t('organization.emptyRolesHelp')}
              />
            ) : null}
            {create.can ? (
              <div className='flex justify-end'>
                <Button
                  variant='outline'
                  nativeButton={false}
                  render={
                    <Link
                      to={{
                        pathname: '/organization/roles/new',
                        search: l.search,
                      }}
                    />
                  }
                >
                  {t('organization.newRole')}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </Group>
      <Outlet />
    </>
  );
}
