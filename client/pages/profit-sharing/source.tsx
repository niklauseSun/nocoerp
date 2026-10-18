import { useCoverFocus } from './focus.js';
import { useLocation, useParams, useResolvedPath } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { BackButton } from '#components/back-button';
import { useBusinessQuery } from '../hyl/hooks.js';
import {
  Group,
  Value,
  Money,
  Refresh,
  LoadingRows,
  BillingError,
} from './common.js';
export default function SplitSource() {
  useCoverFocus();
  const p = useParams(),
    path = useResolvedPath('.').pathname,
    l = useLocation(),
    { t } = useTranslation(),
    kind = path.split('/').at(-2)!,
    id = p.sourceId;
  const endpoint =
    {
      bill: 'bills',
      receipt: 'receipts',
      settlement: 'settlements',
      contract: 'contracts',
    }[kind] ?? 'contracts';
  const result = useBusinessQuery<{
      data: {
        id: string;
        number: string;
        status: string;
        amountCents?: string;
        remainingCents?: string;
        payload: { title?: string; start?: string; end?: string };
      };
    }>(`${endpoint}/${id}`),
    row = result.data?.data;
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
          title={row?.number ?? t('split.sources')}
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
        ) : !row ? (
          <LoadingRows />
        ) : (
          <Group title={t('split.sources')}>
            <dl className='grid gap-3 sm:grid-cols-[8rem_1fr]'>
              <Value label={t('split.fields.number')}>{row.number}</Value>
              <Value label={t('split.fields.status')}>
                {t(
                  `${endpoint === 'bills' || endpoint === 'receipts' ? 'billing.states' : 'hyl.states'}.${row.status}`,
                  { defaultValue: row.status },
                )}
              </Value>
              {row.amountCents ? (
                <Value label={t('split.fields.amountCents')}>
                  <Money cents={row.amountCents} />
                </Value>
              ) : null}
            </dl>
            <p>{t('split.deepHelp')}</p>
          </Group>
        )}
      </PageContainer>
    </RouteChildPage>
  );
}
