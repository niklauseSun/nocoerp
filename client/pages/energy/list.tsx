import { ResponsiveTable, MobileSort } from '#components/responsive-table';
import { FilterPicker } from './filter-picker.js';
import { scalar, kindFrom, endpoint, useEnergyCan } from './helpers.js';
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
import { Gauge, MoreHorizontal } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { RouteChildPage } from '#components/route-child-page';
import { Button } from '#components/ui/button';
import { Checkbox } from '#components/ui/checkbox';
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
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#components/ui/dropdown-menu';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '#components/ui/empty';
import { useBusinessQuery } from '../hyl/hooks.js';
import { LeaseDateFilter } from '../hyl/lease/date-filter.js';
import {
  type Item,
  type Page,
  Choice,
  Search,
  Paged,
  BillingError,
  LoadingRows,
  Truncated,
  Refresh,
  State,
  Quantity,
  RecordedAt,
  Day,
  Money,
} from './common.js';
export default function EnergyList({
  readOnly = false,
}: { readOnly?: boolean } = {}) {
  const { t } = useTranslation(),
    p = useParams(),
    l = useLocation(),
    path = useResolvedPath('.').pathname,
    [q, setQ] = useSearchParams(),
    kind = kindFrom(path),
    local = !path.startsWith('/energy/'),
    read = useEnergyCan(
      kind === 'meters'
        ? 'meterRead'
        : kind === 'billing'
          ? 'billGenerate'
          : 'readingRead',
    ),
    write = useEnergyCan(
      kind === 'meters'
        ? 'meterWrite'
        : kind === 'billing'
          ? 'billGenerate'
          : 'readingWrite',
    ),
    readonly = readOnly,
    canWrite = write.can && !readonly,
    [selected, setSelected] = useState<string[]>([]),
    key = (k: string) => (local ? 'energyList:' + path + ':' + k : k),
    get = (k: string) => q.get(key(k)) ?? '',
    set = (k: string, v: string) => {
      setSelected([]);
      setQ((old) => {
        const n = new URLSearchParams(old);
        if (v) n.set(key(k), v);
        else n.delete(key(k));
        if (k !== 'page') n.delete(key('page'));
        return n;
      });
    };
  const query = {
      q: get('q'),
      ...(get('assetId') ? { assetId: get('assetId') } : {}),
      ...(get('contractId') ? { contractId: get('contractId') } : {}),
      type: get('type'),
      status: get('status'),
      billingStatus:
        get('billingStatus') === 'all'
          ? ''
          : get('billingStatus') || (kind === 'billing' ? 'unbilled' : ''),
      from: get('from'),
      to: get('to'),
      orderBy: get('orderBy') || '-updatedAt',
      page: Number(get('page') || 1),
      pageSize: 20,
      ...(p.assetId ? { assetId: p.assetId } : {}),
      ...(p.id
        ? path.startsWith('/assets/')
          ? { assetId: p.id }
          : { contractId: p.id }
        : {}),
      ...(p.billId ? { billId: p.billId } : {}),
    },
    rows = useBusinessQuery<Page<Item>>(endpoint(kind), query, read.can),
    filter = !!(
      get('assetId') ||
      get('contractId') ||
      query.q ||
      query.type ||
      query.status ||
      query.billingStatus ||
      query.from ||
      query.to
    ),
    visible = rows.data?.data ?? [],
    active = selected.filter((id) => visible.some((r) => r.id === id)),
    View = local ? RouteChildPage : Fragment;
  const clear = () => {
      setSelected([]);
      setQ((old) => {
        const n = new URLSearchParams(old);
        [
          'q',
          'assetId',
          'contractId',
          'type',
          'status',
          'billingStatus',
          'from',
          'to',
          'page',
          'orderBy',
        ].forEach((k) => n.delete(key(k)));
        return n;
      });
    },
    back = () => {
      const n = new URLSearchParams(l.search);
      for (const k of [...n.keys()])
        if (k.startsWith('energyList:' + path + ':')) n.delete(k);
      return n.toString();
    },
    primary = readonly ? null : (
      <Button
        variant={active.length ? 'outline' : 'default'}
        nativeButton={false}
        render={
          <Link
            to={{
              pathname: path + (kind === 'billing' ? '/generate' : '/new'),
              search: l.search,
            }}
          />
        }
      >
        {t(
          'energy.' +
            (kind === 'meters'
              ? 'newMeter'
              : kind === 'billing'
                ? 'generate'
                : 'newReading'),
        )}
      </Button>
    );
  const columns =
    kind === 'meters'
      ? [
          'name',
          'type',
          'assetName',
          'installedOn',
          'latestReading',
          'latestReadingEnd',
          'multiplier',
          'updatedAt',
        ]
      : [
          'meterCode',
          'assetName',
          'contractNumber',
          'start',
          'end',
          'previous',
          'current',
          'type',
          'usage',
          'amountCents',
          'billingStatus',
          'updatedAt',
        ];
  return (
    <>
      <View>
        <PageContainer>
          {local ? (
            <BackButton
              to={{
                pathname: path.slice(0, path.lastIndexOf('/')),
                search: back(),
              }}
            />
          ) : null}
          <PageHeader
            title={t(local ? 'energy.' + kind : 'energy.title')}
            description={t('energy.description')}
            actions={
              <>
                {rows.data && (visible.length || filter) && canWrite
                  ? primary
                  : null}
                {kind === 'meters' && canWrite ? (
                  <Button
                    variant='outline'
                    nativeButton={false}
                    render={
                      <Link
                        to={{ pathname: path + '/adopt', search: l.search }}
                      />
                    }
                  >
                    {t('energy.adopt')}
                  </Button>
                ) : null}
                <Refresh
                  busy={rows.isFetching}
                  onClick={() => {
                    setSelected([]);
                    void rows.refetch();
                  }}
                />
              </>
            }
          />
          {!local ? (
            <nav className='flex flex-wrap gap-2'>
              {['meters', 'readings', 'billing'].map((k) => (
                <Button
                  key={k}
                  variant={kind === k ? 'secondary' : 'ghost'}
                  nativeButton={false}
                  render={<Link to={'../' + k} relative='path' />}
                >
                  {t('energy.' + k)}
                </Button>
              ))}
            </nav>
          ) : null}
          {!read.can ? (
            <p>{t('energy.restricted')}</p>
          ) : (
            <>
              <div className='flex flex-wrap items-center gap-2'>
                <Search
                  value={query.q}
                  onChange={(v) => set('q', v)}
                  placeholder={t(
                    kind === 'meters'
                      ? 'energy.searchMeters'
                      : 'energy.searchReadings',
                  )}
                />
                <div className='w-full min-w-0 sm:w-40 sm:shrink-0'>
                  <Choice
                    showMobileLabel
                    value={query.type || 'all'}
                    ariaLabel={t('energy.fields.type')}
                    onChange={(v) => set('type', v === 'all' ? '' : v)}
                    options={['all', 'water', 'electricity'].map((value) => ({
                      value,
                      label: t(
                        value === 'all'
                          ? 'energy.all'
                          : 'energy.types.' + value,
                      ),
                    }))}
                  />
                </div>
                <div className='w-full min-w-0 sm:w-40 sm:shrink-0'>
                  <Choice
                    showMobileLabel
                    value={query.status || 'all'}
                    ariaLabel={t('energy.fields.status')}
                    onChange={(v) => set('status', v === 'all' ? '' : v)}
                    options={[
                      'all',
                      ...(kind === 'meters'
                        ? ['active', 'stopped']
                        : [
                            'draft',
                            'submitted',
                            'approved',
                            'rejected',
                            'voided',
                          ]),
                    ].map((value) => ({
                      value,
                      label: t(
                        value === 'all'
                          ? 'energy.all'
                          : 'energy.states.' + value,
                      ),
                    }))}
                  />
                </div>
                {kind !== 'meters' ? (
                  <div className='w-full min-w-0 sm:w-40 sm:shrink-0'>
                    <Choice
                      showMobileLabel
                      value={
                        get('billingStatus') === 'all'
                          ? 'all'
                          : query.billingStatus || 'all'
                      }
                      ariaLabel={t('energy.fields.billingStatus')}
                      onChange={(v) =>
                        set(
                          'billingStatus',
                          v === 'all' && kind !== 'billing' ? '' : v,
                        )
                      }
                      options={[
                        'all',
                        'unbilled',
                        'reserved',
                        'issued',
                        'released',
                      ].map((value) => ({
                        value,
                        label: t(
                          value === 'all'
                            ? 'energy.all'
                            : 'energy.states.' + value,
                        ),
                      }))}
                    />
                  </div>
                ) : null}
                {!local ? (
                  <FilterPicker
                    kind='assets'
                    value={get('assetId')}
                    onChange={(v) => set('assetId', v)}
                  />
                ) : null}
                {!local && kind !== 'meters' ? (
                  <FilterPicker
                    kind='contracts'
                    value={get('contractId')}
                    onChange={(v) => set('contractId', v)}
                  />
                ) : null}
                <LeaseDateFilter
                  label={t('energy.fields.start')}
                  from={query.from}
                  to={query.to}
                  onChange={(from, to) =>
                    setQ((old) => {
                      const n = new URLSearchParams(old);
                      for (const [k, v] of Object.entries({ from, to }))
                        if (v) n.set(key(k), v);
                        else n.delete(key(k));
                      n.delete(key('page'));
                      return n;
                    })
                  }
                />
                {filter ? (
                  <Button variant='outline' onClick={clear}>
                    {t('energy.clear')}
                  </Button>
                ) : null}
              </div>
              {kind === 'billing' && canWrite ? (
                <p className='text-sm text-muted-foreground'>
                  {t('energy.selectionHelp')}
                </p>
              ) : null}
              {active.length ? (
                <Button
                  disabled={
                    new Set(
                      visible
                        .filter((r) => active.includes(r.id))
                        .map((r) => r.contractId),
                    ).size !== 1
                  }
                  nativeButton={false}
                  render={
                    <Link
                      to={{
                        pathname: path + '/generate',
                        search: new URLSearchParams([
                          ...q.entries(),
                          ['energyReadingIds', active.join(',')],
                          [
                            'energyContractId',
                            visible.find((r) => active.includes(r.id))
                              ?.contractId ?? '',
                          ],
                        ]).toString(),
                      }}
                    />
                  }
                >
                  {t('energy.generate')} ({active.length})
                </Button>
              ) : null}
              {new Set(
                visible
                  .filter((r) => active.includes(r.id))
                  .map((r) => r.contractId),
              ).size > 1 ? (
                <p className='text-sm text-muted-foreground'>
                  {t('energy.singleContract')}
                </p>
              ) : null}
              {rows.error ? (
                <BillingError
                  error={rows.error}
                  retry={() => void rows.refetch()}
                />
              ) : !rows.data ? (
                <LoadingRows />
              ) : !visible.length ? (
                <Empty className='min-h-48 border border-dashed'>
                  <EmptyHeader>
                    <EmptyMedia variant='icon'>
                      <Gauge />
                    </EmptyMedia>
                    <EmptyTitle>
                      {t(filter ? 'energy.noResults' : 'energy.empty')}
                    </EmptyTitle>
                    <EmptyDescription>
                      {t(
                        readonly
                          ? 'energy.emptyReadOnly'
                          : canWrite
                            ? 'energy.empty' + kind
                            : 'energy.restricted',
                      )}
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    {filter ? (
                      <Button variant='outline' onClick={clear}>
                        {t('energy.clear')}
                      </Button>
                    ) : canWrite ? (
                      primary
                    ) : null}
                  </EmptyContent>
                </Empty>
              ) : (
                <>
                  <ResponsiveTable
                    labels={[
                      ...(kind === 'billing' && canWrite
                        ? [t('mobile.select')]
                        : []),
                      t(
                        'energy.fields.' +
                          (kind === 'meters' ? 'code' : 'number'),
                      ),
                      ...columns.map((k) => t('energy.fields.' + k)),
                      t('energy.fields.status'),
                      t('mobile.actions'),
                    ]}
                    titleIndex={kind === 'billing' && canWrite ? 1 : 0}
                    sort={
                      <MobileSort
                        value={query.orderBy}
                        onChange={(v) => set('orderBy', v)}
                        fields={columns
                          .filter((k) =>
                            [
                              'usage',
                              'previous',
                              'current',
                              'amountCents',
                              'updatedAt',
                              'start',
                              'end',
                              'multiplier',
                              'installedOn',
                              'latestReading',
                              'latestReadingEnd',
                            ].includes(k),
                          )
                          .map((k) => ({
                            value: k === 'usage' ? 'usageKey' : k,
                            label: t('energy.fields.' + k),
                          }))}
                      />
                    }
                  >
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {kind === 'billing' && canWrite ? (
                            <TableHead>{t('energy.select')}</TableHead>
                          ) : null}
                          <TableHead>
                            {t(
                              'energy.fields.' +
                                (kind === 'meters' ? 'code' : 'number'),
                            )}
                          </TableHead>
                          {columns.map((k) => (
                            <TableHead
                              key={k}
                              className={
                                [
                                  'usage',
                                  'previous',
                                  'current',
                                  'latestReading',
                                  'multiplier',
                                  'amountCents',
                                ].includes(k)
                                  ? 'text-right'
                                  : ''
                              }
                            >
                              {[
                                'usage',
                                'previous',
                                'current',
                                'amountCents',
                                'updatedAt',
                                'start',
                                'end',
                                'multiplier',
                                'installedOn',
                                'latestReading',
                                'latestReadingEnd',
                              ].includes(k) ? (
                                <button
                                  onClick={() =>
                                    set(
                                      'orderBy',
                                      query.orderBy ===
                                        (k === 'usage' ? 'usageKey' : k)
                                        ? '-' + (k === 'usage' ? 'usageKey' : k)
                                        : k === 'usage'
                                          ? 'usageKey'
                                          : k,
                                    )
                                  }
                                >
                                  {t('energy.fields.' + k)}
                                  {query.orderBy.replace(/^-/, '') ===
                                  (k === 'usage' ? 'usageKey' : k)
                                    ? query.orderBy.startsWith('-')
                                      ? ' ↓'
                                      : ' ↑'
                                    : ''}
                                </button>
                              ) : (
                                t('energy.fields.' + k)
                              )}
                            </TableHead>
                          ))}
                          <TableHead>{t('energy.fields.status')}</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visible.map((r) => (
                          <TableRow key={r.id}>
                            {kind === 'billing' && canWrite ? (
                              <TableCell>
                                <Checkbox
                                  aria-label={t('energy.selectSource', {
                                    number: r.number,
                                  })}
                                  checked={active.includes(r.id)}
                                  disabled={
                                    !['unbilled', 'released'].includes(
                                      scalar(r.billingStatus),
                                    ) ||
                                    (active.length >= 50 &&
                                      !active.includes(r.id))
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
                                <Truncated>{r.number}</Truncated>
                              </Link>
                            </TableCell>
                            {columns.map((k) => (
                              <TableCell
                                key={k}
                                className={
                                  [
                                    'usage',
                                    'multiplier',
                                    'previous',
                                    'current',
                                    'latestReading',
                                    'amountCents',
                                  ].includes(k)
                                    ? 'text-right'
                                    : ''
                                }
                              >
                                {k === 'amountCents' ? (
                                  <Money cents={scalar(r[k]) || '0'} />
                                ) : [
                                    'usage',
                                    'multiplier',
                                    'latestReading',
                                  ].includes(k) ? (
                                  <Quantity value={r[k]} />
                                ) : [
                                    'start',
                                    'end',
                                    'installedOn',
                                    'latestReadingEnd',
                                  ].includes(k) ? (
                                  <Day value={scalar(r[k])} />
                                ) : k === 'updatedAt' ? (
                                  <RecordedAt value={scalar(r[k])} />
                                ) : k === 'billingStatus' ? (
                                  <State value={r[k]} />
                                ) : k === 'type' ? (
                                  <State value={r[k]} />
                                ) : (
                                  <Truncated>{scalar(r[k]) || '—'}</Truncated>
                                )}
                              </TableCell>
                            ))}
                            <TableCell>
                              <State value={r.status} />
                            </TableCell>
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  render={
                                    <Button
                                      size='icon-sm'
                                      variant='ghost'
                                      aria-label={t('energy.rowActions', {
                                        number: r.number,
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
                                    {t('energy.view')}
                                  </DropdownMenuItem>{' '}
                                  {!readonly
                                    ? (kind === 'meters'
                                        ? r.allowedActions.includes(
                                            'meterWrite',
                                          )
                                          ? [
                                              'edit',
                                              ...(r.status === 'active'
                                                ? ['assign', 'handover', 'stop']
                                                : []),
                                            ]
                                          : []
                                        : r.allowedActions.includes(
                                              'readingWrite',
                                            ) &&
                                            ['draft', 'rejected'].includes(
                                              r.status,
                                            )
                                          ? ['edit', 'submit']
                                          : []
                                      ).map((action) => (
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
                                          {t('energy.' + action)}
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
                  </ResponsiveTable>
                  <Paged
                    meta={rows.data.meta}
                    busy={rows.isFetching}
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
