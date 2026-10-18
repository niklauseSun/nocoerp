import { Badge } from '#components/ui/badge';
import { endpoint, useProcurementCan, str } from './helpers.js';
import { ShoppingCart, ArrowDown, ArrowUp } from 'lucide-react';
import {
  Link,
  Outlet,
  useSearchParams,
  useResolvedPath,
  useLocation,
  useParams,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { RouteChildPage } from '#components/route-child-page';
import { Button } from '#components/ui/button';
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
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '#components/ui/table';
import { useBusinessQuery } from '../hyl/hooks.js';
import { useCoverFocus } from '../profit-sharing/focus.js';
import {
  Choice,
  Search,
  Paged,
  BillingError,
  LoadingRows,
  Refresh,
  Truncated,
  State,
  Money,
  Day,
  type Kind,
  type Row,
  type Page,
} from './common.js';
export default function List({
  kind,
  scope,
}: {
  kind: Kind;
  scope?: 'repair' | 'finance';
}) {
  useCoverFocus();
  const { t } = useTranslation(),
    [q, setQ] = useSearchParams(),
    path = useResolvedPath('.').pathname,
    l = useLocation(),
    params = useParams(),
    finance = useProcurementCan('financeRead'),
    read = useProcurementCan('read'),
    manage = useProcurementCan(kind === 'suppliers' ? 'manage' : 'request'),
    key = 'purchase' + kind,
    get = (k: string) => q.get(key + k) || '',
    change = (k: string, v: string) => {
      const n = new URLSearchParams(q);
      n.delete(key + 'page');
      if (v) n.set(key + k, v);
      else n.delete(key + k);
      setQ(n, { replace: true });
    };
  const query = {
      q: get('q'),
      status: get('status'),
      order: get('order') || '-updatedAt',
      page: Number(get('page')) || 1,
      pageSize: 20,
      ...(scope === 'repair' ? { repairId: params.repairId ?? '' } : {}),
      orderId: get('orderId'),
      supplierId: get('supplierId'),
      requestId: get('requestId'),
    },
    can = kind === 'payments' || kind === 'ledger' ? finance : read;
  const result = useBusinessQuery<Page<Row>>(endpoint(kind), query, can.can),
    summary = useBusinessQuery<{
      data: {
        acceptedCents: string;
        paidCents: string;
        outstandingCents: string;
      };
    }>(
      'procurementSummary',
      scope === 'repair' ? { repairId: params.repairId ?? '' } : {},
      finance.can,
    ),
    rows = result.data?.data,
    filtered = !!(
      query.q ||
      query.status ||
      query.orderId ||
      query.supplierId ||
      query.requestId
    ),
    clear = () => {
      const n = new URLSearchParams(q);
      for (const k of [...n.keys()]) if (k.startsWith(key)) n.delete(k);
      setQ(n, { replace: true });
    },
    create =
      manage.can && ['suppliers', 'requests'].includes(kind) ? (
        <Button
          nativeButton={false}
          render={<Link to={{ pathname: path + '/new', search: l.search }} />}
        >
          {t('procurement.new.' + kind)}
        </Button>
      ) : null;
  const body = (
    <PageContainer>
      {scope ? (
        <BackButton
          to={{
            pathname: path.slice(0, path.lastIndexOf('/')),
            search: l.search,
          }}
        />
      ) : null}
      <PageHeader
        title={t('procurement.' + kind)}
        description={t('procurement.description')}
        actions={
          <>
            {rows?.length || filtered ? create : null}
            <Refresh
              busy={
                result.isFetching || (kind === 'ledger' && summary.isFetching)
              }
              onClick={() => {
                void result.refetch();
                if (kind === 'ledger' && finance.can) void summary.refetch();
              }}
            />
          </>
        }
      />
      {!scope ? (
        <nav
          aria-label={t('procurement.title')}
          className='flex flex-wrap gap-2'
        >
          {(
            [
              'suppliers',
              'requests',
              'orders',
              'receipts',
              ...(finance.can ? ['payments', 'ledger'] : []),
            ] as Kind[]
          ).map((k) => (
            <Button
              key={k}
              variant={kind === k ? 'secondary' : 'ghost'}
              nativeButton={false}
              render={
                <Link
                  to={{ pathname: '/procurement/' + k, search: l.search }}
                />
              }
            >
              {t('procurement.' + k)}
            </Button>
          ))}
        </nav>
      ) : null}
      {kind === 'ledger' && finance.can && summary.error ? (
        <BillingError
          error={summary.error}
          retry={() => void summary.refetch()}
        />
      ) : null}
      {kind === 'ledger' && summary.data ? (
        <div className='flex flex-wrap gap-6 rounded-lg border p-4'>
          {Object.entries(summary.data.data).map(([k, v]) => (
            <div key={k}>
              <p className='text-sm text-muted-foreground'>
                {t('procurement.fields.' + k)}
              </p>
              <Money cents={v} />
            </div>
          ))}
        </div>
      ) : null}
      <div className='flex flex-wrap items-end gap-3'>
        <Search
          value={query.q}
          onChange={(v) => change('q', v)}
          placeholder={t('procurement.search')}
        />
        <Choice
          value={query.status}
          onChange={(v) => change('status', v)}
          ariaLabel={t('procurement.allStates')}
          options={[
            'draft',
            'pending',
            'approved',
            'ordered',
            'issued',
            'accepted',
            'settled',
            'active',
            'suspended',
            'posted',
            'reversed',
            'cancelled',
          ].map((v) => ({ value: v, label: t('procurement.states.' + v) }))}
        />
        <Choice
          value={query.order}
          onChange={(v) => change('order', v)}
          options={[
            '-updatedAt',
            'number',
            '-number',
            'day',
            '-day',
            'amountCents',
            '-amountCents',
          ].map((v) => ({ value: v, label: t('procurement.sort.' + v) }))}
        />
        {filtered ? (
          <Button variant='ghost' onClick={clear}>
            {t('procurement.clear')}
          </Button>
        ) : null}
      </div>
      {can.isPending ? (
        <LoadingRows />
      ) : !can.can ? (
        <p>{t('procurement.noAccess')}</p>
      ) : result.error ? (
        <BillingError
          error={result.error}
          retry={() => void result.refetch()}
        />
      ) : !rows ? (
        <LoadingRows />
      ) : rows.length ? (
        <div
          aria-busy={
            result.isFetching || (kind === 'ledger' && summary.isFetching)
          }
          className={
            result.isPlaceholderData ? 'pointer-events-none opacity-60' : ''
          }
        >
          <div className='overflow-x-auto'>
            <Table>
              <TableHeader>
                <TableRow>
                  {[
                    'number',
                    'title',
                    ...(kind === 'ledger' ? ['type'] : []),
                    'status',
                    'assetName',
                    'day',
                    'amountCents',
                    'view',
                  ].map((k) => (
                    <TableHead
                      key={k}
                      className={k === 'amountCents' ? 'text-right' : ''}
                      aria-sort={
                        query.order === k
                          ? 'ascending'
                          : query.order === '-' + k
                            ? 'descending'
                            : 'none'
                      }
                    >
                      {['number', 'day', 'amountCents'].includes(k) ? (
                        <Button
                          variant='ghost'
                          onClick={() =>
                            change('order', query.order === k ? '-' + k : k)
                          }
                        >
                          {t('procurement.fields.' + k)}
                          {query.order === k ? (
                            <ArrowUp />
                          ) : query.order === '-' + k ? (
                            <ArrowDown />
                          ) : null}
                        </Button>
                      ) : (
                        t('procurement.fields.' + k)
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        className='underline'
                        to={{ pathname: path + '/' + r.id, search: l.search }}
                      >
                        {r.number}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Truncated>{r.title}</Truncated>
                    </TableCell>
                    {kind === 'ledger' ? (
                      <TableCell>
                        <Badge variant='outline'>
                          {t('procurement.ledgerTypes.' + r.type)}
                        </Badge>
                      </TableCell>
                    ) : null}
                    <TableCell>
                      <State value={r.status} />
                    </TableCell>
                    <TableCell>
                      <Truncated>{str(r.payload.assetName) || '—'}</Truncated>
                    </TableCell>
                    <TableCell>
                      <Day value={r.day} />
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {kind === 'suppliers' ? (
                        '—'
                      ) : (
                        <Money cents={r.amountCents} />
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant='ghost'
                        nativeButton={false}
                        render={
                          <Link
                            to={{
                              pathname: path + '/' + r.id,
                              search: l.search,
                            }}
                          />
                        }
                      >
                        {t('procurement.view')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Paged
            meta={result.data!.meta}
            onChange={(p) => {
              const n = new URLSearchParams(q);
              n.set(key + 'page', String(p));
              setQ(n);
            }}
          />
        </div>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <ShoppingCart />
            </EmptyMedia>
            <EmptyTitle>
              {t(
                filtered
                  ? 'procurement.noResults'
                  : 'procurement.empty.' + kind,
              )}
            </EmptyTitle>
            <EmptyDescription>
              {t(filtered ? 'procurement.clearHelp' : 'procurement.emptyHelp')}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {filtered ? (
              <Button variant='outline' onClick={clear}>
                {t('procurement.clear')}
              </Button>
            ) : (
              create
            )}
          </EmptyContent>
        </Empty>
      )}
      <Outlet />
    </PageContainer>
  );
  return scope ? <RouteChildPage>{body}</RouteChildPage> : body;
}
