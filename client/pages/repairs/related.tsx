import { useRepairCan } from './helpers.js';
import { Link, useLocation, useResolvedPath } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { Button } from '#components/ui/button';
import { useBusinessQuery } from '../hyl/hooks.js';
import {
  Group,
  RepairState,
  BillingError,
  LoadingRows,
  Truncated,
  type Page,
  type Order,
} from './common.js';
export function RepairRelated({
  kind,
  id,
}: {
  kind: 'asset' | 'merchant' | 'contract';
  id: string;
}) {
  const { t } = useTranslation(),
    l = useLocation(),
    path = useResolvedPath('.').pathname,
    can = useRepairCan('read'),
    rows = useBusinessQuery<Page<Order>>(
      'repairOrders',
      { [kind + 'Id']: id, pageSize: 10 },
      can.can && !!id,
    );
  return (
    <Group title={t('repair.title')}>
      {!can.can ? (
        <p>{t('repair.restricted')}</p>
      ) : rows.error ? (
        <BillingError error={rows.error} retry={() => void rows.refetch()} />
      ) : !rows.data ? (
        <LoadingRows />
      ) : (
        <>
          <Button
            variant='outline'
            nativeButton={false}
            render={
              <Link
                to={{ pathname: path + '/repairOrders', search: l.search }}
              />
            }
          >
            {t('repair.allOrders')} ({rows.data.meta.total})
          </Button>
          {rows.data.data.length ? (
            <>
              <p className='text-sm text-muted-foreground'>
                {t('repair.previewLimit')}
              </p>
              {rows.data.data.map((r) => (
                <div key={r.id} className='flex flex-wrap gap-3 border-b py-2'>
                  <Link
                    className='underline'
                    to={{
                      pathname: path + '/repairOrders/' + r.id,
                      search: l.search,
                    }}
                  >
                    {r.number}
                  </Link>
                  <Truncated>{r.title}</Truncated>
                  <RepairState value={r.status} />
                </div>
              ))}
            </>
          ) : (
            <p className='text-muted-foreground'>{t('repair.empty')}</p>
          )}
        </>
      )}
    </Group>
  );
}
