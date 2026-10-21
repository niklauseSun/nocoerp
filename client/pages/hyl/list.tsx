import { ResponsiveTable, MobileSort } from '#components/responsive-table';
import { LeaseDateFilter } from './lease/date-filter.js';
import { LeaseStatus } from './lease/status.js';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import { useBusinessPermission, useBusinessQuery } from './hooks.js';
import { useCallback, useEffect, useState, useRef } from 'react';
import { Link, Outlet, useLocation, useSearchParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { Plus, MoreHorizontal, Store, ArrowDown, ArrowUp } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Alert, AlertDescription } from '#components/ui/alert';
import { StatusBadge } from '#components/status-badge';
import { BusinessStatus } from './status.js';
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
  DropdownMenuGroup,
} from '#components/ui/dropdown-menu';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
} from '#components/ui/empty';
import { ErrorPanel, LoadingRows, Refresh, Choice } from './common.js';
import {
  states,
  amountText,
  scalar,
  type Kind,
  type BusinessRow,
} from './model.js';

export function BusinessList({ kind }: { kind: Kind }) {
  const { t, i18n } = useTranslation(),
    location = useLocation();
  const [params, setParams] = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState({
      query: params.get('q') ?? '',
      value: params.get('q') ?? '',
    }),
    [composing, setComposing] = useState(false);
  const q = params.get('q') ?? '',
    status = params.get('status') ?? '',
    view = params.get('view') ?? '',
    month = params.get('month') ?? '',
    merchantId = params.get('merchantId') ?? '',
    orderBy = params.get('orderBy') ?? 'updatedAt:desc';
  const text = draft.query === q ? draft.value : q;
  const setText = (value: string) => setDraft({ query: q, value });
  const rawPage = Number(params.get('page') ?? 1),
    page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const update = useCallback(
    (key: string, value: string) =>
      setParams(
        (previous) => {
          const p = new URLSearchParams(previous);
          if (value) p.set(key, value);
          else p.delete(key);
          if (key !== 'page') p.delete('page');
          return p;
        },
        { replace: true },
      ),
    [setParams],
  );
  useEffect(() => {
    if (composing || text === q) return;
    const timer = setTimeout(() => update('q', text), 300);
    return () => clearTimeout(timer);
  }, [text, composing, q, update]);
  const result = useBusinessQuery<{
    data: BusinessRow[];
    meta: { total: number };
  }>(kind, {
    q,
    status,
    page,
    pageSize: 20,
    orderBy,
    ...(kind === 'contracts'
      ? { from: params.get('from') ?? '', to: params.get('to') ?? '' }
      : {}),
    ...(view ? { view } : {}),
    ...(month ? { month } : {}),
    ...(merchantId ? { merchantId } : {}),
  });
  const create = useBusinessPermission(kind, 'write');
  const title = t(`hyl.nav.${kind}`);
  const label =
    kind === 'settlements'
      ? t('hyl.actions.generate')
      : t('hyl.actions.create', { resource: title });
  const newButton = (
    <Button
      nativeButton={false}
      render={<Link to={{ pathname: 'new', search: location.search }} />}
    >
      <Plus data-icon='inline-start' />
      {label}
    </Button>
  );
  const sort = (column: string) =>
    update(
      'orderBy',
      `${column}:${orderBy === `${column}:desc` ? 'asc' : 'desc'}`,
    );
  const sortTitle = (column: string, label: string) => (
    <Button variant='ghost' onClick={() => sort(column)}>
      {label}
      {orderBy.startsWith(column) ? (
        orderBy.endsWith('desc') ? (
          <ArrowDown className='size-4' />
        ) : (
          <ArrowUp className='size-4' />
        )
      ) : null}
    </Button>
  );
  return (
    <PageContainer>
      <PageHeader
        title={title}
        description={t('hyl.copy.description')}
        actions={
          <>
            {kind === 'expenses' ? (
              <Button
                variant='outline'
                nativeButton={false}
                render={<Link to='purchaseLedger' />}
              >
                {t('procurement.ledger')}
              </Button>
            ) : null}
            {result.data &&
            (result.data.meta.total > 0 || q || status || view || merchantId) &&
            create.can
              ? newButton
              : null}
            <Refresh
              busy={result.isFetching}
              onClick={() => void result.refetch()}
            />
          </>
        }
      />
      {view && ['monthRevenue', 'unsettled', 'unpaid'].includes(view) ? (
        <Alert role='status'>
          <AlertDescription>
            {t(`dashboard.filters.${view}`, { month })}
            {merchantId ? ` · ${t('dashboard.merchantFilter')}` : ''}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className='flex flex-wrap items-center gap-2'>
        <Input
          ref={searchRef}
          aria-label={t(
            kind === 'contracts' ? 'lease.search' : 'hyl.copy.search',
          )}
          placeholder={t(
            kind === 'contracts' ? 'lease.search' : 'hyl.copy.search',
          )}
          className='sm:max-w-xs'
          value={text}
          onChange={(e) => setText(e.target.value)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
        />
        <div className='w-full sm:w-40'>
          <Choice
            ariaLabel={t('hyl.fields.status')}
            value={status || 'all'}
            onChange={(v) => update('status', v === 'all' ? '' : v)}
            options={[
              { value: 'all', label: t('hyl.actions.all') },
              ...states[kind].map((v) => ({
                value: v,
                label: t(
                  kind === 'contracts'
                    ? `lease.states.${v}`
                    : `hyl.states.${v}`,
                ),
              })),
            ]}
          />
        </div>
        {kind === 'contracts' ? (
          <LeaseDateFilter
            from={params.get('from') ?? ''}
            to={params.get('to') ?? ''}
            onChange={(from, to) =>
              setParams(
                (old) => {
                  const n = new URLSearchParams(old);
                  if (from) n.set('from', from);
                  else n.delete('from');
                  if (to) n.set('to', to);
                  else n.delete('to');
                  n.delete('page');
                  return n;
                },
                { replace: true },
              )
            }
          />
        ) : null}
        {q ||
        status ||
        view ||
        merchantId ||
        params.get('from') ||
        params.get('to') ? (
          <Button
            variant='ghost'
            onClick={() => {
              setText('');
              setParams({}, { replace: true });
              searchRef.current?.focus();
            }}
          >
            {t('hyl.actions.clear')}
          </Button>
        ) : null}
      </div>
      {result.isPending ? (
        <LoadingRows />
      ) : result.error ? (
        <ErrorPanel error={result.error} retry={() => void result.refetch()} />
      ) : !result.data.data.length ? (
        <Empty className='min-h-48 border border-dashed'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <Store />
            </EmptyMedia>
            <EmptyTitle>
              {q ||
              status ||
              view ||
              merchantId ||
              params.get('from') ||
              params.get('to')
                ? t('hyl.copy.noResults')
                : t('hyl.copy.empty', { resource: title })}
            </EmptyTitle>
            <EmptyDescription>
              {q ||
              status ||
              view ||
              merchantId ||
              params.get('from') ||
              params.get('to')
                ? t('hyl.actions.clear')
                : t('hyl.copy.emptyHelp')}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {q ||
            status ||
            view ||
            merchantId ||
            params.get('from') ||
            params.get('to') ? (
              <Button
                variant='outline'
                onClick={() => {
                  setText('');
                  setParams({}, { replace: true });
                  searchRef.current?.focus();
                }}
              >
                {t('hyl.actions.clear')}
              </Button>
            ) : create.can ? (
              newButton
            ) : (
              <p>{t('hyl.copy.noPermission')}</p>
            )}
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <ResponsiveTable
            enabled={['revenueReports', 'settlements'].includes(kind)}
            labels={['number', 'name', 'date', 'amount', 'status', 'updatedAt']
              .map((k) => t('hyl.fields.' + k))
              .concat(t('mobile.actions'))}
            sort={
              <MobileSort
                value={
                  orderBy.endsWith(':desc')
                    ? '-' + orderBy.split(':')[0]
                    : orderBy.split(':')[0]
                }
                onChange={(v) =>
                  update(
                    'orderBy',
                    v.replace(/^-/, '') +
                      ':' +
                      (v.startsWith('-') ? 'desc' : 'asc'),
                  )
                }
                fields={['date', 'amountCents', 'updatedAt'].map((k) => ({
                  value: k,
                  label: t(
                    'hyl.fields.' + (k === 'amountCents' ? 'amount' : k),
                  ),
                }))}
              />
            }
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('hyl.fields.number')}</TableHead>
                  <TableHead>{t('hyl.fields.name')}</TableHead>
                  {kind === 'contracts' ? (
                    <>
                      <TableHead>{t('hyl.fields.title')}</TableHead>
                      <TableHead>{t('assets.contractAssets')}</TableHead>
                      <TableHead>
                        {sortTitle('end', t('hyl.fields.end'))}
                      </TableHead>
                      <TableHead className='text-right'>
                        {sortTitle('depositTarget', t('lease.target'))}
                      </TableHead>
                      <TableHead className='text-right'>
                        {sortTitle('depositBalance', t('lease.balance'))}
                      </TableHead>
                    </>
                  ) : null}
                  <TableHead>
                    {kind === 'merchants'
                      ? t('hyl.fields.unit')
                      : sortTitle('date', t('hyl.fields.date'))}
                  </TableHead>
                  <TableHead className='text-right'>
                    {kind === 'merchants'
                      ? t('hyl.fields.contact')
                      : kind === 'contracts'
                        ? t('hyl.fields.method')
                        : sortTitle('amountCents', t('hyl.fields.amount'))}
                  </TableHead>
                  <TableHead>{t('hyl.fields.status')}</TableHead>
                  <TableHead>
                    {sortTitle('updatedAt', t('hyl.fields.updatedAt'))}
                  </TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.data.data.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link
                        className='font-medium underline-offset-4 hover:underline'
                        to={{ pathname: row.id, search: location.search }}
                      >
                        <Ellipsis text={row.number} />
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Ellipsis text={row.name} />
                    </TableCell>
                    {kind === 'contracts' ? (
                      <>
                        <TableCell>
                          {scalar(row.payload.title) || '—'}
                        </TableCell>
                        <TableCell>
                          <Ellipsis text={row.assetNames || '—'} />
                        </TableCell>
                        <TableCell className='whitespace-nowrap'>
                          {row.leaseEnd ?? scalar(row.payload.end)}
                        </TableCell>
                        <TableCell className='text-right tabular-nums whitespace-nowrap'>
                          {row.depositTarget === null
                            ? '—'
                            : amountText(row.depositTarget, i18n.language)}
                        </TableCell>
                        <TableCell className='text-right tabular-nums whitespace-nowrap'>
                          {row.depositBalance === null
                            ? '—'
                            : amountText(row.depositBalance, i18n.language)}
                        </TableCell>
                      </>
                    ) : null}
                    <TableCell>
                      {kind === 'merchants'
                        ? scalar(row.payload.unit)
                        : row.date}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {kind === 'merchants'
                        ? scalar(row.payload.contact)
                        : kind === 'contracts'
                          ? t(`hyl.enums.${scalar(row.payload.method)}`)
                          : amountText(
                              Number(row.amountCents) / 100,
                              i18n.language,
                            )}
                    </TableCell>
                    <TableCell>
                      {kind === 'contracts' ? (
                        <LeaseStatus status={row.leaseState ?? 'active'} />
                      ) : row.status === 'due' &&
                        row.debtRemaining !== undefined ? (
                        <StatusBadge tone='info'>
                          {t(
                            Number(row.debtRemaining) === 0
                              ? 'lease.collected'
                              : Number(row.debtRemaining) <
                                  -Number(row.amountCents) / 100
                                ? 'lease.partialCollection'
                                : 'lease.pendingCollection',
                          )}
                        </StatusBadge>
                      ) : (
                        <BusinessStatus status={row.status} />
                      )}
                    </TableCell>
                    <TableCell>
                      {new Intl.DateTimeFormat(i18n.language, {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      }).format(new Date(row.updatedAt))}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              size='icon-sm'
                              variant='ghost'
                              aria-label={t('hyl.actions.more', {
                                name: row.number,
                              })}
                            />
                          }
                        >
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align='end'
                          className='w-auto min-w-40'
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
          </ResponsiveTable>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <p className='text-sm text-muted-foreground'>
              {t('hyl.copy.count', { total: result.data.meta.total, page })}
            </p>
            <div className='flex gap-2'>
              <Button
                variant='outline'
                disabled={page === 1}
                onClick={() => update('page', String(page - 1))}
              >
                {t('hyl.actions.previous')}
              </Button>
              <Button
                variant='outline'
                disabled={page * 20 >= result.data.meta.total}
                onClick={() => update('page', String(page + 1))}
              >
                {t('hyl.actions.next')}
              </Button>
            </div>
          </div>
        </>
      )}
      <Outlet context={{ kind, reload: () => result.refetch() }} />
    </PageContainer>
  );
}

function Ellipsis({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className='block max-w-48 truncate' tabIndex={0} />}
      >
        {text}
      </TooltipTrigger>
      <TooltipContent>
        <p className='max-w-xs break-words'>{text}</p>
      </TooltipContent>
    </Tooltip>
  );
}
