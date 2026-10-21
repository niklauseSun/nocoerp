import { RepairPhotoPreview } from './photos.js';
import RepairProcurement from '../procurement/repair-preview.js';
import { Related } from '../inspections/related.js';
import { str } from './helpers.js';
import { useEffect } from 'react';
import {
  Link,
  Outlet,
  useLocation,
  useResolvedPath,
  useParams,
  useSearchParams,
} from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { RouteChildPage } from '#components/route-child-page';
import { Button } from '#components/ui/button';
import { LongText } from '#components/long-text';
import { useBusinessQuery } from '../hyl/hooks.js';
import { useCoverFocus } from '../profit-sharing/focus.js';
import {
  Group,
  RepairState,
  Refresh,
  BillingError,
  LoadingRows,
  Paged,
  Money,
  Day,
  RecordedAt,
  type Order,
} from './common.js';
export default function RepairDetail({
  inspectionLinks = true,
}: { inspectionLinks?: boolean } = {}) {
  useCoverFocus();
  const { repairId } = useParams(),
    { t } = useTranslation(),
    l = useLocation(),
    path = useResolvedPath('.').pathname,
    [q, setQ] = useSearchParams(),
    cache = useQueryClient(),
    eventPage = Number(q.get('repairEventPage')) || 1,
    result = useBusinessQuery<{ data: Order }>('repairOrders/' + repairId, {
      eventPage,
    }),
    r = result.isPlaceholderData ? undefined : result.data?.data;
  useEffect(() => {
    if (result.error instanceof ApiClientError && result.error.status === 404)
      void cache.invalidateQueries({ queryKey: ['hyl', 'repairOrders'] });
  }, [result.error, cache]);
  const backSearch = new URLSearchParams(l.search);
  backSearch.delete('repairEventPage');
  const next = ['assign', 'start', 'complete', 'accept', 'close', 'edit'].find(
    (a) => r?.allowedActions.includes(a),
  );
  return (
    <RouteChildPage>
      <PageContainer>
        <BackButton
          to={{
            pathname: inspectionLinks
              ? path.slice(0, path.lastIndexOf('/'))
              : path.slice(0, path.lastIndexOf('/repair/')),
            search: backSearch.toString(),
          }}
        />
        <PageHeader
          title={r ? r.number + ' · ' + r.title : t('repair.title')}
          description={t('repair.description')}
          actions={
            <>
              {r?.allowedActions.map((action) => (
                <Button
                  key={action}
                  variant={action === next ? 'default' : 'outline'}
                  disabled={r.blockedActions.includes(action)}
                  title={
                    r.blockedActions.includes(action)
                      ? r.blockedReasons?.[action]
                        ? t('procurement.errors.' + r.blockedReasons[action])
                        : t('repair.assigneeOnly')
                      : undefined
                  }
                  nativeButton={r.blockedActions.includes(action)}
                  render={
                    r.blockedActions.includes(action) ? undefined : (
                      <Link
                        to={{ pathname: path + '/' + action, search: l.search }}
                      />
                    )
                  }
                >
                  {t('repair.actions.' + action)}
                </Button>
              ))}
              <Refresh
                busy={result.isFetching}
                onClick={() => void result.refetch()}
              />
            </>
          }
        />
        {result.error ? (
          <BillingError
            error={result.error}
            retry={() => void result.refetch()}
          />
        ) : !r ? (
          <LoadingRows />
        ) : (
          <>
            <div className='flex flex-wrap items-center gap-2'>
              <RepairState value={r.status} />
              {r.overdue ? <span>{t('repair.overdue')}</span> : null}
              {['closed', 'cancelled'].includes(r.status) ? (
                <p className='text-muted-foreground'>{t('repair.terminal')}</p>
              ) : null}
              {Object.entries(r.blockedReasons ?? {})
                .filter(([a]) => r.allowedActions.includes(a))
                .map(([a, reason]) => (
                  <p key={a} className='text-sm text-muted-foreground'>
                    {t('repair.actions.' + a)}：
                    {t('procurement.errors.' + reason)}
                  </p>
                ))}
              {r.allowedActions.some(
                (a) => r.blockedActions.includes(a) && !r.blockedReasons?.[a],
              ) ? (
                <p className='text-muted-foreground'>
                  {t('repair.assigneeOnly')}
                </p>
              ) : null}
            </div>
            <Group title={t('repair.basic')}>
              <dl className='grid gap-3 sm:grid-cols-[8rem_1fr]'>
                {Object.entries({
                  category: t('repair.categories.' + r.category),
                  priority: t('repair.priorities.' + r.priority),
                  occurredOn: <Day value={r.occurredOn} />,
                  dueOn: <Day value={r.dueOn} />,
                  reporterName: r.payload.reporterName,
                  reporterPhone: r.payload.reporterPhone,
                  location: r.payload.location,
                  assigneeName: r.payload.assigneeName,
                  createdAt: <RecordedAt value={r.createdAt} />,
                  updatedAt: <RecordedAt value={r.updatedAt} />,
                }).map(([key, v]) => (
                  <div className='contents' key={key}>
                    <dt className='text-muted-foreground'>
                      {t('repair.fields.' + key)}
                    </dt>
                    <dd className='min-w-0 whitespace-pre-wrap break-words'>
                      {typeof v === 'string'
                        ? v || '—'
                        : (v as React.ReactNode)}
                    </dd>
                  </div>
                ))}
              </dl>
              {['description', 'evidence'].map((key) => (
                <div key={key}>
                  <h3 className='font-medium'>{t('repair.fields.' + key)}</h3>
                  {str(r.payload[key]) ? (
                    <LongText>{str(r.payload[key])}</LongText>
                  ) : (
                    '—'
                  )}
                </div>
              ))}
            </Group>
            <Group title={t('repair.sources')}>
              <div className='flex flex-wrap gap-3'>
                {[
                  ['asset', r.assetId, r.payload.assetName],
                  ['merchant', r.merchantId, r.payload.merchantName],
                  ['contract', r.contractId, r.payload.contractNumber],
                ].map(([kind, id, name]) =>
                  str(id) ? (
                    <Link
                      key={str(kind)}
                      className='underline'
                      to={{
                        pathname: path + '/' + str(kind) + '/' + str(id),
                        search: l.search,
                      }}
                    >
                      {str(name) || t('repair.recordMissing')}
                    </Link>
                  ) : null,
                )}
              </div>
            </Group>
            <Group title={t('repair.processing')}>
              <p className='text-muted-foreground'>
                {t('repair.recordedCost')}
              </p>
              <div className='flex flex-wrap gap-3'>
                <span>{t('repair.fields.costCents')}</span>
                <Money cents={r.costCents} />
              </div>
              {[
                'result',
                'completionEvidence',
                'lastReturnReason',
                'acceptance',
                'closure',
                'cancellation',
              ]
                .filter((k) => str(r.payload[k]))
                .map((key) => (
                  <div key={key}>
                    <h3 className='font-medium'>{t('repair.fields.' + key)}</h3>
                    <LongText>{str(r.payload[key])}</LongText>
                  </div>
                ))}
            </Group>
            <Group title={t('repair.photos.title')}>
              {(['report', 'processing', 'acceptance'] as const).map(
                (stage) => (
                  <div key={stage} className='flex flex-col gap-2'>
                    <h3 className='font-medium'>
                      {t('repair.photos.' + stage)}
                    </h3>
                    <RepairPhotoPreview files={r.photos?.[stage] ?? []} />
                  </div>
                ),
              )}
            </Group>
            {inspectionLinks ? <RepairProcurement id={repairId!} /> : null}
            {inspectionLinks ? (
              <Related kind='issues' scope='repair' id={repairId!} />
            ) : null}
            <Group title={t('repair.history')}>
              {r.events?.data.map((e) => (
                <div key={e.id} className='flex flex-col gap-2 border-b pb-4'>
                  <div className='flex flex-wrap gap-3'>
                    <span className='font-medium'>
                      {t('repair.actions.' + e.action)}
                    </span>
                    <span>{str(e.payload.actorName) || '—'}</span>
                    <RecordedAt value={e.createdAt} />
                  </div>
                  <div className='flex flex-wrap gap-2'>
                    {e.fromState ? (
                      <>
                        <RepairState value={e.fromState} />
                        <span aria-hidden>→</span>
                      </>
                    ) : null}
                    <RepairState value={e.toState} />
                  </div>
                  {['assign', 'reassign'].includes(e.action) ? (
                    <p>
                      {t('repair.fields.assigneeName')}:{' '}
                      {str(e.payload.assigneeName) || '—'} ·{' '}
                      {t('repair.fields.dueOn')}:{' '}
                      <Day value={str(e.payload.dueOn)} />
                    </p>
                  ) : null}
                  {str(e.payload.note) ? (
                    <LongText>{str(e.payload.note)}</LongText>
                  ) : null}
                  {str(e.payload.evidence) ? (
                    <LongText>{str(e.payload.evidence)}</LongText>
                  ) : null}
                  {e.photos?.length ? (
                    <RepairPhotoPreview files={e.photos} />
                  ) : null}
                  {e.action === 'complete' ? (
                    <Money value={str(e.payload.cost)} />
                  ) : null}
                </div>
              ))}
              {r.events ? (
                <Paged
                  meta={r.events.meta}
                  busy={result.isFetching}
                  onChange={(page) => {
                    const n = new URLSearchParams(q);
                    n.set('repairEventPage', String(page));
                    setQ(n);
                  }}
                />
              ) : null}
            </Group>
          </>
        )}
        <Outlet />
      </PageContainer>
    </RouteChildPage>
  );
}
