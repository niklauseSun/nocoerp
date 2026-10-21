import { Link, Outlet } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '#components/ui/card';
import { Button } from '#components/ui/button';
import { StatusBadge } from '#components/status-badge';
import { useBusinessQuery } from '../hyl/hooks.js';
import { BillingError, LoadingRows, Refresh } from '../billing/common.js';
import { RecordedAt } from '../cashier/common.js';
import { OperationsNav } from './navigation.js';
import { useDeliveryWrite } from './delivery-hooks.js';
interface State {
  data: {
    canRun: boolean;
    items: {
      type: string;
      status: string;
      path: string;
      checks: {
        id: string;
        createdAt: string;
        payload: { reference: string };
      }[];
    }[];
  };
}
export default function Integrations() {
  const { t } = useTranslation(),
    r = useBusinessQuery<State>('tenantOperations/integrations'),
    w = useDeliveryWrite();
  return (
    <>
      <PageContainer>
        <PageHeader
          title={t('operations.title')}
          description={t('operations.testBoundary')}
          actions={
            <Refresh busy={r.isFetching} onClick={() => void r.refetch()} />
          }
        />
        <OperationsNav view='integrations' />
        {r.error ? (
          <BillingError error={r.error} retry={() => void r.refetch()} />
        ) : r.isPending ? (
          <LoadingRows />
        ) : (
          <div className='grid gap-4 lg:grid-cols-2'>
            {r.data?.data.items.map((item) => (
              <Card key={item.type}>
                <CardHeader>
                  <CardTitle>
                    {t('operations.integrationTypes.' + item.type)}
                  </CardTitle>
                  <CardDescription>
                    {t('operations.integrationNeeds.' + item.type)}
                  </CardDescription>
                </CardHeader>
                <CardContent className='flex flex-col gap-4'>
                  <p className='text-sm'>{t('operations.environment')}</p>
                  <StatusBadge tone='warning'>
                    {t('operations.' + item.status)}
                  </StatusBadge>
                  <p className='text-sm text-muted-foreground'>
                    {t('operations.integrationNeeds.' + item.type)}
                  </p>
                  <div className='flex flex-wrap gap-2'>
                    <Button
                      variant='outline'
                      nativeButton={false}
                      render={<Link to={item.path} />}
                    >
                      {t('operations.existingModule')}
                    </Button>
                    {r.data.data.canRun ? (
                      <Button
                        variant='outline'
                        disabled={w.busy}
                        onClick={() =>
                          void w.write(
                            'tenantOperations/integrations/check',
                            { requestId: crypto.randomUUID(), type: item.type },
                            t('operations.testSaved'),
                          )
                        }
                      >
                        {w.busy
                          ? t('hyl.copy.saving')
                          : t('operations.runTest')}
                      </Button>
                    ) : null}
                  </div>
                  <p className='text-sm font-medium'>
                    {t('operations.testHistory')}
                  </p>
                  {item.checks.length ? (
                    item.checks.map((check) => (
                      <p key={check.id} className='break-all text-sm'>
                        <RecordedAt value={check.createdAt} /> ·{' '}
                        {t('operations.testPassed')} · {check.payload.reference}
                      </p>
                    ))
                  ) : (
                    <p className='text-sm text-muted-foreground'>
                      {t('operations.noTestHistory')}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        {w.error ? <BillingError error={w.error} /> : null}
      </PageContainer>
      <Outlet />
    </>
  );
}
