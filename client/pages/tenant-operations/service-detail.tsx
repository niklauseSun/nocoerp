import { Link, Outlet, useLocation, useParams } from 'react-router';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { Button } from '#components/ui/button';
import { LongText } from '#components/long-text';
import { StatusBadge } from '#components/status-badge';
import { useTranslation } from '@nocobase/i18n/client';
import { useBusinessQuery } from '../hyl/hooks.js';
import { LoadingRows, BillingError, Day, Refresh } from '../billing/common.js';
import { RecordedAt } from '../cashier/common.js';
import type {
  ServiceRecord,
  ServiceEvent,
} from '../../../server/tenant-operations/delivery-model.js';
import { useRefreshMissing } from './delivery-hooks.js';
import { Cover, DeliveryStatus } from './delivery-common.js';

export type ServiceDetail = ServiceRecord & {
  merchantName: string;
  events: ServiceEvent[];
  allowedActions: string[];
  completedActions?: string[];
};
export default function ServiceDetailPage() {
  const { serviceId } = useParams(),
    l = useLocation(),
    { t } = useTranslation(),
    r = useBusinessQuery<{ data: ServiceDetail }>(
      'tenantOperations/serviceRecords/' + serviceId,
    ),
    d = r.error ? undefined : r.data?.data;
  useRefreshMissing(r.error);
  return (
    <>
      <Cover
        title={d?.title || t('operations.tenantService')}
        actions={
          <>
            {d?.allowedActions.length ? (
              <div className='flex flex-wrap gap-2'>
                {d.allowedActions.map((action, i) => (
                  <Button
                    key={action}
                    variant={
                      action === 'withdraw'
                        ? 'destructive'
                        : i === 0
                          ? 'default'
                          : 'outline'
                    }
                    nativeButton={false}
                    render={
                      <Link
                        to={{ pathname: 'action/' + action, search: l.search }}
                      />
                    }
                  >
                    {t('operations.' + action)}
                  </Button>
                ))}
              </div>
            ) : null}
            {d?.completedActions?.map((action) => (
              <Button
                key={action}
                variant='outline'
                disabled
                title={t('operations.alreadyCompleted')}
              >
                {t('operations.' + action)} · {t('operations.alreadyCompleted')}
              </Button>
            ))}
            <Refresh busy={r.isFetching} onClick={() => void r.refetch()} />
          </>
        }
      >
        {r.error ? (
          <BillingError error={r.error} retry={() => void r.refetch()} />
        ) : r.isPending ? (
          <LoadingRows />
        ) : d ? (
          <>
            <div className='flex flex-wrap gap-2'>
              <DeliveryStatus status={d.status} />
              <StatusBadge tone='neutral'>
                {t('operations.serviceTypes.' + d.type)}
              </StatusBadge>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>{d.number}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className='grid grid-cols-1 gap-2 text-sm md:grid-cols-[8rem_1fr] md:gap-3'>
                  <dt>{t('operations.tenant')}</dt>
                  <dd className='break-words'>{d.merchantName}</dd>
                  <dt>{t('operations.start')}</dt>
                  <dd>
                    <Day value={d.start} />
                  </dd>
                  <dt>{t('operations.dueDate')}</dt>
                  <dd>
                    <Day value={d.dueDate} />
                  </dd>
                  <dt>{t('operations.assignee')}</dt>
                  <dd className='break-all'>{d.payload.assignee || '—'}</dd>
                  <dt>{t('operations.currentVersion')}</dt>
                  <dd>{d.version}</dd>
                </dl>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t('operations.body')}</CardTitle>
              </CardHeader>
              <CardContent>
                <LongText>{d.body}</LongText>
                {d.payload.notes ? (
                  <LongText>{d.payload.notes}</LongText>
                ) : null}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t('operations.history')}</CardTitle>
              </CardHeader>
              <CardContent className='flex flex-col gap-4'>
                {d.events.map((e) => (
                  <article key={e.id} className='flex flex-col gap-2'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <StatusBadge tone='neutral'>
                        {t('operations.' + e.action)}
                      </StatusBadge>
                      <span className='text-sm text-muted-foreground'>
                        <RecordedAt value={e.createdAt} /> ·{' '}
                        {t('operations.actor')}: {e.actor}
                      </span>
                    </div>
                    <LongText>
                      {typeof e.payload.text === 'string'
                        ? e.payload.text
                        : '—'}
                    </LongText>
                    {e.payload.rating ? (
                      <p>
                        {t('operations.rating')}:{' '}
                        {typeof e.payload.rating === 'number'
                          ? e.payload.rating
                          : '—'}
                      </p>
                    ) : null}
                  </article>
                ))}
              </CardContent>
            </Card>
          </>
        ) : null}
      </Cover>
      <Outlet />
    </>
  );
}
