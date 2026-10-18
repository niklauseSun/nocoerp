import { useCashierPermission } from './permission.js';
import { scalar } from '../hyl/model.js';
import { routeKind } from './helpers.js';
import {
  Link,
  Outlet,
  useLocation,
  useSearchParams,
  useResolvedPath,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { WalletCards, MoreHorizontal } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import { Badge } from '#components/ui/badge';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
  EmptyContent,
} from '#components/ui/empty';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '#components/ui/dropdown-menu';
import { useBusinessPermission, useBusinessQuery } from '../hyl/hooks.js';
import { LeaseDateFilter } from '../hyl/lease/date-filter.js';
import {
  Search,
  Choice,
  Money,
  Day,
  RecordedAt,
  BillingError,
  LoadingRows,
  Paged,
  Refresh,
  Truncated,
} from './common.js';
import { apiPaths, type CashRow } from './types.js';
export default function CashierList() {
  const { t } = useTranslation(),
    l = useLocation(),
    [params, setParams] = useSearchParams(),
    path = useResolvedPath('.').pathname,
    kind = routeKind(path);
  const query = {
    q: params.get('q') ?? '',
    status: params.get('status') ?? '',
    ...(params.get('method') ? { method: params.get('method')! } : {}),
    ...(params.get('from') ? { from: params.get('from')! } : {}),
    ...(params.get('to') ? { to: params.get('to')! } : {}),
    scope: params.get('scope') ?? 'own',
    page: Number(params.get('page') ?? 1),
    pageSize: 20,
    sort: params.get('sort') ?? 'updatedAt',
    order: params.get('order') ?? 'desc',
  };
  const permission = useBusinessPermission(
      'contracts',
      kind === 'reconciliations' ? 'cashierReconcileRead' : 'cashierRead',
    ),
    create = useCashierPermission(
      kind === 'orders'
        ? 'cashierCheckout'
        : kind === 'refunds'
          ? 'cashierRefund'
          : 'cashierReconcile',
    ),
    all = useBusinessPermission('contracts', 'cashierReconcileAll');
  const result = useBusinessQuery<{
    data: CashRow[];
    meta: { total: number; page: number; pageSize: number };
  }>(apiPaths[kind], query, permission.can);
  const filtered = !!(
    query.q ||
    query.status ||
    query.method ||
    params.get('from') ||
    params.get('to')
  );
  const set = (key: string, value: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (value) n.set(key, value);
      else n.delete(key);
      n.delete('page');
      return n;
    });
  const primary = (
    <Button
      nativeButton={false}
      render={<Link to={{ pathname: `${path}/new`, search: l.search }} />}
    >
      {t(
        `cashier.${kind === 'orders' ? 'newOrder' : kind === 'refunds' ? 'newRefund' : 'newReconciliation'}`,
      )}
    </Button>
  );
  const metrics =
    kind === 'orders'
      ? ['receivedCents', 'allocatedCents', 'refundedCents', 'unusedCents']
      : kind === 'refunds'
        ? ['amountCents']
        : ['receivedCents', 'refundedCents', 'netCents', 'differenceCents'];
  const sort = (column: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.set('sort', column);
      n.set(
        'order',
        query.sort === column && query.order === 'desc' ? 'asc' : 'desc',
      );
      return n;
    });
  return (
    <>
      <PageContainer>
        <PageHeader
          title={t('cashier.title')}
          description={t('cashier.offline')}
          actions={
            <>
              {create.can &&
              result.data &&
              (result.data.data.length > 0 || filtered)
                ? primary
                : null}
              <Refresh
                busy={result.isFetching}
                onClick={() => void result.refetch()}
              />
            </>
          }
        />
        <nav className='flex flex-wrap gap-2' aria-label={t('cashier.title')}>
          {Object.keys(apiPaths).map((tab) => (
            <Button
              key={tab}
              nativeButton={false}
              variant={tab === kind ? 'secondary' : 'ghost'}
              render={<Link to={`../${tab}`} relative='path' />}
            >
              {t(`cashier.${tab}`)}
            </Button>
          ))}
        </nav>
        {permission.can ? (
          <>
            <div className='flex flex-wrap items-center gap-2'>
              <Search
                value={query.q}
                onChange={(v) => set('q', v)}
                placeholder={t(
                  kind === 'reconciliations'
                    ? 'cashier.reconciliationSearch'
                    : 'cashier.search',
                )}
              />
              <Choice
                ariaLabel={t('cashier.fields.status')}
                value={query.status || 'all'}
                onChange={(v) => set('status', v === 'all' ? '' : v)}
                options={[
                  'all',
                  ...(kind === 'orders'
                    ? ['draft', 'posted', 'voided']
                    : kind === 'refunds'
                      ? ['posted', 'partiallyCorrected', 'corrected']
                      : ['confirmed']),
                ].map((value) => ({
                  value,
                  label: t(
                    value === 'all' ? 'cashier.all' : `cashier.states.${value}`,
                  ),
                }))}
              />
              {kind !== 'reconciliations' ? (
                <Choice
                  ariaLabel={t('cashier.fields.containsMethod')}
                  value={query.method ?? 'all'}
                  onChange={(v) => set('method', v === 'all' ? '' : v)}
                  options={['all', 'bank', 'cash', 'other'].map((value) => ({
                    value,
                    label: t(
                      value === 'all'
                        ? 'cashier.all'
                        : `cashier.methods.${value}`,
                    ),
                  }))}
                />
              ) : all.can ? (
                <Choice
                  ariaLabel={t('cashier.fields.scope')}
                  value={query.scope}
                  onChange={(v) => set('scope', v)}
                  options={['own', 'authorized'].map((value) => ({
                    value,
                    label: t(`cashier.${value}`),
                  }))}
                />
              ) : null}
              <LeaseDateFilter
                label={t('cashier.fields.createdAt')}
                from={params.get('from') ?? ''}
                to={params.get('to') ?? ''}
                onChange={(from, to) =>
                  setParams((p) => {
                    const n = new URLSearchParams(p);
                    if (from) n.set('from', from);
                    else n.delete('from');
                    if (to) n.set('to', to);
                    else n.delete('to');
                    n.delete('page');
                    return n;
                  })
                }
              />
              {filtered ? (
                <Button variant='outline' onClick={() => setParams({})}>
                  {t('cashier.clear')}
                </Button>
              ) : null}
            </div>
            {result.error ? (
              <BillingError
                error={result.error}
                retry={() => void result.refetch()}
              />
            ) : !result.data ? (
              <LoadingRows />
            ) : !result.data.data.length ? (
              <Empty className='min-h-48 border border-dashed'>
                <EmptyHeader>
                  <EmptyMedia variant='icon'>
                    <WalletCards />
                  </EmptyMedia>
                  <EmptyTitle>
                    {t(filtered ? 'cashier.noResults' : 'cashier.' + kind)}
                  </EmptyTitle>
                  <EmptyDescription>
                    {t(
                      filtered
                        ? 'cashier.noResults'
                        : create.can
                          ? 'cashier.empty'
                          : 'cashier.noCreate',
                    )}
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  {filtered ? (
                    <Button variant='outline' onClick={() => setParams({})}>
                      {t('cashier.clear')}
                    </Button>
                  ) : create.can ? (
                    primary
                  ) : null}
                </EmptyContent>
              </Empty>
            ) : (
              <>
                <div className='overflow-x-auto'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('cashier.fields.number')}</TableHead>
                        <TableHead>
                          {t(
                            kind === 'reconciliations'
                              ? 'cashier.fields.actor'
                              : 'cashier.fields.merchant',
                          )}
                        </TableHead>
                        {kind !== 'reconciliations' ? (
                          <TableHead>
                            {t('cashier.fields.containsMethod')}
                          </TableHead>
                        ) : null}
                        {kind === 'refunds' ? (
                          <TableHead>{t('cashier.fields.source')}</TableHead>
                        ) : null}
                        {[
                          'updatedAt',
                          'createdAt',
                          ...(kind === 'reconciliations'
                            ? ['day', 'revision']
                            : []),
                          ...metrics,
                        ].map((k) => (
                          <TableHead
                            key={k}
                            className={metrics.includes(k) ? 'text-right' : ''}
                          >
                            <button onClick={() => sort(k)}>
                              {t(`cashier.fields.${k}`)}
                              {query.sort === k
                                ? query.order === 'asc'
                                  ? ' ↑'
                                  : ' ↓'
                                : ''}
                            </button>
                          </TableHead>
                        ))}
                        <TableHead>{t('cashier.fields.status')}</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.data.data.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell>
                            <Link
                              className='underline'
                              to={{
                                pathname: `${path}/${r.id}`,
                                search: l.search,
                              }}
                            >
                              <Truncated>{r.number}</Truncated>
                            </Link>
                          </TableCell>
                          <TableCell>
                            <Truncated>
                              {(kind === 'reconciliations'
                                ? r.actor
                                : r.merchantName) || '—'}
                            </Truncated>
                          </TableCell>
                          {kind !== 'reconciliations' ? (
                            <TableCell>
                              {[
                                ...new Set(
                                  (
                                    (
                                      r.payload.input as {
                                        payments?: { method: string }[];
                                        sources?: { method: string }[];
                                      }
                                    )?.payments ??
                                    (
                                      r.payload.input as {
                                        sources?: { method: string }[];
                                      }
                                    )?.sources ??
                                    []
                                  ).map((s) => s.method),
                                ),
                              ]
                                .map((method) => t(`cashier.methods.${method}`))
                                .join(' / ')}
                            </TableCell>
                          ) : null}
                          {kind === 'refunds' ? (
                            <TableCell>
                              <Truncated>
                                {(
                                  (
                                    r.payload.preview as {
                                      sources?: { number: string }[];
                                    }
                                  )?.sources ?? []
                                )
                                  .map((s) => s.number)
                                  .join(' / ')}
                              </Truncated>
                            </TableCell>
                          ) : null}
                          {[
                            'updatedAt',
                            'createdAt',
                            ...(kind === 'reconciliations'
                              ? ['day', 'revision']
                              : []),
                            ...metrics,
                          ].map((k) => (
                            <TableCell
                              key={k}
                              className={
                                metrics.includes(k) ? 'text-right' : ''
                              }
                            >
                              {metrics.includes(k) ? (
                                <Money
                                  cents={scalar(r[k as keyof CashRow] ?? 0)}
                                />
                              ) : k === 'revision' ? (
                                r.revision
                              ) : k === 'createdAt' || k === 'updatedAt' ? (
                                <RecordedAt
                                  value={scalar(r[k as keyof CashRow])}
                                />
                              ) : (
                                <Day value={scalar(r[k as keyof CashRow])} />
                              )}
                            </TableCell>
                          ))}
                          <TableCell>
                            <Badge variant='secondary'>
                              {t(`cashier.states.${r.status}`)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <Button
                                    variant='ghost'
                                    size='icon-sm'
                                    aria-label={t('cashier.actions', {
                                      number: r.number,
                                    })}
                                  />
                                }
                              >
                                <MoreHorizontal />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent className='w-auto min-w-40'>
                                <DropdownMenuItem
                                  render={
                                    <Link
                                      to={{
                                        pathname: `${path}/${r.id}`,
                                        search: l.search,
                                      }}
                                    />
                                  }
                                >
                                  {t('hyl.actions.view')}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <Paged
                  meta={result.data.meta}
                  busy={result.isFetching}
                  onChange={(page) =>
                    setParams((p) => {
                      const n = new URLSearchParams(p);
                      n.set('page', scalar(page));
                      return n;
                    })
                  }
                />
              </>
            )}
          </>
        ) : (
          <p className='text-muted-foreground'>{t('billing.restricted')}</p>
        )}
      </PageContainer>
      <Outlet />
    </>
  );
}
