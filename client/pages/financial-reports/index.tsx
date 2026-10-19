import { ReportSkeleton } from './loading.js';
import { FinanceError } from './error.js';
import { Link, Outlet, useLocation, useSearchParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { ChartNoAxesCombined } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '#components/ui/table';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
  EmptyContent,
} from '#components/ui/empty';
import { Alert, AlertDescription } from '#components/ui/alert';
import { StatusBadge } from '#components/status-badge';
import {
  Search,
  Choice,
  Paged,
  Refresh,
  Money,
  Day,
  Truncated,
} from '../billing/common.js';
import { RecordedAt } from '../cashier/common.js';
import { ReportRange } from './date-range.js';
import { useReport, today } from './hooks.js';
import type { Report, Line, Check } from './types.js';
const views = [
  'cash',
  'receivables',
  'payables',
  'deposits',
  'checks',
] as const;
export default function Reports() {
  const { t } = useTranslation(),
    [q, setQ] = useSearchParams(),
    location = useLocation(),
    day = today(),
    query = Object.fromEntries(q.entries());
  const view = views.includes(query.view as (typeof views)[number])
      ? query.view
      : 'cash',
    from = query.from || day.slice(0, 7) + '-01',
    to = query.to || day;
  const r = useReport<Report>('financialReports', query),
    d = r.error ? undefined : r.data?.data;
  const change = (values: Record<string, string>) => {
    const n = new URLSearchParams(q);
    n.delete('page');
    for (const [k, v] of Object.entries(values))
      if (v) n.set(k, v);
      else n.delete(k);
    setQ(n, { replace: true });
  };
  const numeric =
    view === 'deposits'
      ? ['amountCents', 'openingCents', 'movementCents', 'closingCents']
      : view === 'checks'
        ? ['expectedCents', 'actualCents', 'differenceCents']
        : view === 'cash'
          ? ['amountCents']
          : ['amountCents', 'appliedCents', 'remainingCents'];
  const columns = [
    'number',
    'type',
    ...(view === 'checks' ? [] : view === 'deposits' ? ['at'] : ['at', 'date']),
    ...numeric,
  ];
  const metrics = [
    'receivedCents',
    'paidCents',
    'netCents',
    'depositCents',
    'receivableCents',
    'merchantPayableCents',
    'supplierPayableCents',
    'advanceCents',
  ];
  const order = query.order || '-at',
    filtered = !!(
      query.q ||
      query.projectId ||
      query.from ||
      query.to ||
      Number(query.page) > 1
    );
  return (
    <>
      <PageContainer>
        <PageHeader
          title={t('finance.title')}
          description={t('finance.description')}
          actions={
            <Refresh busy={r.isFetching} onClick={() => void r.refetch()} />
          }
        />
        <div className='flex flex-wrap items-center gap-3'>
          <div className='w-full sm:w-48'>
            <Choice
              ariaLabel={t('finance.project')}
              value={query.projectId || ''}
              onChange={(v) => change({ projectId: v })}
              options={[
                { value: '', label: t('finance.allProjects') },
                ...(d?.projects ?? []).map((p) => ({
                  value: p.id,
                  label: p.name,
                })),
              ]}
            />
          </div>
          <ReportRange
            from={from}
            to={to}
            onChange={(a, b) => change({ from: a, to: b })}
          />
          <Button variant='outline' onClick={() => setQ({ view })}>
            {t('finance.clear')}
          </Button>
        </div>
        <p className='text-sm text-muted-foreground'>
          {t('finance.scope')}
          {query.projectId ? ' ' + t('finance.projectScope') : ''}
        </p>
        {r.error ? (
          <FinanceError error={r.error} retry={() => void r.refetch()} />
        ) : r.isPending ? (
          <ReportSkeleton />
        ) : d ? (
          <>
            <div
              className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'
              aria-busy={r.isFetching}
            >
              {metrics.map((k) => (
                <Card key={k}>
                  <CardHeader>
                    <CardTitle className='text-sm text-muted-foreground'>
                      {t('finance.metrics.' + k)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='text-xl font-semibold'>
                    <Money cents={d.summary[k]} />
                  </CardContent>
                </Card>
              ))}
            </div>
            <p className='text-sm text-muted-foreground'>
              {t('finance.snapshot')} <RecordedAt value={d.generatedAt} />
              {' · '}
              {t('finance.simulated')}
            </p>
            <nav
              className='flex flex-wrap gap-2'
              aria-label={t('finance.views')}
            >
              {views.map((v) => (
                <Button
                  key={v}
                  variant='outline'
                  aria-current={view === v ? 'page' : undefined}
                  onClick={() => change({ view: v, order: '', q: '' })}
                >
                  {t('finance.' + v)}
                </Button>
              ))}
            </nav>
            <p className='text-sm text-muted-foreground'>
              {t(
                view === 'cash'
                  ? 'finance.cashBasis'
                  : view === 'deposits'
                    ? 'finance.depositBasis'
                    : 'finance.currentBasis',
              )}
            </p>
            {view === 'cash' ? (
              <div className='flex flex-wrap gap-4'>
                {['openingCashCents', 'closingCashCents'].map((k) => (
                  <div key={k}>
                    <span className='text-sm text-muted-foreground'>
                      {t('finance.metrics.' + k)}{' '}
                    </span>
                    <Money cents={d.summary[k]} />
                  </div>
                ))}
                {d.categories.map((c) => (
                  <div key={c.type}>
                    <span className='text-sm text-muted-foreground'>
                      {t('finance.types.' + c.type)}{' '}
                    </span>
                    <Money cents={c.netCents} />
                  </div>
                ))}
              </div>
            ) : null}
            {view === 'checks' ? (
              <ReconciliationNotice checks={d.checks} />
            ) : null}
            <div className='flex flex-wrap items-center gap-3'>
              <Search
                value={query.q || ''}
                onChange={(v) => change({ q: v })}
                placeholder={t('finance.search')}
              />
              <span className='text-sm text-muted-foreground'>
                {t('finance.listScope')}
              </span>
              {r.isFetching ? (
                <span role='status'>{t('finance.refreshing')}</span>
              ) : null}
            </div>
            {d.items.length ? (
              <>
                <div className='overflow-x-auto' aria-busy={r.isFetching}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {columns.map((k) => (
                          <TableHead
                            key={k}
                            className={
                              k.endsWith('Cents') ? 'text-right' : undefined
                            }
                            aria-sort={
                              order.replace('-', '') === k
                                ? order.startsWith('-')
                                  ? 'descending'
                                  : 'ascending'
                                : undefined
                            }
                          >
                            {k === 'at' ||
                            k === 'date' ||
                            k.endsWith('Cents') ? (
                              <Button
                                variant='ghost'
                                onClick={() =>
                                  change({ order: order === k ? '-' + k : k })
                                }
                              >
                                {t(
                                  view === 'deposits' && k === 'amountCents'
                                    ? 'finance.metrics.depositCents'
                                    : 'finance.columns.' + k,
                                )}{' '}
                                {order.replace('-', '') === k
                                  ? order.startsWith('-')
                                    ? '↓'
                                    : '↑'
                                  : ''}
                              </Button>
                            ) : (
                              t('finance.columns.' + k)
                            )}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.items.map((row) => (
                        <TableRow key={row.id}>
                          {columns.map((k) => (
                            <TableCell
                              key={k}
                              className={
                                k.endsWith('Cents') ? 'text-right' : undefined
                              }
                            >
                              {k === 'number' ? (
                                'kind' in row && !r.isFetching ? (
                                  <Link
                                    className='font-medium underline underline-offset-4'
                                    to={{
                                      pathname:
                                        row.kind +
                                        '/' +
                                        encodeURIComponent(row.id),
                                      search: location.search,
                                    }}
                                  >
                                    <Truncated>{row.number}</Truncated>
                                  </Link>
                                ) : (
                                  <Truncated>{row.number}</Truncated>
                                )
                              ) : k === 'type' ? (
                                <StatusBadge tone='neutral'>
                                  {t('finance.types.' + row.type)}
                                </StatusBadge>
                              ) : k === 'at' ? (
                                <RecordedAt value={(row as Line).at} />
                              ) : k === 'date' ? (
                                <Day value={(row as Line).date} />
                              ) : (
                                <Money
                                  cents={
                                    (row as unknown as Record<string, string>)[
                                      k
                                    ] ?? '0'
                                  }
                                />
                              )}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <Paged
                  meta={r.data.meta}
                  onChange={(page) => {
                    const n = new URLSearchParams(q);
                    n.set('page', String(page));
                    setQ(n);
                  }}
                />
              </>
            ) : (
              <Empty className='min-h-48 border border-dashed'>
                <EmptyHeader>
                  <EmptyMedia variant='icon'>
                    <ChartNoAxesCombined />
                  </EmptyMedia>
                  <EmptyTitle>
                    {t(filtered ? 'finance.noResults' : 'finance.empty')}
                  </EmptyTitle>
                  <EmptyDescription>
                    {t(
                      filtered ? 'finance.noResultsHint' : 'finance.emptyHint',
                    )}
                  </EmptyDescription>
                </EmptyHeader>
                {filtered ? (
                  <EmptyContent>
                    <Button variant='outline' onClick={() => setQ({ view })}>
                      {t('finance.clear')}
                    </Button>
                  </EmptyContent>
                ) : null}
              </Empty>
            )}
          </>
        ) : null}
      </PageContainer>
      <Outlet />
    </>
  );
}

function ReconciliationNotice({ checks }: { checks: Check[] }) {
  const { t } = useTranslation(),
    count = checks.filter((c) => c.differenceCents !== '0').length,
    message = t('finance.checkResult', { count, total: checks.length });
  return count ? (
    <Alert variant='destructive'>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  ) : (
    <p className='text-sm text-muted-foreground'>{message}</p>
  );
}
