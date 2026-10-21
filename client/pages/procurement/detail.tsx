import { ApprovalPanel } from '../approvals/panel.js';
import { endpoint, useProcurementCan, str } from './helpers.js';
import { useEffect } from 'react';
import {
  Link,
  Outlet,
  useLocation,
  useParams,
  useResolvedPath,
  useSearchParams,
} from 'react-router';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { RouteChildPage } from '#components/route-child-page';
import { Button } from '#components/ui/button';
import { LongText } from '#components/long-text';
import {
  Table,
  TableBody,
  TableHeader,
  TableRow,
  TableHead,
  TableCell,
} from '#components/ui/table';
import { useBusinessQuery } from '../hyl/hooks.js';
import { useCoverFocus } from '../profit-sharing/focus.js';
import {
  State,
  Group,
  Money,
  Day,
  RecordedAt,
  Refresh,
  BillingError,
  LoadingRows,
  Paged,
  type Row,
  type Kind,
  type Page,
  type Item,
} from './common.js';
export default function Detail({
  kind,
  readOnly = false,
}: {
  kind: Kind;
  readOnly?: boolean;
}) {
  useCoverFocus();
  const { t } = useTranslation(),
    p = useParams(),
    id = p['purchase' + kind + 'Id'],
    path = useResolvedPath('.').pathname,
    l = useLocation(),
    [q, setQ] = useSearchParams(),
    cache = useQueryClient(),
    fetching = useIsFetching({ queryKey: ['hyl'] }),
    historyKey = 'purchaseHistory' + kind;
  const result = useBusinessQuery<{ data: Row }>(endpoint(kind) + '/' + id, {
      eventPage: Number(q.get(historyKey)) || 1,
    }),
    r = result.isPlaceholderData ? undefined : result.data?.data,
    finance = useProcurementCan('financeRead');
  useEffect(() => {
    if (result.error instanceof ApiClientError && result.error.status === 404)
      void cache.invalidateQueries({ queryKey: ['hyl', endpoint(kind)] });
  }, [result.error, cache, kind]);
  const next = [
    'submit',
    'approve',
    'convert',
    'issue',
    'newReceipt',
    'pay',
    'settle',
    'accept',
    'activate',
    'edit',
  ].find((a) => r?.allowedActions.includes(a) && !r.blockedActions[a]);
  const backQ = new URLSearchParams(q);
  backQ.delete(historyKey);
  const relatedKind: Kind | undefined =
    kind === 'suppliers'
      ? 'orders'
      : kind === 'requests'
        ? 'orders'
        : undefined;
  const related = useBusinessQuery<Page<Row>>(
    endpoint(relatedKind ?? 'orders'),
    {
      ...(kind === 'suppliers'
        ? { supplierId: id ?? '' }
        : { requestId: id ?? '' }),
      pageSize: 10,
    },
    !!r && !readOnly && !!relatedKind,
  );
  const link = (suffix: string, label: string) => (
    <Link
      className='underline'
      to={{ pathname: path + '/' + suffix, search: l.search }}
    >
      {label}
    </Link>
  );
  return (
    <RouteChildPage>
      <PageContainer>
        <BackButton
          to={{
            pathname: readOnly
              ? path.slice(0, path.lastIndexOf('/source/'))
              : ['receipts', 'payments', 'ledger'].includes(kind) &&
                  p.purchaseordersId
                ? path.slice(0, path.lastIndexOf('/' + kind + '/'))
                : kind === 'orders' && path.includes('/related/')
                  ? path.slice(0, path.lastIndexOf('/related/'))
                  : path.slice(0, path.lastIndexOf('/')),
            search: backQ.toString(),
          }}
        />
        <PageHeader
          title={r ? r.number + ' · ' + r.title : t('procurement.' + kind)}
          description={t(
            readOnly ? 'procurement.readOnly' : 'procurement.description',
          )}
          actions={
            <>
              {!readOnly
                ? r?.allowedActions.map((a) => (
                    <Button
                      key={a}
                      variant={a === next ? 'default' : 'outline'}
                      disabled={!!r.blockedActions[a]}
                      nativeButton={!!r.blockedActions[a]}
                      render={
                        r.blockedActions[a] ? undefined : (
                          <Link
                            to={{ pathname: path + '/' + a, search: l.search }}
                          />
                        )
                      }
                    >
                      {t('procurement.actions.' + a)}
                    </Button>
                  ))
                : null}
              <Refresh
                busy={fetching > 0}
                onClick={() =>
                  void cache.invalidateQueries({ queryKey: ['hyl'] })
                }
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
            {kind === 'requests' && !readOnly ? (
              <ApprovalPanel kind='purchases' id={r.id} />
            ) : null}
            {Object.entries(r.blockedActions).map(([a, reason]) => (
              <p key={a} className='text-sm text-muted-foreground'>
                {t('procurement.actions.' + a)}：
                {t('procurement.errors.' + reason)}
              </p>
            ))}
            <Group title={t('procurement.record')}>
              <dl className='grid gap-3'>
                {[
                  ['number', r.number],
                  ...(kind === 'ledger'
                    ? [['type', t('procurement.ledgerTypes.' + r.type)]]
                    : []),
                  ['status', <State key='status' value={r.status} />],
                  ['title', r.title],
                  ['assetName', r.payload.assetName],
                  ['supplierName', r.payload.supplierName],
                  ['day', <Day key='day' value={r.day} />],
                  ...[
                    'contact',
                    'phone',
                    'address',
                    'supplyScope',
                    'taxNumber',
                    'qualificationUntil',
                    'neededOn',
                    'reference',
                    'channel',
                    'evidence',
                    'notes',
                    'reason',
                    'lastDecision',
                    'reversalNote',
                  ]
                    .filter((k) => r.payload[k])
                    .map((k) => [
                      k,
                      k === 'channel'
                        ? t('procurement.channels.' + str(r.payload[k]))
                        : r.payload[k],
                    ]),
                ].map(([key, value]) => (
                  <div
                    key={String(key)}
                    className='grid gap-1 sm:grid-cols-[8rem_minmax(0,1fr)]'
                  >
                    <dt className='text-muted-foreground'>
                      {t('procurement.fields.' + str(key))}
                    </dt>
                    <dd className='min-w-0 break-words'>
                      {typeof value === 'string' ? (
                        <LongText>{value || '—'}</LongText>
                      ) : (
                        (value as React.ReactNode)
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </Group>
            {kind !== 'suppliers' ? (
              <Group title={t('procurement.amounts')}>
                <div className='grid gap-4 sm:grid-cols-4'>
                  {[
                    'amountCents',
                    ...(kind === 'orders'
                      ? ['acceptedCents', 'paidCents', 'outstandingCents']
                      : []),
                  ].map((k) => (
                    <div key={k}>
                      <p className='text-sm text-muted-foreground'>
                        {t('procurement.fields.' + k)}
                      </p>
                      <Money cents={str(r[k as keyof Row])} />
                    </div>
                  ))}
                </div>
                <p className='text-sm text-muted-foreground'>
                  {t('procurement.ledgerHelp')}
                </p>
              </Group>
            ) : null}
            {Array.isArray(r.payload.items) ? (
              <Group title={t('procurement.items')}>
                <div className='overflow-x-auto'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {[
                          'name',
                          'spec',
                          'unit',
                          'quantity',
                          ...(kind === 'orders' ? ['accepted'] : []),
                          'unitPrice',
                          'amountCents',
                        ].map((k) => (
                          <TableHead key={k}>
                            {t('procurement.fields.' + k)}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(r.payload.items as Item[]).map((i) => (
                        <TableRow key={i.id}>
                          <TableCell>{i.name}</TableCell>
                          <TableCell>{i.spec || '—'}</TableCell>
                          <TableCell>{i.unit}</TableCell>
                          <TableCell>{i.quantity}</TableCell>
                          {kind === 'orders' ? (
                            <TableCell>
                              {Number(
                                (
                                  r.payload.received as Record<string, number>
                                )?.[i.id] ?? 0,
                              )}
                            </TableCell>
                          ) : null}
                          <TableCell>
                            <Money cents={i.unitPriceCents} />
                          </TableCell>
                          <TableCell>
                            <Money cents={i.lineCents} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Group>
            ) : null}
            {Array.isArray(r.payload.lines) ? (
              <Group title={t('procurement.items')}>
                <div className='overflow-x-auto'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {[
                          'name',
                          'delivered',
                          'accepted',
                          'rejected',
                          'amountCents',
                        ].map((k) => (
                          <TableHead key={k}>
                            {t('procurement.fields.' + k)}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(
                        r.payload.lines as {
                          itemId: string;
                          name: string;
                          delivered: number;
                          accepted: number;
                          lineCents: string;
                        }[]
                      ).map((i) => (
                        <TableRow key={i.itemId}>
                          <TableCell>{i.name}</TableCell>
                          <TableCell>{i.delivered}</TableCell>
                          <TableCell>{i.accepted}</TableCell>
                          <TableCell>{i.delivered - i.accepted}</TableCell>
                          <TableCell>
                            <Money cents={i.lineCents} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Group>
            ) : null}
            {!readOnly ? (
              <Group title={t('procurement.sources')}>
                <div className='flex flex-wrap gap-3'>
                  {kind === 'ledger' && r.sourceId
                    ? link(
                        'source/' +
                          (r.type === 'accrual' ? 'receipt/' : 'payment/') +
                          r.sourceId,
                        t(
                          'procurement.' +
                            (r.type === 'accrual' ? 'receipts' : 'payments'),
                        ),
                      )
                    : null}
                  {r.requestId
                    ? link(
                        'source/request/' + r.requestId,
                        str(r.payload.requestNumber) ||
                          t('procurement.requests'),
                      )
                    : null}
                  {r.orderId
                    ? link(
                        'source/order/' + r.orderId,
                        str(r.payload.orderNumber) || t('procurement.orders'),
                      )
                    : null}
                  {r.supplierId
                    ? link(
                        'source/supplier/' + r.supplierId,
                        str(r.payload.supplierName) ||
                          t('procurement.suppliers'),
                      )
                    : null}
                  {r.repairId ? (
                    <Link
                      className='underline'
                      to={{
                        pathname: path + '/repair/' + r.repairId,
                        search: l.search,
                      }}
                    >
                      {t('procurement.repair')}
                    </Link>
                  ) : null}
                  <Link
                    className='underline'
                    to={{
                      pathname: path + '/asset/' + r.assetId,
                      search: l.search,
                    }}
                  >
                    {t('procurement.asset')}
                  </Link>
                </div>
              </Group>
            ) : null}
            {!readOnly && kind === 'orders' ? (
              <>
                {!finance.can ? (
                  <p className='text-sm text-muted-foreground'>
                    {t('procurement.noAccess')}
                  </p>
                ) : null}
                {(
                  [
                    'receipts',
                    ...(finance.can ? ['payments', 'ledger'] : []),
                  ] as Kind[]
                ).map((k) => (
                  <Related key={k} kind={k} orderId={r.id} />
                ))}
              </>
            ) : null}
            {relatedKind && !readOnly ? (
              <Group title={t('procurement.' + relatedKind)}>
                {related.error ? (
                  <BillingError
                    error={related.error}
                    retry={() => void related.refetch()}
                  />
                ) : !related.data ? (
                  <LoadingRows />
                ) : (
                  <>
                    {related.data.data.length ? (
                      related.data.data.map((v) => (
                        <p key={v.id}>
                          {link('related/' + v.id, v.number + ' · ' + v.title)}
                        </p>
                      ))
                    ) : (
                      <p className='text-muted-foreground'>
                        {t('procurement.empty.' + relatedKind)}
                      </p>
                    )}
                    <Link
                      className='underline'
                      to={
                        '/procurement/' +
                        relatedKind +
                        '?purchase' +
                        relatedKind +
                        (kind === 'suppliers' ? 'supplierId=' : 'requestId=') +
                        r.id
                      }
                    >
                      {t('procurement.viewAll')}
                    </Link>
                  </>
                )}
              </Group>
            ) : null}
            <Group title={t('procurement.history')}>
              {r.events?.data.map((e) => (
                <div key={e.id} className='border-b pb-3 last:border-0'>
                  <p>
                    {t('procurement.actions.' + e.action)} ·{' '}
                    {str(e.payload.actorName) || e.actor} ·{' '}
                    <RecordedAt value={e.createdAt} />
                  </p>
                  <p className='text-sm text-muted-foreground'>
                    {e.fromState
                      ? t('procurement.states.' + e.fromState) + ' → '
                      : ''}
                    {t('procurement.states.' + e.toState)}
                  </p>
                  {str((e.payload.details as Record<string, unknown>)?.note) ? (
                    <LongText>
                      {str((e.payload.details as Record<string, unknown>).note)}
                    </LongText>
                  ) : null}
                </div>
              ))}
              {r.events ? (
                <Paged
                  meta={r.events.meta}
                  onChange={(page) => {
                    const n = new URLSearchParams(q);
                    n.set(historyKey, String(page));
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
function Related({ kind, orderId }: { kind: Kind; orderId: string }) {
  const { t } = useTranslation(),
    path = useResolvedPath('.').pathname,
    l = useLocation(),
    r = useBusinessQuery<Page<Row>>(endpoint(kind), { orderId, pageSize: 10 });
  return (
    <Group title={t('procurement.' + kind)}>
      {r.error ? (
        <BillingError error={r.error} retry={() => void r.refetch()} />
      ) : !r.data ? (
        <LoadingRows />
      ) : (
        <>
          {r.data.data.length ? (
            r.data.data.map((v) => (
              <p key={v.id}>
                <Link
                  className='underline'
                  to={{
                    pathname: path + '/' + kind + '/' + v.id,
                    search: l.search,
                  }}
                >
                  {v.number} · <State value={v.status} />
                  {kind === 'payments' ? (
                    <>
                      {' '}
                      · <Money cents={v.amountCents} />
                    </>
                  ) : null}
                </Link>
              </p>
            ))
          ) : (
            <p className='text-muted-foreground'>
              {t('procurement.empty.' + kind)}
            </p>
          )}
          <Link
            className='underline'
            to={
              '/procurement/' + kind + '?purchase' + kind + 'orderId=' + orderId
            }
          >
            {t('procurement.viewAll')}
          </Link>
        </>
      )}
    </Group>
  );
}
