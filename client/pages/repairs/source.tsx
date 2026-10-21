import { str } from './helpers.js';
import { useLocation, useResolvedPath, useParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { RouteChildPage } from '#components/route-child-page';
import { useBusinessQuery } from '../hyl/hooks.js';
import { useCoverFocus } from '../profit-sharing/focus.js';
import { BillingError, LoadingRows, Refresh, Day } from './common.js';
export default function RepairSource() {
  useCoverFocus();
  const { repairSourceId } = useParams(),
    path = useResolvedPath('.').pathname,
    l = useLocation(),
    { t } = useTranslation(),
    kind = path.split('/').at(-2),
    endpoint =
      kind === 'asset'
        ? 'assets'
        : kind === 'merchant'
          ? 'merchants'
          : 'contracts',
    r = useBusinessQuery<{ data: Record<string, unknown> }>(
      endpoint + '/' + repairSourceId,
    ),
    row = r.data?.data,
    payload = (row?.payload as Record<string, unknown>) ?? row;
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
          title={str(row?.number) || str(row?.name) || t('repair.sources')}
          description={t('repair.sourceDescription')}
          actions={
            <Refresh busy={r.isFetching} onClick={() => void r.refetch()} />
          }
        />
        {r.error ? (
          <BillingError error={r.error} retry={() => void r.refetch()} />
        ) : !row ? (
          <LoadingRows />
        ) : (
          <>
            <p>{t('repair.readOnly')}</p>
            <dl className='grid gap-3 sm:grid-cols-[8rem_1fr]'>
              {Object.entries({
                name: row.name ?? payload?.name ?? payload?.title,
                number: row.number,
                ...(kind === 'contract'
                  ? {
                      start: <Day value={str(payload?.start)} />,
                      end: <Day value={str(payload?.end)} />,
                    }
                  : {}),
              }).map(([key, value]) => (
                <div key={key} className='contents'>
                  <dt>
                    {t(
                      'repair.fields.' +
                        (key === 'number' ? 'sourceNumber' : key),
                    )}
                  </dt>
                  <dd className='break-words'>
                    {typeof value === 'string'
                      ? value || '—'
                      : (value as React.ReactNode)}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </PageContainer>
    </RouteChildPage>
  );
}
