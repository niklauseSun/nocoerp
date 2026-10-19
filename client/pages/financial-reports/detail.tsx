import { useCoverFocus } from '../profit-sharing/focus.js';
import { SourceSkeleton } from './loading.js';
import { FinanceError } from './error.js';
import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { RouteDrawer } from '#components/route-drawer';
import { useRouteOverlay } from '#components/use-route-overlay';
import { Button } from '#components/ui/button';
import { Money, Day } from '../billing/common.js';
import { RecordedAt } from '../cashier/common.js';
import { useReport } from './hooks.js';
import type { Line } from './types.js';
function Close() {
  const { close } = useRouteOverlay(),
    { t } = useTranslation();
  return (
    <Button variant='outline' onClick={() => void close()}>
      {t('finance.close')}
    </Button>
  );
}
export default function Source() {
  useCoverFocus();
  const { kind, sourceId } = useParams(),
    [q] = useSearchParams(),
    { t } = useTranslation(),
    cache = useQueryClient(),
    r = useReport<{ data: Line & { generatedAt: string } }>(
      'financialReports/' + kind + '/' + encodeURIComponent(sourceId || ''),
      Object.fromEntries(q.entries()),
    ),
    d = r.error ? undefined : r.data?.data;
  useEffect(() => {
    if (
      r.error instanceof ApiClientError &&
      [403, 404].includes(r.error.status)
    )
      void cache.invalidateQueries({
        queryKey: ['finance', 'financialReports'],
      });
  }, [r.error, cache]);
  const fields = [
    'type',
    'title',
    'partyName',
    'contractId',
    'projectId',
    'at',
    'date',
    'reference',
    'amountCents',
    ...(kind === 'receivable' || kind === 'payable'
      ? ['appliedCents', 'remainingCents']
      : []),
    ...(kind === 'deposit'
      ? ['openingCents', 'movementCents', 'closingCents']
      : []),
    'generatedAt',
  ];
  return (
    <RouteDrawer title={d?.number || t('finance.source')} footer={<Close />}>
      {r.error ? (
        <FinanceError error={r.error} retry={() => void r.refetch()} />
      ) : r.isPending ? (
        <SourceSkeleton />
      ) : d ? (
        <dl className='grid grid-cols-[8rem_1fr] gap-4'>
          {fields.map((k) => (
            <div key={k} className='contents'>
              <dt className='text-sm text-muted-foreground'>
                {t('finance.columns.' + k)}
              </dt>
              <dd className='min-w-0 whitespace-pre-wrap break-words text-sm'>
                {k.endsWith('Cents') ? (
                  <Money cents={String(d[k as keyof Line])} />
                ) : k === 'at' || k === 'generatedAt' ? (
                  <RecordedAt value={String(d[k as keyof typeof d])} />
                ) : k === 'date' ? (
                  <Day value={d.date} />
                ) : k === 'type' ? (
                  t('finance.types.' + d.type)
                ) : k === 'title' && kind === 'event' ? (
                  t('finance.events.' + d.title.replace(':', '_'))
                ) : (
                  String(d[k as keyof Line] || '—')
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </RouteDrawer>
  );
}
