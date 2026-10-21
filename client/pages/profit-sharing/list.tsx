import { scalar } from '../hyl/model.js';
import { Fragment } from 'react';
import {
  Link,
  Outlet,
  useLocation,
  useParams,
  useResolvedPath,
  useSearchParams,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { Split, MoreHorizontal } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { BackButton } from '#components/back-button';
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
  Day,
  RecordedAt,
  Paged,
  Truncated,
  Refresh,
  LoadingRows,
  BillingError,
} from './common.js';
import type { Rule, Order } from './types.js';
export default function SplitList() {
  const { t } = useTranslation(),
    l = useLocation(),
    p = useParams(),
    path = useResolvedPath('.').pathname,
    [q, setQ] = useSearchParams(),
    rules = path.endsWith('rules') || path.endsWith('splitRules');
  const read = useBusinessPermission('contracts', 'splitRead'),
    create = useBusinessPermission('contracts', 'splitConfigure'),
    query = Object.fromEntries(q),
    result = useBusinessQuery<{
      data: (Rule & Order)[];
      meta: { page: number; pageSize: number; total: number };
    }>(
      rules ? 'splitRules' : 'splitOrders',
      {
        ...query,
        ...(p.id ? { contractId: p.id } : {}),
        page: Number(q.get('page') ?? 1),
        pageSize: 20,
      },
      read.can,
    );
  const filter = !!(
    q.get('q') ||
    q.get('status') ||
    q.get('enabled') ||
    q.get('from') ||
    q.get('to') ||
    q.get('sourceKind')
  );
  const set = (k: string, v: string) =>
    setQ((old) => {
      const n = new URLSearchParams(old);
      if (v) n.set(k, v);
      else n.delete(k);
      if (k !== 'page') n.delete('page');
      return n;
    });
  const primary = (
    <Button
      nativeButton={false}
      render={<Link to={{ pathname: path + '/new', search: l.search }} />}
    >
      {t(rules ? 'split.newRule' : 'split.newOrder')}
    </Button>
  );
  const columns = rules
    ? ['effectiveFrom', 'version', 'updatedAt']
    : [
        'sourceFundsCents',
        'netPaidCents',
        'remainingCents',
        'recoveryCents',
        'updatedAt',
      ];
  const orderBy = q.get('orderBy') ?? '-updatedAt',
    View = p.id ? RouteChildPage : Fragment;
  return (
    <>
      <View>
        <PageContainer>
          {p.id ? (
            <BackButton
              to={{
                pathname: path.replace(/\/splitRules$/, ''),
                search: l.search,
              }}
            />
          ) : null}
          <PageHeader
            title={t('split.title')}
            description={t('split.offline')}
            actions={
              <>
                {result.data &&
                (result.data.data.length > 0 || filter) &&
                create.can
                  ? primary
                  : null}
                <Refresh
                  busy={result.isFetching}
                  onClick={() => void result.refetch()}
                />
              </>
            }
          />
          {!p.id ? (
            <nav className='flex gap-2'>
              {['orders', 'rules'].map((k) => (
                <Button
                  key={k}
                  variant={(k === 'rules') === rules ? 'secondary' : 'ghost'}
                  nativeButton={false}
                  render={<Link to={'../' + k} relative='path' />}
                >
                  {t(`split.${k}`)}
                </Button>
              ))}
            </nav>
          ) : null}
          {!read.can ? (
            <p>{t('split.restricted')}</p>
          ) : (
            <>
              <div className='flex flex-wrap items-center gap-2'>
                <Search
                  value={q.get('q') ?? ''}
                  onChange={(v) => set('q', v)}
                  placeholder={t(rules ? 'split.searchRules' : 'split.search')}
                />
                <div className='w-full min-w-0 sm:w-40 sm:shrink-0'>
                  <Choice
                    ariaLabel={t('split.fields.status')}
                    value={q.get(rules ? 'enabled' : 'status') ?? 'all'}
                    onChange={(v) =>
                      set(rules ? 'enabled' : 'status', v === 'all' ? '' : v)
                    }
                    options={[
                      'all',
                      ...(rules
                        ? ['true', 'false']
                        : [
                            'pendingReview',
                            'ready',
                            'partiallyExecuted',
                            'completed',
                            'adjustmentPending',
                            'cancelled',
                          ]),
                    ].map((value) => ({
                      value,
                      label: t(
                        value === 'all' ? 'split.all' : `split.states.${value}`,
                      ),
                    }))}
                  />
                </div>
                {!rules ? (
                  <div className='w-full min-w-0 sm:w-40 sm:shrink-0'>
                    <Choice
                      ariaLabel={t('split.fields.sourceKind')}
                      value={q.get('sourceKind') ?? 'all'}
                      onChange={(v) => set('sourceKind', v === 'all' ? '' : v)}
                      options={['all', 'bill', 'settlement'].map((value) => ({
                        value,
                        label: t(
                          value === 'all'
                            ? 'split.all'
                            : `split.roles.${value}`,
                        ),
                      }))}
                    />
                  </div>
                ) : null}
                <LeaseDateFilter
                  label={t(
                    rules
                      ? 'split.fields.effectiveFrom'
                      : 'split.fields.createdAt',
                  )}
                  from={q.get('from') ?? ''}
                  to={q.get('to') ?? ''}
                  onChange={(from, to) =>
                    setQ((old) => {
                      const n = new URLSearchParams(old);
                      for (const [k, v] of Object.entries({ from, to })) {
                        if (v) n.set(k, v);
                        else n.delete(k);
                      }
                      n.delete('page');
                      return n;
                    })
                  }
                />
                {filter ? (
                  <Button variant='outline' onClick={() => setQ({})}>
                    {t('split.clear')}
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
                      <Split />
                    </EmptyMedia>
                    <EmptyTitle>
                      {t(filter ? 'split.noResults' : 'split.empty')}
                    </EmptyTitle>
                    <EmptyDescription>
                      {t(create.can ? 'split.emptyHelp' : 'split.restricted')}
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    {filter ? (
                      <Button variant='outline' onClick={() => setQ({})}>
                        {t('split.clear')}
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
                          <TableHead>
                            {t(
                              rules
                                ? 'split.fields.contractNumber'
                                : 'split.fields.number',
                            )}
                          </TableHead>
                          {rules ? (
                            <TableHead>
                              {t('split.fields.merchantName')}
                            </TableHead>
                          ) : null}
                          {!rules ? (
                            <>
                              <TableHead>
                                {t('split.fields.merchantName')}
                              </TableHead>
                              <TableHead>
                                {t('split.fields.contractNumber')}
                              </TableHead>
                              <TableHead>
                                {t('split.fields.sourceKind')}
                              </TableHead>
                              <TableHead>
                                {t('split.fields.sourceNumber')}
                              </TableHead>
                            </>
                          ) : null}
                          {columns.map((k) => (
                            <TableHead
                              key={k}
                              className={
                                k.endsWith('Cents') ? 'text-right' : ''
                              }
                            >
                              <button
                                onClick={() =>
                                  set('orderBy', orderBy === k ? '-' + k : k)
                                }
                              >
                                {t(`split.fields.${k}`)}
                                {orderBy.replace(/^-/, '') === k
                                  ? orderBy.startsWith('-')
                                    ? ' ↓'
                                    : ' ↑'
                                  : ''}
                              </button>
                            </TableHead>
                          ))}
                          <TableHead>{t('split.fields.status')}</TableHead>
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
                                  pathname: path + '/' + r.id,
                                  search: l.search,
                                }}
                              >
                                <Truncated>
                                  {rules
                                    ? (r.contractNumber ?? r.searchText)
                                    : r.number}
                                </Truncated>
                              </Link>
                            </TableCell>
                            {rules ? (
                              <TableCell>
                                <Truncated>{r.merchantName ?? ''}</Truncated>
                              </TableCell>
                            ) : null}
                            {!rules ? (
                              <>
                                <TableCell>
                                  <Truncated>
                                    {r.payload.snapshot.merchantName}
                                  </Truncated>
                                </TableCell>
                                <TableCell>
                                  <Truncated>
                                    {r.payload.snapshot.contractNumber}
                                  </Truncated>
                                </TableCell>
                                <TableCell>
                                  <Badge variant='secondary'>
                                    {t(`split.roles.${r.sourceKind}`)}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <Truncated>
                                    {r.payload.snapshot.sourceNumber}
                                  </Truncated>
                                </TableCell>
                              </>
                            ) : null}
                            {columns.map((k) => (
                              <TableCell
                                key={k}
                                className={
                                  k.endsWith('Cents') ? 'text-right' : ''
                                }
                              >
                                {k.endsWith('Cents') ? (
                                  <Money
                                    cents={scalar(r[k as keyof Order] ?? '0')}
                                  />
                                ) : k === 'version' ? (
                                  r.version
                                ) : k === 'effectiveFrom' ? (
                                  <Day value={r.effectiveFrom} />
                                ) : (
                                  <RecordedAt value={r[k as 'updatedAt']} />
                                )}
                              </TableCell>
                            ))}
                            <TableCell>
                              <Badge variant='secondary'>
                                {t(
                                  `split.states.${rules ? String(r.enabled) : r.status}`,
                                )}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  render={
                                    <Button
                                      size='icon-sm'
                                      variant='ghost'
                                      aria-label={t('split.rowActions', {
                                        number: rules ? r.searchText : r.number,
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
                                          pathname: path + '/' + r.id,
                                          search: l.search,
                                        }}
                                      />
                                    }
                                  >
                                    {t('hyl.actions.view')}
                                  </DropdownMenuItem>
                                  {rules &&
                                  r.allowedActions?.includes(
                                    'splitConfigure',
                                  ) &&
                                  !r.closed
                                    ? ['newVersion', 'copy'].map((action) => (
                                        <DropdownMenuItem
                                          key={action}
                                          render={
                                            <Link
                                              to={{
                                                pathname:
                                                  path +
                                                  '/' +
                                                  r.id +
                                                  '/' +
                                                  action,
                                                search: l.search,
                                              }}
                                            />
                                          }
                                        >
                                          {t(`split.${action}`)}
                                        </DropdownMenuItem>
                                      ))
                                    : null}
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
                    onChange={(page) => set('page', String(page))}
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
