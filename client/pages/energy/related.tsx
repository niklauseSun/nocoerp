import { EnergyClosingCheck } from './closing-check.js';
import { useEnergyCan, endpoint, scalar } from './helpers.js';
import { Link, useLocation, useResolvedPath, useParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { Button } from '#components/ui/button';
import { useBusinessQuery } from '../hyl/hooks.js';
import {
  Group,
  State,
  Money,
  Day,
  BillingError,
  LoadingRows,
  Truncated,
  type Page,
  type Item,
} from './common.js';
/** Small previews stay scoped to the current record; complete lists own their pagination. */
export function EnergyRelated({
  kind,
  id,
  end,
}: {
  kind: 'asset' | 'contract' | 'bill';
  id?: string;
  end?: string;
}) {
  const { t } = useTranslation(),
    p = useParams(),
    meters = useEnergyCan('meterRead');
  const recordId = id ?? (kind === 'bill' ? p.billId : p.id) ?? '';
  const names =
    kind === 'asset'
      ? ['meters']
      : kind === 'bill'
        ? ['readings']
        : ['meters', 'readings', 'billing'];
  return (
    <Group title={t('energy.title')}>
      <p className='text-sm text-muted-foreground'>{t('energy.description')}</p>
      {names.map((name) => (
        <Preview key={name} name={name} kind={kind} id={recordId} />
      ))}
      {kind === 'contract' && recordId && end && meters.can ? (
        <EnergyClosingCheck contractId={recordId} end={end} />
      ) : null}
    </Group>
  );
}
function Preview({
  name,
  kind,
  id,
}: {
  name: string;
  kind: string;
  id: string;
}) {
  const { t } = useTranslation(),
    l = useLocation(),
    path = useResolvedPath('.').pathname,
    can = useEnergyCan(
      name === 'meters'
        ? 'meterRead'
        : name === 'billing'
          ? 'billGenerate'
          : 'readingRead',
    );
  const rows = useBusinessQuery<Page<Item>>(
    endpoint(name),
    {
      [kind + 'Id']: id,
      pageSize: 10,
      ...(name === 'billing' ? { billingStatus: 'unbilled' } : {}),
    },
    can.can && !!id,
  );
  const suffix =
    name === 'meters'
      ? 'energyMeters'
      : name === 'billing'
        ? 'energyBilling'
        : 'energyReadings';
  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h3 className='font-medium'>{t('energy.' + name)}</h3>
        {can.can ? (
          <Button
            variant='outline'
            nativeButton={false}
            render={
              <Link to={{ pathname: path + '/' + suffix, search: l.search }} />
            }
          >
            {t('energy.viewAll')}
            {rows.data ? ' (' + rows.data.meta.total + ')' : ''}
          </Button>
        ) : null}
      </div>
      {!can.can ? (
        <p>{t('energy.restricted')}</p>
      ) : rows.error ? (
        <BillingError error={rows.error} retry={() => void rows.refetch()} />
      ) : !rows.data ? (
        <LoadingRows />
      ) : !rows.data.data.length ? (
        <p className='text-muted-foreground'>{t('energy.empty')}</p>
      ) : (
        <>
          <p className='text-sm text-muted-foreground'>
            {t('energy.previewLimit')}
          </p>
          {rows.data.data.map((r) => (
            <div
              key={r.id}
              className='flex flex-wrap items-center gap-3 border-b py-2'
            >
              <Link
                className='underline'
                to={{
                  pathname: path + '/' + suffix + '/' + r.id,
                  search: l.search,
                }}
              >
                <Truncated>
                  {name === 'meters' ? scalar(r.code) : r.number}
                </Truncated>
              </Link>
              <State value={r.status} />
              {name === 'meters' ? (
                <Truncated>{scalar(r.assetName)}</Truncated>
              ) : (
                <>
                  <Day value={r.start} />
                  <Day value={r.end} />
                  <Money cents={scalar(r.amountCents) || '0'} />
                </>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
