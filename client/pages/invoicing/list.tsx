import { scalar } from '../hyl/model.js';
import { Fragment, useState } from 'react';
import {
  Link,
  Outlet,
  useLocation,
  useParams,
  useResolvedPath,
  useSearchParams,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { FileCheck2, MoreHorizontal } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { BackButton } from '#components/back-button';
import { Button } from '#components/ui/button';
import { Badge } from '#components/ui/badge';
import { Checkbox } from '#components/ui/checkbox';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '#components/ui/empty';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
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
  RecordedAt,
  Paged,
  Truncated,
  Refresh,
  LoadingRows,
  BillingError,
} from './common.js';
import { endpoint, kindFrom, type Item, type Page } from './types.js';
export default function InvoiceList() {
  const { t } = useTranslation(),
    l = useLocation(),
    p = useParams(),
    path = useResolvedPath('.').pathname,
    [q, setQ] = useSearchParams(),
    kind = kindFrom(path),
    read = useBusinessPermission('contracts', 'invoiceRead'),
    create = useBusinessPermission(
      'contracts',
      kind === 'configs' ? 'invoiceConfigure' : 'invoiceBackfill',
    ),
    issue = useBusinessPermission('contracts', 'invoiceIssue'),
    [selected, setSelected] = useState<string[]>([]),
    local =
      path.includes('/invoiceSources') ||
      (path.includes('/invoices') && !path.startsWith('/invoicing')),
    key = (name: string) => (local ? 'invoiceList:' + path + ':' + name : name),
    get = (name: string) => q.get(key(name));
  const ownQuery = {
    q: get('q') ?? '',
    status: get('status') ?? '',
    enabled: get('enabled') ?? '',
    kind: get('kind') ?? '',
    from: get('from') ?? '',
    to: get('to') ?? '',
    orderBy: get('orderBy') ?? '-updatedAt',
    page: Number(get('page') ?? 1),
    pageSize: 20,
    ...originFilter(p, path),
  };
  const result = useBusinessQuery<Page<Item>>(
      endpoint(kind),
      ownQuery,
      read.can,
    ),
    filter = !!(
      ownQuery.q ||
      ownQuery.status ||
      ownQuery.enabled ||
      ownQuery.kind ||
      ownQuery.from ||
      ownQuery.to
    ),
    set = (k: string, v: string) => {
      setSelected([]);
      setQ((old) => {
        const n = new URLSearchParams(old);
        if (v) n.set(key(k), v);
        else n.delete(key(k));
        if (k !== 'page') n.delete(key('page'));
        return n;
      });
    },
    clear = () => {
      setSelected([]);
      setQ((old) => {
        const n = new URLSearchParams(old);
        [
          'q',
          'status',
          'enabled',
          'kind',
          'from',
          'to',
          'orderBy',
          'page',
        ].forEach((k) => n.delete(key(k)));
        return n;
      });
    };
  const primary =
    kind === 'invoices' ? null : (
      <Button
        variant={selected.length ? 'outline' : 'default'}
        nativeButton={false}
        render={
          <Link
            to={{
              pathname: path + (kind === 'configs' ? '/new' : '/backfill'),
              search: l.search,
            }}
          />
        }
      >
        {t(kind === 'configs' ? 'invoice.newConfig' : 'invoice.backfill')}
      </Button>
    );
  const columns =
      kind === 'sources'
        ? [
            'paidCents',
            'netIssuedCents',
            'availableCents',
            'requiredRedCents',
            'updatedAt',
          ]
        : kind === 'configs'
          ? ['version', 'updatedAt']
          : [
              'grossCents',
              'netCents',
              'taxCents',
              'redGrossCents',
              'issuedAt',
              'updatedAt',
            ],
    View = local ? RouteChildPage : Fragment,
    visible = result.data?.data ?? [],
    activeSelected = selected.filter((id) => visible.some((r) => r.id === id)),
    order = ownQuery.orderBy;
  return (
    <>
      <View>
        <PageContainer>
          {local ? (
            <BackButton
              to={{
                pathname: path.slice(0, path.lastIndexOf('/')),
                search: (() => {
                  const back = new URLSearchParams(l.search);
                  for (const k of [...back.keys()])
                    if (k.startsWith('invoiceList:' + path + ':'))
                      back.delete(k);
                  return back.toString();
                })(),
              }}
            />
          ) : null}
          <PageHeader
            title={t(local ? 'invoice.' + kind : 'invoice.title')}
            description={t('invoice.description')}
            actions={
              <>
                {result.data && (visible.length > 0 || filter) && create.can
                  ? primary
                  : null}
                <Refresh
                  busy={result.isFetching}
                  onClick={() => {
                    setSelected([]);
                    void result.refetch();
                  }}
                />
              </>
            }
          />
          <p className='text-sm text-muted-foreground'>
            {t('invoice.simulated')}
          </p>
          {!local ? (
            <nav className='flex flex-wrap gap-2'>
              {['sources', 'invoices', 'configs'].map((k) => (
                <Button
                  key={k}
                  variant={k === kind ? 'secondary' : 'ghost'}
                  nativeButton={false}
                  render={<Link to={'../' + k} relative='path' />}
                >
                  {t('invoice.' + k)}
                </Button>
              ))}
            </nav>
          ) : null}
          {!read.can ? (
            <p>{t('invoice.restricted')}</p>
          ) : (
            <>
              <div className='flex flex-wrap items-center gap-2'>
                <Search
                  value={ownQuery.q}
                  onChange={(v) => set('q', v)}
                  placeholder={t(
                    'invoice.search' + kind[0].toUpperCase() + kind.slice(1),
                  )}
                />
                <div className='w-full min-w-0 sm:w-40 sm:shrink-0'>
                  <Choice
                    ariaLabel={t('invoice.fields.status')}
                    value={
                      get(kind === 'configs' ? 'enabled' : 'status') || 'all'
                    }
                    onChange={(v) =>
                      set(
                        kind === 'configs' ? 'enabled' : 'status',
                        v === 'all' ? '' : v,
                      )
                    }
                    options={[
                      'all',
                      ...(kind === 'configs'
                        ? ['true', 'false']
                        : kind === 'sources'
                          ? [
                              'awaitingInfo',
                              'ready',
                              'partiallyInvoiced',
                              'invoiced',
                              'redRequired',
                              'excluded',
                              'inactive',
                            ]
                          : ['issued', 'partiallyRed', 'fullyRed']),
                    ].map((value) => ({
                      value,
                      label: t(
                        value === 'all'
                          ? 'invoice.all'
                          : 'invoice.states.' + value,
                      ),
                    }))}
                  />
                </div>
                {kind === 'invoices' ? (
                  <div className='w-full min-w-0 sm:w-40 sm:shrink-0'>
                    <Choice
                      ariaLabel={t('invoice.fields.kind')}
                      value={ownQuery.kind || 'all'}
                      onChange={(v) => set('kind', v === 'all' ? '' : v)}
                      options={['all', 'blue', 'red'].map((value) => ({
                        value,
                        label: t(
                          value === 'all'
                            ? 'invoice.all'
                            : value === 'red'
                              ? 'invoice.redKind'
                              : 'invoice.blue',
                        ),
                      }))}
                    />
                  </div>
                ) : null}
                <LeaseDateFilter
                  label={t('invoice.fields.createdAt')}
                  from={ownQuery.from}
                  to={ownQuery.to}
                  onChange={(from, to) =>
                    setQ((old) => {
                      const n = new URLSearchParams(old);
                      for (const [k, v] of Object.entries({ from, to })) {
                        if (v) n.set(key(k), v);
                        else n.delete(key(k));
                      }
                      n.delete(key('page'));
                      return n;
                    })
                  }
                />
                {filter ? (
                  <Button variant='outline' onClick={clear}>
                    {t('invoice.clear')}
                  </Button>
                ) : null}
              </div>
              {activeSelected.length ? (
                <Button
                  nativeButton={false}
                  render={
                    <Link
                      to={{
                        pathname: path + '/issue',
                        search: new URLSearchParams([
                          ...q.entries(),
                          ['invoiceSourceIds', activeSelected.join(',')],
                        ]).toString(),
                      }}
                    />
                  }
                >
                  {t('invoice.merge')} ({activeSelected.length})
                </Button>
              ) : null}
              {result.error ? (
                <BillingError
                  error={result.error}
                  retry={() => void result.refetch()}
                />
              ) : !result.data ? (
                <LoadingRows />
              ) : !visible.length ? (
                <Empty className='min-h-48 border border-dashed'>
                  <EmptyHeader>
                    <EmptyMedia variant='icon'>
                      <FileCheck2 />
                    </EmptyMedia>
                    <EmptyTitle>
                      {t(filter ? 'invoice.noResults' : 'invoice.empty')}
                    </EmptyTitle>
                    <EmptyDescription>
                      {t(
                        !create.can && kind !== 'invoices'
                          ? 'invoice.restricted'
                          : 'invoice.emptyHelp' + kind,
                      )}
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    {filter ? (
                      <Button variant='outline' onClick={clear}>
                        {t('invoice.clear')}
                      </Button>
                    ) : kind === 'invoices' ? (
                      <Button
                        nativeButton={false}
                        render={
                          <Link
                            to={local ? '../invoiceSources' : '../sources'}
                            relative='path'
                          />
                        }
                      >
                        {t('invoice.sources')}
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
                          {kind === 'sources' && issue.can ? (
                            <TableHead>{t('invoice.select')}</TableHead>
                          ) : null}
                          <TableHead>
                            {t(
                              kind === 'configs'
                                ? 'invoice.fields.contractNumber'
                                : 'invoice.fields.number',
                            )}
                          </TableHead>
                          <TableHead>
                            {t('invoice.fields.merchantName')}
                          </TableHead>
                          <TableHead>
                            {t(
                              kind !== 'sources'
                                ? 'invoice.fields.buyerName'
                                : 'invoice.fields.contractNumber',
                            )}
                          </TableHead>
                          {kind !== 'sources' ? (
                            <TableHead>
                              {t('invoice.fields.sellerName')}
                            </TableHead>
                          ) : (
                            <TableHead>
                              {t('invoice.fields.billNumber')}
                            </TableHead>
                          )}
                          {columns.map((k) => (
                            <TableHead
                              key={k}
                              className={
                                k.endsWith('Cents') ? 'text-right' : ''
                              }
                            >
                              <button
                                onClick={() =>
                                  set('orderBy', order === k ? '-' + k : k)
                                }
                              >
                                {t('invoice.fields.' + k)}
                                {order.replace(/^-/, '') === k
                                  ? order.startsWith('-')
                                    ? ' ↓'
                                    : ' ↑'
                                  : ''}
                              </button>
                            </TableHead>
                          ))}
                          <TableHead>{t('invoice.fields.status')}</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visible.map((r) => {
                          const payload = r.payload,
                            buyer = payload.buyer as
                              { name?: string } | undefined,
                            seller = payload.seller as
                              { name?: string } | undefined;
                          return (
                            <TableRow key={r.id}>
                              {kind === 'sources' && issue.can ? (
                                <TableCell>
                                  <Checkbox
                                    aria-label={
                                      t('invoice.select') + ' ' + r.number
                                    }
                                    checked={activeSelected.includes(r.id)}
                                    disabled={
                                      !r.allowedActions.includes(
                                        'invoiceIssue',
                                      ) ||
                                      BigInt(
                                        scalar(r.availableCents) || '0',
                                      ) === 0n ||
                                      BigInt(
                                        scalar(r.requiredRedCents) || '0',
                                      ) > 0n
                                    }
                                    onCheckedChange={(v) =>
                                      setSelected((old) =>
                                        v
                                          ? [...old, r.id]
                                          : old.filter((id) => id !== r.id),
                                      )
                                    }
                                  />
                                </TableCell>
                              ) : null}
                              <TableCell>
                                <Link
                                  className='underline'
                                  to={{
                                    pathname: path + '/' + r.id,
                                    search: l.search,
                                  }}
                                >
                                  <Truncated>
                                    {kind === 'configs'
                                      ? scalar(r.contractNumber ?? r.contractId)
                                      : (r.number ?? '—')}
                                  </Truncated>
                                </Link>
                                {kind === 'invoices' ? (
                                  <Badge variant='secondary'>
                                    {t(
                                      r.kind === 'red'
                                        ? 'invoice.redKind'
                                        : 'invoice.blue',
                                    )}
                                  </Badge>
                                ) : null}
                              </TableCell>
                              <TableCell>
                                <Truncated>
                                  {scalar(
                                    payload.merchantName ?? r.merchantName,
                                  ) || '—'}
                                </Truncated>
                              </TableCell>
                              <TableCell>
                                <Truncated>
                                  {scalar(
                                    kind !== 'sources'
                                      ? (r.buyerName ?? buyer?.name ?? '—')
                                      : (payload.contractNumber ??
                                          buyer?.name ??
                                          r.contractId),
                                  )}
                                </Truncated>
                              </TableCell>
                              <TableCell>
                                <Truncated>
                                  {scalar(
                                    kind === 'sources'
                                      ? payload.billNumber
                                      : (r.sellerName ?? seller?.name ?? '—'),
                                  )}
                                </Truncated>
                              </TableCell>
                              {columns.map((k) => (
                                <TableCell
                                  key={k}
                                  className={
                                    k.endsWith('Cents') ? 'text-right' : ''
                                  }
                                >
                                  {k.endsWith('Cents') ? (
                                    <Money cents={scalar(r[k]) || '0'} />
                                  ) : k === 'version' ? (
                                    r.version
                                  ) : (
                                    <RecordedAt value={String(r[k])} />
                                  )}
                                </TableCell>
                              ))}
                              <TableCell>
                                <Badge variant='secondary'>
                                  {t(
                                    'invoice.states.' +
                                      (kind === 'configs'
                                        ? String(r.enabled)
                                        : r.status),
                                  )}
                                </Badge>
                                {kind === 'configs' ? (
                                  <Badge variant='outline'>
                                    {t('invoice.autoIssue')}:{' '}
                                    {t('invoice.states.' + String(r.autoIssue))}
                                  </Badge>
                                ) : null}
                              </TableCell>
                              <TableCell>
                                <DropdownMenu>
                                  <DropdownMenuTrigger
                                    render={
                                      <Button
                                        size='icon-sm'
                                        variant='ghost'
                                        aria-label={t('invoice.rowActions', {
                                          number: r.number ?? r.contractId,
                                        })}
                                      />
                                    }
                                  >
                                    <MoreHorizontal />
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent
                                    className='w-auto min-w-40'
                                    align='end'
                                  >
                                    <DropdownMenuItem
                                      render={
                                        <Link
                                          to={{
                                            pathname: path + '/' + r.id,
                                            search: l.search,
                                          }}
                                        />
                                      }
                                    >
                                      {t('invoice.view')}
                                    </DropdownMenuItem>
                                    {kind === 'invoices' &&
                                    r.kind === 'blue' &&
                                    r.allowedActions.includes('invoiceRed') &&
                                    BigInt(String(r.remainingRedCents)) > 0n ? (
                                      <DropdownMenuItem
                                        render={
                                          <Link
                                            to={{
                                              pathname:
                                                path + '/' + r.id + '/red',
                                              search: l.search,
                                            }}
                                          />
                                        }
                                      >
                                        {t('invoice.red')}
                                      </DropdownMenuItem>
                                    ) : null}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  <Paged
                    meta={result.data.meta}
                    busy={result.isFetching}
                    onChange={(n) => set('page', String(n))}
                  />
                </>
              )}
            </>
          )}
        </PageContainer>
      </View>
      <Outlet />
    </>
  );
}

function originFilter(
  p: Record<string, string | undefined>,
  path: string,
): Record<string, string> {
  const segments = path.split('/');
  const origins: Record<string, [string, string | undefined]> = {
    receipts: ['receiptId', p.receiptId],
    bill: ['billId', p.billId],
    bills: ['billId', p.billId],
    refunds: ['cashierRefundId', p.refundId],
    orders: ['cashierOrderId', p.orderId],
    contracts: ['contractId', p.id],
  };
  for (let i = segments.length - 1; i >= 0; i--) {
    const origin = origins[segments[i]];
    if (origin?.[1]) return { [origin[0]]: origin[1] };
  }

  if (p.receiptId) return { receiptId: p.receiptId };
  if (p.billId) return { billId: p.billId };
  if (p.refundId) return { cashierRefundId: p.refundId };
  if (p.orderId) return { cashierOrderId: p.orderId };
  if (p.id) return { contractId: p.id };
  return {};
}
