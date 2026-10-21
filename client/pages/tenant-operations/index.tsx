import { Link, Outlet, useSearchParams } from 'react-router';
import { useState } from 'react';
import { Checkbox } from '#components/ui/checkbox';
import { useTranslation } from '@nocobase/i18n/client';
import { resolveAppUrl } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { ClipboardList, MoreHorizontal } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from '#components/ui/dropdown-menu';
import { Button } from '#components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '#components/ui/table';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '#components/ui/empty';
import { StatusBadge } from '#components/status-badge';
import { useOperations } from './hooks.js';
import {
  Choice,
  Search,
  Refresh,
  Money,
  Day,
  Paged,
  DateField,
  Truncated,
  BillingError,
  LoadingRows,
} from '../billing/common.js';
import { views, type Item } from '../../../server/tenant-operations/model.js';
import { today } from '../financial-reports/hooks.js';
import DeliveryWorkspace from './delivery-workspace.js';
import { OperationsNav } from './navigation.js';
const statuses: Record<string, string[]> = {
  reporting: ['missing', 'draft', 'returned', 'pending', 'approved', 'partial'],
  statements: [
    'review',
    'confirmation',
    'disputed',
    'payable',
    'partial',
    'paid',
    'settled',
    'due',
    'cancelled',
  ],
  arrears: ['due', 'age30', 'age60', 'age90', 'ageOver90'],
  leases: ['expire30', 'expire60', 'expire90', 'expired', 'handover'],
  reconciliation: [
    'candidate',
    'ambiguous',
    'difference',
    'unmatched',
    'matched',
    'restricted',
  ],
};
interface Result {
  data: {
    month: string;
    today: string;
    generatedAt: string;
    items: Item[];
    summary: Record<string, string>;
  };
  meta: { total: number; page: number; pageSize: number };
}
export default function Operations() {
  const [params] = useSearchParams();
  return ['batches', 'tenantService', 'integrations'].includes(
    params.get('view') ?? '',
  ) ? (
    <DeliveryWorkspace />
  ) : (
    <LegacyOperations />
  );
}
function LegacyOperations() {
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const { t, i18n } = useTranslation(),
    [params, setParams] = useSearchParams(),
    q = Object.fromEntries(
      [...params].filter(([key]) => !['returnMatch', 'rowIds'].includes(key)),
    ),
    view = views.includes(q.view as (typeof views)[number])
      ? q.view
      : 'reporting',
    month = q.month || today().slice(0, 7),
    query = {
      ...q,
      view,
      month,
      order: q.order || (q.group === 'merchant' ? '-amountCents' : '-date'),
    };
  const r = useOperations<Result>(query),
    d = r.error ? undefined : r.data?.data;
  const { can: canImport } = useCan({
    resource: { type: 'settings', id: 'hyl.externalReconciliation' },
    action: 'write',
  });
  const change = (values: Record<string, string>) => {
    const n = new URLSearchParams(params);
    n.delete('page');
    for (const [k, v] of Object.entries(values))
      if (v) n.set(k, v);
      else n.delete(k);
    setParams(n, { replace: true });
  };
  const filtered = !!(q.q || q.month || q.status),
    sort = query.order,
    locale = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US',
    exportURL = resolveAppUrl(
      '/api/tenantOperations/export?' +
        new URLSearchParams({ ...query, format: 'xlsx', locale }).toString(),
    );
  const batchRows =
    d?.items.filter(
      (row) => row.status === 'candidate' && selectedRows.includes(row.id),
    ) ?? [];
  return (
    <>
      <PageContainer>
        <PageHeader
          title={t('operations.title')}
          description={t('operations.description')}
          actions={
            <>
              {d ? (
                <Button
                  variant='outline'
                  nativeButton={false}
                  render={<a href={exportURL} />}
                >
                  {t('operations.export')}
                </Button>
              ) : null}
              <Refresh busy={r.isFetching} onClick={() => void r.refetch()} />
            </>
          }
        />
        <OperationsNav view={view} />
        <div className='flex flex-wrap items-center gap-3'>
          <div className='w-full sm:w-40'>
            <DateField
              id='ops-month'
              month
              value={month}
              onChange={(v) => change({ month: v })}
            />
          </div>
          {statuses[view]?.length ? (
            <div className='w-full min-w-0 sm:w-40 sm:shrink-0'>
              <Choice
                ariaLabel={t('operations.status')}
                value={q.status || ''}
                onChange={(v) => change({ status: v })}
                options={[
                  { value: '', label: t('operations.allStatuses') },
                  ...statuses[view].map((s) => ({
                    value: s,
                    label: t(
                      i18n.exists('operations.statuses.' + s)
                        ? 'operations.statuses.' + s
                        : 'hyl.states.' + s,
                    ),
                  })),
                ]}
              />
            </div>
          ) : null}
          <Search
            value={q.q || ''}
            onChange={(v) => change({ q: v })}
            placeholder={t('operations.search')}
          />
          {filtered ? (
            <Button variant='outline' onClick={() => setParams({ view })}>
              {t('operations.clear')}
            </Button>
          ) : null}
          {view === 'reconciliation' && canImport ? (
            <Button
              variant='outline'
              nativeButton={false}
              render={
                <Link to={{ pathname: 'import', search: params.toString() }} />
              }
            >
              {t('operations.import')}
            </Button>
          ) : null}
        </div>
        {view === 'business' ? (
          <div className='w-full min-w-0 sm:w-40 sm:shrink-0'>
            <Choice
              value={q.group || 'daily'}
              onChange={(v) => change({ group: v })}
              ariaLabel={t('operations.group')}
              options={['daily', 'merchant', 'channel', 'project'].map((g) => ({
                value: g,
                label: t('operations.groups.' + g),
              }))}
            />
          </div>
        ) : null}
        <p className='text-sm text-muted-foreground'>
          {t('operations.scope')} {t('operations.current')}{' '}
          {t('operations.metricScope')}
        </p>
        {r.error ? (
          <BillingError error={r.error} retry={() => void r.refetch()} />
        ) : r.isPending ? (
          <LoadingRows />
        ) : d ? (
          <>
            <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
              {Object.entries(d.summary).map(([k, v]) => (
                <Card key={k}>
                  <CardHeader>
                    <CardTitle className='text-sm text-muted-foreground'>
                      {t('operations.metrics.' + k)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='text-xl font-semibold'>
                    {k.endsWith('Cents') ? <Money cents={v} /> : v}
                  </CardContent>
                </Card>
              ))}
            </div>
            {view === 'vacancy' ? (
              <p className='text-sm text-muted-foreground'>
                {t('operations.occupancy')}{' '}
                {d.summary.units !== '0'
                  ? new Intl.NumberFormat(i18n.language, {
                      style: 'percent',
                      maximumFractionDigits: 1,
                    }).format(
                      Number(d.summary.occupied) / Number(d.summary.units),
                    )
                  : '—'}
              </p>
            ) : null}
            {view === 'arrears' ? (
              <div className='flex flex-col gap-2'>
                <p className='text-sm text-muted-foreground'>
                  {t('operations.cashCollectionRate')}{' '}
                  {BigInt(d.summary.assessedCents ?? '0') > 0n
                    ? new Intl.NumberFormat(i18n.language, {
                        style: 'percent',
                        maximumFractionDigits: 2,
                      }).format(
                        Number(
                          (BigInt(d.summary.cashAppliedCents ?? '0') * 10000n +
                            BigInt(d.summary.assessedCents) / 2n) /
                            BigInt(d.summary.assessedCents),
                        ) / 10000,
                      )
                    : '—'}
                </p>
                <p className='text-sm text-muted-foreground'>
                  {t('operations.collectionRate')}{' '}
                  {d.summary.assessedCents !== '0'
                    ? new Intl.NumberFormat(i18n.language, {
                        style: 'percent',
                        maximumFractionDigits: 1,
                      }).format(
                        Number(d.summary.appliedCents) /
                          Number(d.summary.assessedCents),
                      )
                    : '—'}
                </p>
                <p className='text-sm text-muted-foreground'>
                  {t('operations.cashCollectionHint')}
                </p>
              </div>
            ) : null}
            {d.items.length ? (
              <>
                {view === 'reconciliation' && canImport && batchRows.length ? (
                  <Button
                    className='w-fit'
                    nativeButton={false}
                    render={
                      <Link
                        to={{
                          pathname: 'matchBatch',
                          search: new URLSearchParams({
                            ...q,
                            rowIds: batchRows.map((row) => row.id).join(','),
                          }).toString(),
                        }}
                      />
                    }
                  >
                    {t('operations.batchMatch')} · {batchRows.length}
                  </Button>
                ) : null}
                <div className='overflow-x-auto' aria-busy={r.isFetching}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {view === 'reconciliation' && canImport ? (
                          <TableHead>{t('operations.selection')}</TableHead>
                        ) : null}
                        {[
                          'name',
                          'date',
                          'status',
                          'amountCents',
                          ...(view === 'business' && q.group === 'merchant'
                            ? ['feeCents']
                            : []),
                          'detail',
                          'source',
                        ].map((k) => (
                          <TableHead
                            key={k}
                            className={
                              k.endsWith('Cents') ? 'text-right' : undefined
                            }
                            aria-sort={
                              sort.replace('-', '') === k
                                ? sort.startsWith('-')
                                  ? 'descending'
                                  : 'ascending'
                                : undefined
                            }
                          >
                            {[
                              'name',
                              'date',
                              'amountCents',
                              'feeCents',
                            ].includes(k) ? (
                              <Button
                                variant='ghost'
                                onClick={() =>
                                  change({ order: sort === k ? '-' + k : k })
                                }
                              >
                                {t(
                                  'operations.' +
                                    (k === 'amountCents' ? 'amount' : k),
                                )}{' '}
                                {sort.replace('-', '') === k
                                  ? sort.startsWith('-')
                                    ? '↓'
                                    : '↑'
                                  : ''}
                              </Button>
                            ) : (
                              t('operations.' + k)
                            )}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.items.map((row) => (
                        <TableRow key={row.id}>
                          {view === 'reconciliation' && canImport ? (
                            <TableCell>
                              <Checkbox
                                disabled={
                                  r.isFetching || row.status !== 'candidate'
                                }
                                aria-label={
                                  t('operations.selection') + ' ' + row.name
                                }
                                checked={batchRows.some((i) => i.id === row.id)}
                                onCheckedChange={(checked) =>
                                  setSelectedRows((s) =>
                                    checked
                                      ? [...new Set([...s, row.id])]
                                      : s.filter((id) => id !== row.id),
                                  )
                                }
                              />
                            </TableCell>
                          ) : null}
                          <TableCell>
                            <Truncated>
                              {view === 'business' && q.group === 'channel'
                                ? t('hyl.enums.' + row.name)
                                : row.name}
                            </Truncated>
                          </TableCell>
                          <TableCell>
                            <Day value={row.date} />
                          </TableCell>
                          <TableCell>
                            <StatusBadge tone='neutral'>
                              {t(
                                view !== 'statements' &&
                                  i18n.exists(
                                    'operations.statuses.' + row.status,
                                  )
                                  ? 'operations.statuses.' + row.status
                                  : 'hyl.states.' + row.status,
                              )}
                            </StatusBadge>
                          </TableCell>
                          <TableCell className='text-right'>
                            {row.status === 'missing' ? (
                              '—'
                            ) : (
                              <Money cents={row.amountCents} />
                            )}
                          </TableCell>
                          {view === 'business' && q.group === 'merchant' ? (
                            <TableCell className='text-right'>
                              {row.feeCents === undefined ? (
                                '—'
                              ) : (
                                <Money cents={row.feeCents} />
                              )}
                            </TableCell>
                          ) : null}
                          <TableCell>
                            <Truncated>
                              {view === 'business'
                                ? [
                                    'daily',
                                    'merchant',
                                    'channel',
                                    'project',
                                  ].includes(row.detail)
                                  ? t('operations.groups.' + row.detail)
                                  : i18n.exists('hyl.enums.' + row.detail)
                                    ? t('hyl.enums.' + row.detail)
                                    : row.detail
                                : row.detail}
                            </Truncated>
                          </TableCell>
                          <TableCell>
                            <RowActions
                              row={row}
                              view={view}
                              search={params.toString()}
                              locale={locale}
                              disabled={r.isFetching}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <Paged
                  meta={r.data.meta}
                  onChange={(page) => {
                    const n = new URLSearchParams(params);
                    n.set('page', String(page));
                    setParams(n);
                  }}
                />
              </>
            ) : (
              <Empty className='min-h-48 border border-dashed'>
                <EmptyHeader>
                  <EmptyMedia variant='icon'>
                    <ClipboardList />
                  </EmptyMedia>
                  <EmptyTitle>
                    {t(filtered ? 'operations.noResults' : 'operations.empty')}
                  </EmptyTitle>
                  <EmptyDescription>
                    {t(
                      filtered
                        ? 'operations.noResultsHint'
                        : 'operations.emptyHint',
                    )}
                  </EmptyDescription>
                </EmptyHeader>
                {filtered ? (
                  <EmptyContent>
                    <Button
                      variant='outline'
                      onClick={() => setParams({ view })}
                    >
                      {t('operations.clear')}
                    </Button>
                  </EmptyContent>
                ) : null}
              </Empty>
            )}
            <p className='text-sm text-muted-foreground'>
              {t('operations.exportHint')}
            </p>
          </>
        ) : null}
      </PageContainer>
      <Outlet />
    </>
  );
}

function RowActions({
  row,
  view,
  search,
  locale,
  disabled,
}: {
  row: Item;
  view: string;
  search: string;
  locale: string;
  disabled: boolean;
}) {
  const { t } = useTranslation(),
    grant = useCan({
      resource: {
        type: 'composite',
        id: row.kind === 'settlements' ? 'hyl.settlements' : 'hyl.contracts',
      },
      action:
        row.kind === 'settlements'
          ? 'review'
          : row.kind === 'bill'
            ? 'billWrite'
            : 'write',
    });
  const links: {
    label: string;
    to?: { pathname: string; search: string } | string;
    href?: string;
  }[] = [];
  if (row.path) links.push({ label: t('operations.open'), to: row.path });
  if (row.kind === 'reconciliation')
    links.push({
      label: t('operations.match'),
      to: { pathname: 'match/' + row.id, search },
    });
  if (row.kind === 'reconciliation')
    links.push({
      label: t('operations.resolveDifference'),
      to: { pathname: 'resolve/' + row.id, search },
    });
  else if (row.kind && grant.can)
    links.push({
      label: t('operations.followup'),
      to: { pathname: `followup/${row.kind}/${row.sourceId}`, search },
    });
  if (view === 'statements')
    for (const format of ['pdf', 'xlsx'])
      links.push({
        label: t(format === 'pdf' ? 'operations.pdf' : 'operations.export'),
        href: resolveAppUrl(
          `/api/tenantOperations/statements/${row.id}/export?format=${format}&locale=${locale}`,
        ),
      });
  if (links.length === 1) {
    const link = links[0];
    return (
      <Button
        variant='ghost'
        disabled={disabled}
        nativeButton={false}
        render={link.href ? <a href={link.href} /> : <Link to={link.to!} />}
      >
        {link.label}
      </Button>
    );
  }
  return links.length ? (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant='ghost'
            size='icon-sm'
            disabled={disabled}
            aria-label={t('operations.actionsFor', { name: row.name })}
          />
        }
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-auto min-w-40'>
        <DropdownMenuGroup>
          {links.map((link) => (
            <DropdownMenuItem
              key={link.label}
              render={
                link.href ? <a href={link.href} /> : <Link to={link.to!} />
              }
            >
              {link.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;
}
