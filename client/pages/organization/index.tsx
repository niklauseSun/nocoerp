import { useSetting } from './hooks.js';
import { Link, Navigate, Outlet, useLocation } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import { useCan } from '@nocobase/app-plugin-authorization/client';
export default function Organization() {
  const { t } = useTranslation(),
    l = useLocation(),
    roles = useSetting('authorization.permission-sets'),
    users = useCan({ resource: { type: 'user', id: '*' }, action: 'read' });
  return (
    <PageContainer>
      <PageHeader
        title={t('organization.title')}
        description={t('organization.description')}
      />
      <nav
        className='flex flex-wrap gap-2'
        aria-label={t('organization.sections')}
      >
        {[
          'departments',
          'projects',
          ...(roles.can ? ['roles'] : []),
          ...(users.can ? ['users'] : []),
        ].map((x) => (
          <Button
            key={x}
            variant={l.pathname.includes('/' + x) ? 'secondary' : 'outline'}
            nativeButton={false}
            render={<Link to={'/organization/' + x} />}
          >
            {t('organization.' + x)}
          </Button>
        ))}
      </nav>
      {l.pathname.replace(/\/$/, '').endsWith('/organization') ? (
        <Navigate to='departments' replace />
      ) : (
        <Outlet />
      )}
    </PageContainer>
  );
}
