import { Link, useLocation, useResolvedPath } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { Button } from '#components/ui/button';
import { useBusinessQuery, useBusinessPermission } from '../hyl/hooks.js';
import {
  Group,
  Money,
  BillingError,
  LoadingRows,
  Truncated,
} from './common.js';
import type { Source, Invoice, Page } from './types.js';
export function InvoiceRelated({
  kind,
  id,
}: {
  kind:
    | 'contractId'
    | 'billId'
    | 'receiptId'
    | 'cashierOrderId'
    | 'cashierRefundId';
  id: string;
}) {
  const { t } = useTranslation(),
    l = useLocation(),
    path = useResolvedPath('.').pathname,
    can = useBusinessPermission('contracts', 'invoiceRead'),
    config = useBusinessPermission('contracts', 'invoiceConfigure'),
    sources = useBusinessQuery<Page<Source>>(
      'invoiceSources',
      { [kind]: id, pageSize: 10 },
      can.can,
    ),
    invoices = useBusinessQuery<Page<Invoice>>(
      'invoices',
      { [kind]: id, pageSize: 10 },
      can.can,
    );
  if (!can.can)
    return (
      <Group title={t('invoice.title')}>
        <p>{t('invoice.restricted')}</p>
      </Group>
    );
  return (
    <Group title={t('invoice.title')}>
      <p className='text-sm text-muted-foreground'>{t('invoice.simulated')}</p>
      {sources.error || invoices.error ? (
        <BillingError
          error={sources.error ?? invoices.error}
          retry={() => {
            void sources.refetch();
            void invoices.refetch();
          }}
        />
      ) : !sources.data || !invoices.data ? (
        <LoadingRows />
      ) : (
        <>
          {sources.data.data.map((s) => (
            <div key={s.id} className='flex flex-wrap gap-3'>
              <Link
                className='underline'
                to={{
                  pathname: path + '/invoiceSources/' + s.id,
                  search: l.search,
                }}
              >
                <Truncated>{s.number}</Truncated>
              </Link>
              <span>
                {t('invoice.fields.availableCents')}:{' '}
                <Money cents={s.availableCents} />
              </span>
              <span>
                {t('invoice.fields.requiredRedCents')}:{' '}
                <Money cents={s.requiredRedCents} />
              </span>
            </div>
          ))}
          {invoices.data.data.map((r) => (
            <div key={r.id} className='flex flex-wrap gap-3'>
              <Link
                className='underline'
                to={{ pathname: path + '/invoice/' + r.id, search: l.search }}
              >
                <Truncated>{r.number}</Truncated>
              </Link>
              <Money cents={r.grossCents} />
            </div>
          ))}
          {!sources.data.meta.total && !invoices.data.meta.total ? (
            <p>{t('invoice.empty')}</p>
          ) : null}
        </>
      )}
      <div className='flex flex-wrap gap-2'>
        {['invoiceSources', 'invoices'].map((k, i) => (
          <Button
            key={k}
            variant='outline'
            nativeButton={false}
            render={
              <Link to={{ pathname: path + '/' + k, search: l.search }} />
            }
          >
            {t('invoice.viewAll')} ·{' '}
            {t(i ? 'invoice.invoices' : 'invoice.sources')}
          </Button>
        ))}
        {kind === 'contractId' && config.can ? (
          <Button
            variant='outline'
            nativeButton={false}
            render={
              <Link
                to={{ pathname: path + '/invoiceConfig', search: l.search }}
              />
            }
          >
            {t('invoice.configuration')}
          </Button>
        ) : null}
      </div>
    </Group>
  );
}
