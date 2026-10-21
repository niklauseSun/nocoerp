import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useBusinessQuery } from '../hyl/hooks.js';
import { useEnergyCan, scalar } from './helpers.js';
import {
  Group,
  Paged,
  Day,
  Quantity,
  BillingError,
  LoadingRows,
  type Item,
  type Page,
} from './common.js';
/** Managed identity is separate from historical tariff configuration and is never edited here. */
export function ManagedMeters({ contractId }: { contractId: string }) {
  const { t } = useTranslation(),
    can = useEnergyCan('meterRead'),
    [page, setPage] = useState(1),
    rows = useBusinessQuery<Page<Item>>(
      'energyAssignments',
      { contractId, page, pageSize: 20 },
      can.can,
    );
  return (
    <Group title={t('energy.managedMeters')}>
      <p className='text-sm text-muted-foreground'>{t('energy.managedHelp')}</p>
      {!can.can ? (
        <p>{t('energy.restricted')}</p>
      ) : rows.error ? (
        <BillingError error={rows.error} retry={() => void rows.refetch()} />
      ) : !rows.data ? (
        <LoadingRows />
      ) : (
        <>
          {rows.data.data.length ? (
            rows.data.data.map((r) => (
              <div
                key={r.id}
                className='flex flex-wrap items-center gap-3 border-b py-2'
              >
                <span>{scalar(r.meterCode)}</span>
                <span>{t('energy.types.' + scalar(r.feeType))}</span>
                <Day value={r.start} />
                <Day value={r.end} />
                <Quantity value={r.openingReading} />
              </div>
            ))
          ) : (
            <p>{t('energy.empty')}</p>
          )}
          <Paged
            meta={rows.data.meta}
            busy={rows.isFetching}
            onChange={setPage}
          />
        </>
      )}
    </Group>
  );
}
