import { scalar } from '../hyl/model.js';
import { Outlet, useParams, useLocation, useResolvedPath } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { BackButton } from '#components/back-button';
import { LongText } from '#components/long-text';
import { useBusinessQuery } from '../hyl/hooks.js';
import type { LeaseSummary } from '../hyl/lease/model.js';
import type { BusinessRow } from '../hyl/model.js';
import {
  Group,
  Value,
  Day,
  BillingError,
  LoadingRows,
  Refresh,
} from './common.js';
export default function CashierContract() {
  const { id } = useParams(),
    l = useLocation(),
    path = useResolvedPath('.').pathname,
    { t } = useTranslation();
  const summary = useBusinessQuery<{ data: LeaseSummary }>(
    `contracts/${id}/leaseSummary`,
  );
  const result = useBusinessQuery<{ data: BusinessRow }>(`contracts/${id}`),
    row = result.error ? undefined : result.data?.data;
  return (
    <>
      <RouteChildPage>
        <PageContainer>
          <BackButton
            to={{
              pathname: path.replace(/\/contract\/[^/]+$/, ''),
              search: l.search,
            }}
          />
          <PageHeader
            title={row ? scalar(row.number) : t('cashier.fields.contract')}
            actions={
              <>
                {/* Source views are finite read-only leaves; lease operations live at the original contract. */}
                <Refresh
                  busy={result.isFetching || summary.isFetching}
                  onClick={() => {
                    void result.refetch();
                    void summary.refetch();
                  }}
                />
              </>
            }
          />
          {result.error ? (
            <BillingError
              error={result.error}
              retry={() => void result.refetch()}
            />
          ) : !row ? (
            <LoadingRows />
          ) : (
            <>
              <Group title={t('cashier.fields.contract')}>
                <dl className='grid gap-3 sm:grid-cols-[8rem_1fr]'>
                  <Value label={t('hyl.fields.title')}>
                    {scalar(row.payload.title || '—')}
                  </Value>
                  <Value label={t('hyl.fields.start')}>
                    <Day value={scalar(row.payload.start)} />
                  </Value>
                  <Value label={t('hyl.fields.end')}>
                    <Day value={scalar(row.payload.end)} />
                  </Value>
                  <Value label={t('hyl.fields.notes')}>
                    <LongText>{scalar(row.payload.notes || '—')}</LongText>
                  </Value>
                </dl>
              </Group>
              {summary.data ? (
                <Group title={t('cashier.fields.contract')}>
                  <p>{t(`lease.states.${summary.data.data.status}`)}</p>
                </Group>
              ) : summary.error ? (
                <BillingError
                  error={summary.error}
                  retry={() => void summary.refetch()}
                />
              ) : (
                <LoadingRows />
              )}
            </>
          )}
        </PageContainer>
      </RouteChildPage>
      <Outlet />
    </>
  );
}
