import { Link } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useBusinessPermission, useBusinessQuery } from '../hooks.js';
import { amountText, type BusinessRow } from '../model.js';
import type { LeaseSummary } from './model.js';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { ErrorPanel } from '../common.js';
export function SettlementDebt({ row }: { row: BusinessRow }) {
  const { t, i18n } = useTranslation(),
    can = useBusinessPermission('contracts', 'depositRead');
  const id = String(row.payload.contractId),
    query = useBusinessQuery<{ data: LeaseSummary }>(
      `contracts/${id}/leaseSummary`,
      undefined,
      can.can && row.status === 'due',
    );
  const settlement = query.data?.data.settlements.find((s) => s.id === row.id);
  if (row.status !== 'due' || !can.can) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t(
            settlement && Number(settlement.debtRemaining) === 0
              ? 'lease.collected'
              : settlement &&
                  Number(settlement.debtRemaining) <
                    -Number(row.amountCents) / 100
                ? 'lease.partialCollection'
                : 'lease.pendingCollection',
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {query.error ? (
          <ErrorPanel error={query.error} />
        ) : settlement ? (
          <>
            <p className='text-xl font-medium tabular-nums'>
              {t('lease.remaining')}：
              {amountText(settlement.debtRemaining, i18n.language)}
            </p>
            <p className='mt-2 text-sm text-muted-foreground'>
              {t('lease.collectionFormula')}
            </p>
            <Link
              className='mt-4 inline-block underline'
              to={`/contracts/${id}`}
            >
              {t('lease.openContract')}
            </Link>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
