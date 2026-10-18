import { scalar } from '../hyl/model.js';
import { useCallback, useState } from 'react';
import { Link, Outlet, useLocation, useSearchParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import {
  MoreHorizontal,
  Plus,
  ReceiptText,
  ArrowDown,
  ArrowUp,
} from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from '#components/ui/table';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from '#components/ui/dropdown-menu';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
  EmptyContent,
} from '#components/ui/empty';
import { useBusinessPermission, useBusinessQuery } from '../hyl/hooks.js';
import { LeaseDateFilter } from '../hyl/lease/date-filter.js';
import {
  BillingError,
  Choice,
  Day,
  LoadingRows,
  Metrics,
  Money,
  Paged,
  Refresh,
  Search,
  State,
  Truncated,
} from './common.js';
import {
  feeTypes,
  type Bill,
  type Receipt,
  type ListResponse,
} from './types.js';
export default function BillingList() {
  const [searchReset, setSearchReset] = useState(0);
  const { t } = useTranslation(),
    location = useLocation(),
    [params, setParams] = useSearchParams();
  const kind = location.pathname.includes('/receipts') ? 'receipts' : 'bills',
    isBill = kind === 'bills';
  const read = useBusinessPermission(
      'contracts',
      isBill ? 'billingRead' : 'receiptRead',
    ),
    create = useBusinessPermission(
      'contracts',
      isBill ? 'billWrite' : 'receiptReceive',
    );
  const page = Math.max(1, Number(params.get('page') || 1)),
    q = params.get('q') || '',
    status = params.get('status') || '',
    orderBy = params.get('orderBy') || 'updatedAt:desc';
  const query = Object.fromEntries(
    [...params.entries()].filter(([k]) =>
      [
        'q',
        'status',
        'feeType',
        'from',
        'to',
        'orderBy',
        'page',
        'contractId',
        'merchantId',
        'overdue',
      ].includes(k),
    ),
  );
  const result = useBusinessQuery<ListResponse<Bill & Receipt>>(
    kind,
    { ...query, page, pageSize: 20 },
    read.can,
  );
  const change = useCallback(
    (key: string, value: string) =>
      setParams((previous) => {
        const n = new URLSearchParams(previous);
        if (value) n.set(key, value);
        else n.delete(key);
        if (key !== 'page') n.delete('page');
        return n;
      }),
    [setParams],
  );
  const search = useCallback((value: string) => change('q', value), [change]);
  const clearFilters = () => {
    setSearchReset((n) => n + 1);
    setParams({});
    setTimeout(
      () => document.getElementById('billing-list-search')?.focus(),
      0,
    );
  };
  const data = result.error ? undefined : result.data,
    filtered = [
      'q',
      'status',
      'feeType',
      'from',
      'to',
      'contractId',
      'merchantId',
      'overdue',
    ].some((k) => params.has(k));
  const empty = !!data && data.meta.total === 0 && !filtered;
  const newLink = (
    <Button
      nativeButton={false}
      render={<Link to={{ pathname: 'new', search: location.search }} />}
    >
      <Plus />
      {t(isBill ? 'billing.generate' : 'billing.newReceipt')}
    </Button>
  );
  const columns = [
    'number',
    'merchant',
    'contract',
    ...(isBill ? ['start', 'end', 'dueDate'] : ['date', 'reference']),
    'amountCents',
    'allocatedCents',
    ...(isBill ? ['remainingCents'] : ['refundedCents', 'unusedCents']),
    'status',
    'updatedAt',
  ];
  const sortable = [
    'start',
    'end',
    'dueDate',
    'date',
    'amountCents',
    'allocatedCents',
    'remainingCents',
    'refundedCents',
    'unusedCents',
    'updatedAt',
  ];
  return (
    <>
      <PageContainer>
        <PageHeader
          title={t('billing.title')}
          description={t('billing.description')}
          actions={
            <>
              {!empty && data && create.can ? newLink : null}
              <Refresh
                busy={result.isFetching}
                onClick={() => void result.refetch()}
              />
            </>
          }
        />
        <nav className='flex gap-2' aria-label={t('billing.title')}>
          {(['bills', 'receipts'] as const).map((k) => (
            <Button
              key={k}
              variant={k === kind ? 'secondary' : 'ghost'}
              nativeButton={false}
              render={<Link to={`/billing/${k}`} />}
            >
              {t(`billing.${k}`)}
            </Button>
          ))}
        </nav>
        <div className='flex flex-wrap items-center gap-2'>
          <Search
            key={searchReset}
            id='billing-list-search'
            value={q}
            placeholder={t(
              isBill ? 'billing.searchBills' : 'billing.searchReceipts',
            )}
            onChange={search}
          />
          <div className='w-full sm:w-40'>
            <Choice
              ariaLabel={t('billing.fields.status')}
              value={status || 'all'}
              onChange={(v) => change('status', v === 'all' ? '' : v)}
              options={[
                'all',
                ...(isBill
                  ? ['draft', 'unpaid', 'partial', 'paid', 'voided']
                  : [
                      'unallocated',
                      'partial',
                      'allocated',
                      'refunded',
                      'voided',
                    ]),
              ].map((v) => ({
                value: v,
                label: t(v === 'all' ? 'billing.all' : `billing.states.${v}`),
              }))}
            />
          </div>
          {isBill ? (
            <div className='w-full sm:w-40'>
              <Choice
                ariaLabel={t('billing.fields.feeType')}
                value={params.get('feeType') || 'all'}
                onChange={(v) => change('feeType', v === 'all' ? '' : v)}
                options={['all', ...feeTypes].map((v) => ({
                  value: v,
                  label: t(v === 'all' ? 'billing.all' : `billing.fees.${v}`),
                }))}
              />
            </div>
          ) : null}
          <LeaseDateFilter
            from={params.get('from') || ''}
            to={params.get('to') || ''}
            onChange={(from, to) =>
              setParams((previous) => {
                const n = new URLSearchParams(previous);
                for (const [k, v] of [
                  ['from', from],
                  ['to', to],
                ]) {
                  if (v) n.set(k, v);
                  else n.delete(k);
                }
                n.delete('page');
                return n;
              })
            }
          />
          {filtered ? (
            <Button variant='ghost' onClick={clearFilters}>
              {t('billing.clear')}
            </Button>
          ) : null}
        </div>
        {!read.can ? (
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
        ) : (
          <>
            <Metrics
              values={(isBill
                ? [
                    'amountCents',
                    'depositCents',
                    'allocatedCents',
                    'remainingCents',
                  ]
                : [
                    'amountCents',
                    'allocatedCents',
                    'refundedCents',
                    'unusedCents',
                  ]
              ).map((label) => ({
                label:
                  !isBill && label === 'amountCents' ? 'receiptAmount' : label,
                value:
                  data.totals[
                    (
                      {
                        amountCents: 'amount',
                        depositCents: 'deposit',
                        allocatedCents: 'allocated',
                        remainingCents: 'remaining',
                        refundedCents: 'refunded',
                        unusedCents: 'unused',
                      } as Record<string, string>
                    )[label]
                  ],
              }))}
            />
            {!data.data.length ? (
              <Empty className='min-h-48 border border-dashed'>
                <EmptyHeader>
                  <EmptyMedia variant='icon'>
                    <ReceiptText />
                  </EmptyMedia>
                  <EmptyTitle>
                    {t(
                      filtered
                        ? 'billing.noResults'
                        : isBill
                          ? 'billing.emptyBills'
                          : 'billing.emptyReceipts',
                    )}
                  </EmptyTitle>
                  <EmptyDescription>
                    {t(
                      filtered
                        ? 'billing.clear'
                        : create.can
                          ? isBill
                            ? 'billing.emptyBillsHelp'
                            : 'billing.emptyReceiptsHelp'
                          : 'billing.askAdmin',
                    )}
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  {filtered ? (
                    <Button variant='outline' onClick={clearFilters}>
                      {t('billing.clear')}
                    </Button>
                  ) : create.can ? (
                    newLink
                  ) : null}
                </EmptyContent>
              </Empty>
            ) : (
              <>
                <div className='overflow-x-auto'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {columns.map((key) => (
                          <TableHead
                            key={key}
                            className={
                              key.endsWith('Cents') ? 'text-right' : ''
                            }
                          >
                            {sortable.includes(key) ? (
                              <Button
                                size='sm'
                                variant='ghost'
                                aria-label={t('billing.sort', {
                                  name: t(
                                    `billing.fields.${!isBill && key === 'amountCents' ? 'receiptAmount' : key}`,
                                  ),
                                })}
                                onClick={() =>
                                  change(
                                    'orderBy',
                                    `${key}:${orderBy === `${key}:asc` ? 'desc' : 'asc'}`,
                                  )
                                }
                              >
                                {t(
                                  `billing.fields.${!isBill && key === 'amountCents' ? 'receiptAmount' : key}`,
                                )}
                                {orderBy.startsWith(key + ':') ? (
                                  orderBy.endsWith('asc') ? (
                                    <ArrowUp />
                                  ) : (
                                    <ArrowDown />
                                  )
                                ) : null}
                              </Button>
                            ) : (
                              t(
                                `billing.fields.${!isBill && key === 'amountCents' ? 'receiptAmount' : key}`,
                              )
                            )}
                          </TableHead>
                        ))}
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.data.map((row) => (
                        <TableRow key={row.id}>
                          {columns.map((key) => (
                            <TableCell
                              key={key}
                              className={
                                key.endsWith('Cents') ? 'text-right' : ''
                              }
                            >
                              {key === 'number' ? (
                                <Link
                                  className='underline'
                                  to={{
                                    pathname: row.id,
                                    search: location.search,
                                  }}
                                >
                                  <Truncated>{row.number}</Truncated>
                                </Link>
                              ) : key.endsWith('Cents') ? (
                                <Money
                                  cents={scalar(
                                    row[key as keyof typeof row] ?? '0',
                                  )}
                                />
                              ) : key === 'status' ? (
                                <div className='flex gap-1'>
                                  <State
                                    value={
                                      !isBill && row.displayStatus === 'partial'
                                        ? 'partlyAllocated'
                                        : row.displayStatus
                                    }
                                  />
                                  {row.overdue ? (
                                    <State value='overdue' />
                                  ) : null}
                                </div>
                              ) : [
                                  'start',
                                  'end',
                                  'date',
                                  'dueDate',
                                  'updatedAt',
                                ].includes(key) ? (
                                <Day
                                  value={scalar(
                                    row[key as keyof typeof row] || '',
                                  )}
                                />
                              ) : (
                                <Truncated>
                                  {scalar(
                                    key === 'merchant'
                                      ? (row.merchantName ?? '—')
                                      : key === 'contract'
                                        ? (row.contractNumber ?? '—')
                                        : (row[key as keyof typeof row] ?? '—'),
                                  )}
                                </Truncated>
                              )}
                            </TableCell>
                          ))}
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <Button
                                    variant='ghost'
                                    size='icon-sm'
                                    aria-label={t('billing.actionsFor', {
                                      number: row.number,
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
                                <DropdownMenuGroup>
                                  <DropdownMenuItem
                                    render={
                                      <Link
                                        to={{
                                          pathname: row.id,
                                          search: location.search,
                                        }}
                                      />
                                    }
                                  >
                                    {t('hyl.actions.view')}
                                  </DropdownMenuItem>
                                </DropdownMenuGroup>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <Paged
                  meta={data.meta}
                  busy={result.isFetching}
                  onChange={(p) => change('page', scalar(p))}
                />
              </>
            )}
          </>
        )}
      </PageContainer>
      <Outlet />
    </>
  );
}
