import { useLocation, useParams, useResolvedPath } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { BackButton } from '#components/back-button';
import { useBusinessQuery } from '../hyl/hooks.js';
import { Values, Refresh, BillingError, LoadingRows } from './common.js';
import { scalar } from './helpers.js';
export default function EnergySource() {
  const p = useParams(),
    l = useLocation(),
    path = useResolvedPath('.').pathname,
    { t } = useTranslation(),
    kind = path.split('/').at(-2),
    endpoint = kind === 'asset' ? 'assets' : 'contracts',
    r = useBusinessQuery<{ data: Record<string, unknown> }>(
      endpoint + '/' + p.energySourceId,
    ),
    row = r.data?.data,
    payload = row?.payload as Record<string, unknown> | undefined;
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
          title={scalar(row?.number) || scalar(row?.name) || t('energy.basic')}
          actions={
            <Refresh busy={r.isFetching} onClick={() => void r.refetch()} />
          }
        />
        {r.error ? (
          <BillingError error={r.error} retry={() => void r.refetch()} />
        ) : !row ? (
          <LoadingRows />
        ) : (
          <Values
            values={
              endpoint === 'assets'
                ? { name: row.name, code: row.code, asset: row.pathName }
                : {
                    number: row.number,
                    name: payload?.title,
                    start: payload?.start,
                    end: payload?.end,
                  }
            }
          />
        )}
      </PageContainer>
    </RouteChildPage>
  );
}
