import { Link, useLocation, useResolvedPath } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { Button } from '#components/ui/button';
import { useBusinessPermission, useBusinessQuery } from '../hyl/hooks.js';
import { Group, Money, BillingError, LoadingRows } from './common.js';
import type { Order } from './types.js';
export function SplitRelated({
  kind,
  id,
}: {
  kind: 'contract' | 'cashier' | 'settlement';
  id: string;
}) {
  const { t } = useTranslation(),
    l = useLocation(),
    path = useResolvedPath('.').pathname,
    can = useBusinessPermission('contracts', 'splitRead'),
    configure = useBusinessPermission('contracts', 'splitConfigure');
  const result = useBusinessQuery<{ data: Order[]; meta: { total: number } }>(
    'splitOrders',
    {
      ...(kind === 'contract'
        ? { contractId: id }
        : kind === 'cashier'
          ? { cashierOrderId: id }
          : { sourceId: id, sourceKind: 'settlement' }),
      pageSize: 100,
    },
    can.can,
  );
  if (!can.can) return null;
  return (
    <Group title={t('split.title')}>
      {kind === 'contract' && configure.can ? (
        <div className='flex gap-2'>
          <Button
            variant='outline'
            nativeButton={false}
            render={
              <Link
                to={{ pathname: path + '/splitRuleNew', search: l.search }}
              />
            }
          >
            {t('split.newRule')}
          </Button>
          <Button
            variant='outline'
            nativeButton={false}
            render={
              <Link to={{ pathname: path + '/splitRules', search: l.search }} />
            }
          >
            {t('split.rules')}
          </Button>
        </div>
      ) : null}
      {result.error ? (
        <BillingError
          error={result.error}
          retry={() => void result.refetch()}
        />
      ) : !result.data ? (
        <LoadingRows />
      ) : !result.data.data.length ? (
        <p className='text-muted-foreground'>{t('split.empty')}</p>
      ) : (
        result.data.data.map((r) => (
          <div key={r.id} className='flex flex-wrap gap-4'>
            <Link
              className='underline'
              to={{ pathname: path + '/splitOrder/' + r.id, search: l.search }}
            >
              {r.number}
            </Link>
            <span>{t(`split.states.${r.status}`)}</span>
            <span>
              {t('split.fields.remainingCents')}{' '}
              <Money cents={r.remainingCents} />
            </span>
            <span>
              {t('split.fields.recoveryCents')}{' '}
              <Money cents={r.recoveryCents} />
            </span>
          </div>
        ))
      )}
      {(result.data?.meta.total ?? 0) > 100 ? (
        <p>{t('split.limitNotice')}</p>
      ) : null}
    </Group>
  );
}
