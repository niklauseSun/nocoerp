import { useLocation, useResolvedPath, useParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { RouteChildPage } from '#components/route-child-page';
import { LongText } from '#components/long-text';
import { useBusinessQuery } from '../hyl/hooks.js';
import { useCoverFocus } from '../profit-sharing/focus.js';
import { str } from './helpers.js';
import { BillingError, LoadingRows, Refresh, Group } from './common.js';
export default function Source() {
  useCoverFocus();
  const { purchaseSourceId } = useParams(),
    path = useResolvedPath('.').pathname,
    l = useLocation(),
    kind = path.split('/').at(-2),
    { t } = useTranslation(),
    result = useBusinessQuery<{ data: Record<string, unknown> }>(
      (kind === 'asset' ? 'assets' : 'repairOrders') + '/' + purchaseSourceId,
    ),
    r = result.data?.data;
  return (
    <RouteChildPage>
      <PageContainer>
        <BackButton
          to={{
            pathname: path.split('/').slice(0, -2).join('/'),
            search: l.search,
          }}
        />
        <PageHeader
          title={str(r?.number) || t('procurement.sources')}
          description={t('procurement.readOnly')}
          actions={
            <Refresh
              busy={result.isFetching}
              onClick={() => void result.refetch()}
            />
          }
        />
        {result.error ? (
          <BillingError
            error={result.error}
            retry={() => void result.refetch()}
          />
        ) : !r ? (
          <LoadingRows />
        ) : (
          <Group
            title={t(
              kind === 'asset' ? 'procurement.asset' : 'procurement.repair',
            )}
          >
            <dl className='grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]'>
              {Object.entries({
                number: r.number,
                title: r.name ?? r.title,
              }).map(([k, v]) => (
                <div key={k} className='contents'>
                  <dt className='text-muted-foreground'>
                    {t('procurement.fields.' + k)}
                  </dt>
                  <dd className='min-w-0 break-words'>
                    <LongText>{str(v) || '—'}</LongText>
                  </dd>
                </div>
              ))}
            </dl>
          </Group>
        )}
      </PageContainer>
    </RouteChildPage>
  );
}
