import { Link } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from '#components/ui/card';
import { Button } from '#components/ui/button';
import { useBusinessPermission, useBusinessQuery } from '../hyl/hooks.js';
import { BillingError, LoadingRows, Money } from './common.js';
import type { Bill, Receipt, ListResponse } from './types.js';
function HomeBillingMetric({ kind }: { kind: 'bills' | 'receipts' }) {
  const { t } = useTranslation(),
    can = useBusinessPermission(
      'contracts',
      kind === 'bills' ? 'billingRead' : 'receiptRead',
    );
  const result = useBusinessQuery<ListResponse<Bill & Receipt>>(
      kind,
      { page: 1, pageSize: 1 },
      can.can,
    ),
    data = result.error ? undefined : result.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t(kind === 'bills' ? 'billing.homeDue' : 'billing.homeUnused')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!can.can ? (
          <p className='text-sm text-muted-foreground'>
            {t('billing.restricted')}
          </p>
        ) : result.error ? (
          <BillingError
            error={result.error}
            retry={() => void result.refetch()}
          />
        ) : !data ? (
          <LoadingRows />
        ) : data.meta.total === 0 ? (
          <p className='text-sm text-muted-foreground'>
            {t(
              kind === 'bills'
                ? 'billing.noBillsHome'
                : 'billing.noReceiptsHome',
            )}
          </p>
        ) : (
          <p className='text-2xl font-semibold'>
            <Money
              value={data.totals[kind === 'bills' ? 'remaining' : 'unused']}
            />
          </p>
        )}
      </CardContent>
      {can.can ? (
        <CardFooter>
          <Button
            nativeButton={false}
            variant='outline'
            render={<Link to={`/billing/${kind}`} />}
          >
            {t('billing.viewAll')}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}
export function HomeBillingCards() {
  return (
    <div className='grid gap-4 sm:grid-cols-2'>
      <HomeBillingMetric kind='bills' />
      <HomeBillingMetric kind='receipts' />
    </div>
  );
}
