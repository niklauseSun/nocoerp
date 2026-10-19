import { useEffect } from 'react';
import { Spinner } from '#components/ui/spinner';
import { useCoverFocus } from '../profit-sharing/focus.js';
import { useBusinessQuery } from './hooks.js';
import { Link, useLocation, useParams } from 'react-router';
import { useApiClient, useToaster, ApiClientError } from '@nocobase/app-client';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from '@nocobase/i18n/client';
import { RouteChildPage } from '#components/route-child-page';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { Button } from '#components/ui/button';
import { useWork } from '../cashier/work.js';
import {
  State,
  Group,
  BillingError,
  DetailsSkeleton,
  Refresh,
  Day,
  RecordedAt,
  type Todo,
} from './common.js';
export default function Detail() {
  useCoverFocus();
  const { t } = useTranslation(),
    { messageTodoId } = useParams(),
    l = useLocation(),
    api = useApiClient(),
    cache = useQueryClient(),
    toast = useToaster(),
    w = useWork(),
    r = useBusinessQuery<{ data: Todo }>('messageTodos/' + messageTodoId),
    d = r.error ? undefined : r.data?.data;
  useEffect(() => {
    if (r.error instanceof ApiClientError && r.error.status === 404)
      void cache.invalidateQueries({ queryKey: ['hyl', 'messageTodos'] });
  }, [r.error, cache]);
  const retry = async () => {
    w.setBusy(true);
    w.setError(undefined);
    try {
      await api.request({
        path: 'messageTodos/' + messageTodoId + '/retry',
        method: 'POST',
        json: {},
      });
      await cache.invalidateQueries({ queryKey: ['hyl'] });
      toast.show({ title: t('messages.retried') });
    } catch (e) {
      w.fail(e);
    } finally {
      w.setBusy(false);
    }
  };
  return (
    <RouteChildPage>
      <PageContainer>
        <BackButton to={{ pathname: '/messageTodos', search: l.search }} />
        <PageHeader
          title={d ? d.number + ' ' + d.title : t('messages.detail')}
          actions={
            <>
              {d?.canRetry ? (
                <Button
                  aria-busy={w.busy}
                  disabled={w.busy || r.isFetching}
                  onClick={() => void retry()}
                >
                  {w.busy ? <Spinner /> : null}
                  {t('messages.retryDelivery')}
                </Button>
              ) : null}
              {d ? (
                <Button
                  variant='outline'
                  disabled={w.busy || r.isFetching}
                  nativeButton={false}
                  render={<Link to={d.path} />}
                >
                  {t('messages.openSource')}
                </Button>
              ) : null}
              <Refresh busy={r.isFetching} onClick={() => void r.refetch()} />
            </>
          }
        />
        {r.error ? (
          <BillingError error={r.error} retry={() => void r.refetch()} />
        ) : null}
        {w.error ? (
          <BillingError error={w.error} retry={() => void retry()} />
        ) : null}
        {r.isPending ? (
          <DetailsSkeleton />
        ) : d ? (
          <>
            <Group title={t('messages.context')}>
              <dl className='grid gap-4 sm:grid-cols-2'>
                {[
                  ['kind', t('messages.kinds.' + d.kind)],
                  ['reason', t('messages.reasons.' + d.reason)],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    className='grid grid-cols-[8rem_1fr] items-start gap-3'
                  >
                    <dt className='text-sm text-muted-foreground'>
                      {t('messages.' + k)}
                    </dt>
                    <dd>{v}</dd>
                  </div>
                ))}
                <div className='grid grid-cols-[8rem_1fr] items-start gap-3'>
                  <dt className='text-sm text-muted-foreground'>
                    {t('messages.status')}
                  </dt>
                  <dd>
                    <State value={d.status} />
                  </dd>
                </div>
                <div className='grid grid-cols-[8rem_1fr] items-start gap-3'>
                  <dt className='text-sm text-muted-foreground'>
                    {t('messages.dueOn')}
                  </dt>
                  <dd>
                    <Day value={d.dueOn} />
                  </dd>
                </div>
              </dl>
              <p className='text-sm text-muted-foreground'>
                {t('messages.readHint')}
              </p>
            </Group>
            <Group title={t('messages.delivery')}>
              <dl className='grid gap-4 sm:grid-cols-2'>
                <div className='grid grid-cols-[8rem_1fr] items-start gap-3'>
                  <dt className='text-sm text-muted-foreground'>
                    {t('messages.deliveryStatus')}
                  </dt>
                  <dd>
                    <State value={d.deliveryStatus} />
                  </dd>
                </div>
                <div className='grid grid-cols-[8rem_1fr] items-start gap-3'>
                  <dt className='text-sm text-muted-foreground'>
                    {t('messages.generation')}
                  </dt>
                  <dd>{d.generation}</dd>
                </div>
                <div className='grid grid-cols-[8rem_1fr] items-start gap-3'>
                  <dt className='text-sm text-muted-foreground'>
                    {t('messages.createdAt')}
                  </dt>
                  <dd>
                    <RecordedAt value={d.createdAt} />
                  </dd>
                </div>
                <div className='grid grid-cols-[8rem_1fr] items-start gap-3'>
                  <dt className='text-sm text-muted-foreground'>
                    {t('messages.updatedAt')}
                  </dt>
                  <dd>
                    <RecordedAt value={d.updatedAt} />
                  </dd>
                </div>
              </dl>
              <p className='text-sm text-muted-foreground'>
                {t('messages.deliveryHint')}
              </p>
            </Group>
          </>
        ) : null}
      </PageContainer>
    </RouteChildPage>
  );
}
