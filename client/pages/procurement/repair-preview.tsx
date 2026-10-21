import { Link, useLocation, useResolvedPath } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useBusinessQuery } from '../hyl/hooks.js';
import { useProcurementCan } from './helpers.js';
import {
  Group,
  State,
  BillingError,
  LoadingRows,
  type Page,
  type Row,
} from './common.js';
export default function RepairPreview({ id }: { id: string }) {
  const { t } = useTranslation(),
    read = useProcurementCan('read'),
    path = useResolvedPath('.').pathname,
    l = useLocation(),
    result = useBusinessQuery<Page<Row>>(
      'purchaseRequests',
      { repairId: id, pageSize: 10 },
      read.can,
    );
  return (
    <Group title={t('procurement.title')}>
      {!read.can ? (
        <p className='text-muted-foreground'>{t('procurement.noAccess')}</p>
      ) : result.error ? (
        <BillingError
          error={result.error}
          retry={() => void result.refetch()}
        />
      ) : !result.data ? (
        <LoadingRows />
      ) : (
        <>
          {result.data.data.length ? (
            result.data.data.map((r) => (
              <p key={r.id}>
                <Link
                  className='underline'
                  to={{
                    pathname: path + '/procurement/' + r.id,
                    search: l.search,
                  }}
                >
                  {r.number + ' · ' + r.title}
                </Link>{' '}
                · <State value={r.status} />
              </p>
            ))
          ) : (
            <p className='text-muted-foreground'>
              {t('procurement.empty.requests')}
            </p>
          )}
          <Link
            className='underline'
            to={{ pathname: path + '/procurement', search: l.search }}
          >
            {t('procurement.viewAll')}
          </Link>
        </>
      )}
      <p className='text-sm text-muted-foreground'>
        {t('procurement.ledgerHelp')}
      </p>
    </Group>
  );
}
