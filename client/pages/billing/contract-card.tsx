import { Link, useLocation } from 'react-router';
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
import { BillingError, LoadingRows, Money, State } from './common.js';
import type { Summary } from './types.js';
export function BillingContractCard({ id }: { id: string }) {
  const { t } = useTranslation(),
    location = useLocation(),
    read = useBusinessPermission('contracts', 'billingRead'),
    configure = useBusinessPermission('contracts', 'billingConfigure');
  const result = useBusinessQuery<{ data: Summary }>(
      `contracts/${id}/billingSummary`,
      undefined,
      read.can,
    ),
    summary = result.error ? undefined : result.data?.data;
  const link = (path: string, label: string) => (
    <Button
      nativeButton={false}
      variant='outline'
      render={<Link to={{ pathname: path, search: location.search }} />}
    >
      {t(`billing.${label}`)}
    </Button>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('billing.title')}</CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-3'>
        {!read.can ? (
          <p className='text-sm text-muted-foreground'>
            {t('billing.restricted')}
          </p>
        ) : result.error ? (
          <BillingError
            error={result.error}
            retry={() => void result.refetch()}
          />
        ) : !summary ? (
          <LoadingRows />
        ) : (
          <>
            <p className='text-sm'>
              {summary.config
                ? t(`billing.channels.${summary.config.payload.rentChannel}`)
                : t('billing.errors.BILLING_NOT_CONFIGURED')}
            </p>
            <div className='flex flex-wrap gap-4'>
              <span>
                {t('billing.fields.remainingCents')}:{' '}
                <Money value={summary.bills.totals.remaining} />
              </span>
              {summary.receipts ? (
                <span>
                  {t('billing.fields.unusedCents')}:{' '}
                  <Money value={summary.receipts.totals.unused} />
                </span>
              ) : null}
            </div>
            {summary.blockers?.length ? (
              <div className='flex flex-col gap-2'>
                <p className='text-sm font-medium'>
                  {t('billing.warningsMissing')}
                </p>
                {summary.blockers.map((b) => (
                  <p
                    className='text-sm'
                    key={`${b.kind}:${b.id}:${b.date}:${b.feeType ?? ''}:${b.meterCode ?? ''}`}
                  >
                    {b.number} ·{' '}
                    {b.feeType
                      ? t(`billing.fees.${b.feeType}`)
                      : t(`billing.${b.kind}`)}{' '}
                    {b.meterCode ?? ''} · {b.date} — {b.end ?? '—'}
                  </p>
                ))}
              </div>
            ) : null}
            {summary.bills.data.map((b) => (
              <div key={b.id} className='flex flex-wrap items-center gap-3'>
                <Link
                  className='underline'
                  to={{ pathname: `bills/${b.id}`, search: location.search }}
                >
                  {b.number}
                </Link>
                <State value={b.displayStatus} />
                <Money cents={b.remainingCents} />
              </div>
            ))}
            <Link
              className='text-sm underline'
              to={`/billing/bills?contractId=${id}`}
            >
              {t('billing.viewAll')} · {t('billing.bills')}
            </Link>
            {summary.receipts?.data.map((r) => (
              <div key={r.id} className='flex flex-wrap items-center gap-3'>
                <Link
                  className='underline'
                  to={{ pathname: `receipts/${r.id}`, search: location.search }}
                >
                  {r.number}
                </Link>
                <Money cents={r.unusedCents} />
              </div>
            ))}
            {summary.receipts ? (
              <Link
                className='text-sm underline'
                to={`/billing/receipts?contractId=${id}`}
              >
                {t('billing.viewAll')} · {t('billing.receipts')}
              </Link>
            ) : null}
          </>
        )}
      </CardContent>
      {summary?.lease.status !== 'closed' ? (
        <CardFooter className='flex flex-wrap gap-2'>
          {configure.can ? link('billingConfig', 'configure') : null}
          {summary?.allowedActions.includes('billWrite')
            ? link('billingNew', 'generate')
            : null}
          {summary?.allowedActions.includes('receiptReceive')
            ? link('receipts/new', 'newReceipt')
            : null}
        </CardFooter>
      ) : null}
    </Card>
  );
}
