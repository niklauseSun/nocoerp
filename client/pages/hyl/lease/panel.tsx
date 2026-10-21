import { LongText } from '#components/long-text';
import { LeaseStatus } from './status.js';
import { Link, useLocation, useSearchParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { MoreHorizontal } from 'lucide-react';
import { useBusinessPermission, useBusinessQuery } from '../hooks.js';
import { amountText, scalar, type BusinessRow } from '../model.js';
import { ErrorPanel, LoadingRows } from '../common.js';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { Button } from '#components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from '#components/ui/dropdown-menu';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '#components/ui/table';
import { permissions, type LeaseSummary, type LeaseEntry } from './model.js';
function Action({ action, source }: { action: string; source?: string }) {
  const can = useBusinessPermission('contracts', permissions[action]),
    { t } = useTranslation(),
    location = useLocation();
  const query = new URLSearchParams(location.search);
  if (source) query.set('sourceId', source);
  else query.delete('sourceId');
  return can.can ? (
    <DropdownMenuItem
      render={
        <Link to={{ pathname: `lease/${action}`, search: query.toString() }} />
      }
    >
      {t(`lease.actions.${action}`)}
    </DropdownMenuItem>
  ) : null;
}
function Actions({
  actions,
  source,
  allowed,
  name,
}: {
  actions: string[];
  source?: string;
  allowed?: string[];
  name?: string;
}) {
  const { t } = useTranslation();
  const available = allowed
    ? actions.filter((a) => allowed.includes(permissions[a]))
    : actions;
  if (!available.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant='ghost'
            size='icon'
            aria-label={t('hyl.actions.more', { name: source ?? name ?? '—' })}
          />
        }
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuGroup>
          {available.map((a) => (
            <Action key={a} action={a} source={source} />
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
export function LeaseActions({ row }: { row: BusinessRow }) {
  const lease = row.lease as
    { status: string; payload: Record<string, unknown> } | undefined;
  return (
    <Actions
      allowed={row.allowedLeaseActions}
      name={row.number}
      actions={
        lease?.status === 'closed'
          ? ['reopenLease']
          : lease?.status === 'terminated'
            ? ['receive', 'deduct', 'refund', 'collect', 'charge', 'closeLease']
            : [
                'receive',
                'deduct',
                'refund',
                'collect',
                'charge',
                ...(!lease?.payload.successorId ? ['renew'] : []),
                'terminate',
              ]
      }
    />
  );
}
export function LeasePanel({ row }: { row: BusinessRow }) {
  const { t, i18n } = useTranslation(),
    location = useLocation(),
    [params, setParams] = useSearchParams();
  const can = useBusinessPermission('contracts', 'depositRead');
  const result = useBusinessQuery<{ data: LeaseSummary }>(
    `contracts/${row.id}/leaseSummary`,
    undefined,
    can.can,
  );
  const lease = row.lease as
    | { status: string; actualEnd: string; payload: Record<string, unknown> }
    | undefined;
  const summary = result.data?.data;
  const page = Math.max(1, Number(params.get('ledgerPage')) || 1),
    entries = summary?.entries ?? [],
    reversed = new Set(
      entries.filter((e) => e.reverseOf).map((e) => e.reverseOf),
    );
  const chargePage = Math.max(1, Number(params.get('chargePage')) || 1);
  const format = (n: string | number) => amountText(n, i18n.language);
  const sum = (kind: string) =>
    entries
      .filter((e) => e.kind === kind && !reversed.has(e.id))
      .reduce((n, e) => n + Number(e.amountCents) / 100, 0);
  const money = (title: string, value: string | number) => (
    <div key={title}>
      <dt className='text-sm text-muted-foreground'>{t(`lease.${title}`)}</dt>
      <dd className='font-medium tabular-nums'>{format(value)}</dd>
    </div>
  );
  const sourceLink = (entry: LeaseEntry) =>
    summary?.bills?.some((b) => b.id === entry.sourceId) ? (
      <Link
        className='underline'
        to={{ pathname: `bills/${entry.sourceId}`, search: location.search }}
      >
        {summary.bills.find((b) => b.id === entry.sourceId)?.number}
      </Link>
    ) : summary?.settlements.some((s) => s.id === entry.sourceId) ? (
      <Link
        className='underline'
        to={{
          pathname: `settlement/${entry.sourceId}`,
          search: location.search,
        }}
      >
        {summary.settlements.find((s) => s.id === entry.sourceId)?.number}
      </Link>
    ) : (
      (summary?.charges.find((c) => c.id === entry.sourceId)?.payload
        .reason as string) || '—'
    );
  return (
    <div className='flex flex-col gap-6'>
      <Card>
        <CardHeader>
          <CardTitle>{t('lease.lifecycle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className='grid gap-4 sm:grid-cols-3'>
            <div>
              <dt>{t('lease.status')}</dt>
              <dd>
                <LeaseStatus
                  status={row.leaseState ?? lease?.status ?? 'active'}
                />
              </dd>
            </div>
            <div>
              <dt>{t('lease.actualEnd')}</dt>
              <dd>{lease?.actualEnd || '—'}</dd>
            </div>
            {['predecessorId', 'successorId'].map((k) => (
              <div key={k}>
                <dt>{t(`lease.${k}`)}</dt>
                <dd>
                  {lease?.payload[k] ? (
                    <Link
                      className='underline'
                      to={{
                        pathname: `../${scalar(lease.payload[k])}`,
                        search: location.search,
                      }}
                    >
                      {t('hyl.actions.view')}
                    </Link>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {lease?.payload.handover ? (
            <div className='mt-4 break-words text-sm'>
              {t('lease.handover')}：
              <LongText>{scalar(lease.payload.handover)}</LongText>
            </div>
          ) : null}
        </CardContent>
      </Card>
      {!can.can ? (
        <p className='text-sm text-muted-foreground'>
          {t('lease.noFinancialAccess')}
        </p>
      ) : null}
      {can.can ? (
        result.isPending ? (
          <LoadingRows />
        ) : result.error ? (
          <ErrorPanel
            error={result.error}
            retry={() => void result.refetch()}
          />
        ) : summary ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>{t('lease.deposit')}</CardTitle>
                <p className='text-sm text-muted-foreground'>
                  {t('lease.ledgerOnly')}
                </p>
              </CardHeader>
              <CardContent>
                <dl className='grid gap-4 sm:grid-cols-3'>
                  {money('target', summary.depositTarget)}
                  {money('balance', summary.balance)}
                  {money(
                    'shortfall',
                    summary.status === 'active' && row.leaseState !== 'expired'
                      ? Math.max(
                          0,
                          Number(summary.depositTarget) -
                            Number(summary.balance),
                        )
                      : 0,
                  )}
                  {[
                    'receive',
                    'deduct',
                    'refund',
                    'transferIn',
                    'transferOut',
                  ].map((k) => money(k, sum(k)))}
                </dl>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t('lease.ledger')}</CardTitle>
              </CardHeader>
              <CardContent>
                {entries.length ? (
                  <>
                    <div className='overflow-x-auto'>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {[
                              'date',
                              'kind',
                              'amount',
                              'reference',
                              'source',
                              'actor',
                              'state',
                              'details',
                              'actions',
                            ].map((k) => (
                              <TableHead key={k}>
                                {t(
                                  `lease.${k === 'actions' ? 'actionsLabel' : k}`,
                                )}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {entries
                            .slice((page - 1) * 10, page * 10)
                            .map((e) => (
                              <TableRow key={e.id}>
                                <TableCell className='whitespace-nowrap'>
                                  {scalar(e.payload.date) ||
                                    e.createdAt.slice(0, 10)}
                                </TableCell>
                                <TableCell>
                                  {t(`lease.kinds.${e.kind}`)}
                                </TableCell>
                                <TableCell className='tabular-nums whitespace-nowrap'>
                                  {format(Number(e.amountCents) / 100)}
                                </TableCell>
                                <TableCell>{e.reference || '—'}</TableCell>
                                <TableCell>{sourceLink(e)}</TableCell>
                                <TableCell>{scalar(e.payload.actor)}</TableCell>
                                <TableCell>
                                  {reversed.has(e.id)
                                    ? t('lease.reversed')
                                    : e.reverseOf
                                      ? t('lease.reversal')
                                      : t('lease.recorded')}
                                </TableCell>
                                <TableCell>
                                  <details className='max-w-xs text-sm'>
                                    <summary className='cursor-pointer'>
                                      {t('lease.details')}
                                    </summary>
                                    <dl className='mt-2 space-y-2 break-words'>
                                      {[
                                        'reason',
                                        'evidence',
                                        'notes',
                                        'method',
                                      ].map((k) => (
                                        <div key={k}>
                                          <dt className='text-muted-foreground'>
                                            {t(`lease.${k}`)}
                                          </dt>
                                          <dd>
                                            <LongText lines={3}>
                                              {k === 'method'
                                                ? t(
                                                    `hyl.enums.${scalar(e.payload[k]) || 'other'}`,
                                                  )
                                                : scalar(e.payload[k]) || '—'}
                                            </LongText>
                                          </dd>
                                        </div>
                                      ))}
                                      {e.reverseOf ? (
                                        <div>
                                          <dt>{t('lease.originalEntry')}</dt>
                                          <dd>
                                            {entries.find(
                                              (x) => x.id === e.reverseOf,
                                            )?.reference || e.reverseOf}
                                          </dd>
                                        </div>
                                      ) : null}
                                    </dl>
                                  </details>
                                </TableCell>
                                <TableCell>
                                  {!e.reverseOf &&
                                  !reversed.has(e.id) &&
                                  [
                                    'receive',
                                    'refund',
                                    'deduct',
                                    'transferIn',
                                    'transferOut',
                                    'collect',
                                  ].includes(e.kind) &&
                                  summary.status !== 'closed' ? (
                                    <Actions
                                      allowed={row.allowedLeaseActions}
                                      name={row.number}
                                      actions={[
                                        e.kind === 'collect'
                                          ? 'reverseCollection'
                                          : 'reverse',
                                      ]}
                                      source={e.id}
                                    />
                                  ) : null}
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                    </div>
                    <div className='mt-4 flex items-center justify-end gap-3'>
                      <span>{t('lease.total', { count: entries.length })}</span>
                      {[page - 1, page + 1].map((p, i) => (
                        <Button
                          key={p}
                          variant='outline'
                          disabled={p < 1 || (p - 1) * 10 >= entries.length}
                          onClick={() =>
                            setParams(
                              (previous) => {
                                const n = new URLSearchParams(previous);
                                n.set('ledgerPage', String(p));
                                return n;
                              },
                              { replace: true },
                            )
                          }
                        >
                          {t(`hyl.actions.${i ? 'next' : 'previous'}`)}
                        </Button>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className='text-sm text-muted-foreground'>
                    {t('lease.emptyLedger')}
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t('lease.charges')}</CardTitle>
                <div className='flex flex-wrap gap-2'>
                  <span className='text-sm'>
                    {t('lease.total', { count: summary.charges.length })}
                  </span>
                  {[chargePage - 1, chargePage + 1].map((p, i) => (
                    <Button
                      key={p}
                      variant='outline'
                      size='sm'
                      disabled={p < 1 || (p - 1) * 10 >= summary.charges.length}
                      onClick={() =>
                        setParams(
                          (old) => {
                            const n = new URLSearchParams(old);
                            n.set('chargePage', String(p));
                            return n;
                          },
                          { replace: true },
                        )
                      }
                    >
                      {t(`hyl.actions.${i ? 'next' : 'previous'}`)}
                    </Button>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                {summary.charges.length ? (
                  <div className='overflow-x-auto'>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {[
                            'reason',
                            'amount',
                            'state',
                            'remaining',
                            'actions',
                          ].map((k) => (
                            <TableHead key={k}>
                              {t(
                                `lease.${k === 'actions' ? 'actionsLabel' : k}`,
                              )}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {summary.charges
                          .slice((chargePage - 1) * 10, chargePage * 10)
                          .map((e) => (
                            <TableRow key={e.id}>
                              <TableCell className='max-w-sm break-words'>
                                <LongText lines={3}>
                                  {scalar(e.payload.title) ||
                                    scalar(e.payload.reason)}
                                </LongText>
                              </TableCell>
                              <TableCell>
                                {format(Number(e.amountCents) / 100)}
                              </TableCell>
                              <TableCell>
                                {t(`lease.states.${e.state}`)}
                              </TableCell>
                              <TableCell>{format(e.remaining)}</TableCell>
                              <TableCell>
                                {summary.status !== 'closed' &&
                                e.state !== 'cancelled' ? (
                                  <Actions
                                    allowed={row.allowedLeaseActions}
                                    name={row.number}
                                    actions={[
                                      ...(e.state === 'draft'
                                        ? ['confirmCharge']
                                        : ['deduct', 'collect']),
                                      'cancelCharge',
                                    ]}
                                    source={e.id}
                                  />
                                ) : null}
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className='text-sm text-muted-foreground'>
                    {t('lease.emptyCharges')}
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t('lease.bills')}</CardTitle>
              </CardHeader>
              <CardContent>
                {summary.settlements.length ? (
                  <div className='overflow-x-auto'>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {[
                            'number',
                            'period',
                            'state',
                            'remaining',
                            'actions',
                          ].map((k) => (
                            <TableHead key={k}>
                              {t(
                                `lease.${k === 'actions' ? 'actionsLabel' : k}`,
                              )}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {summary.settlements.map((s) => (
                          <TableRow key={s.id}>
                            <TableCell>
                              <Link
                                className='underline'
                                to={{
                                  pathname: `settlement/${s.id}`,
                                  search: location.search,
                                }}
                              >
                                {s.number}
                              </Link>
                            </TableCell>
                            <TableCell className='whitespace-nowrap'>
                              {scalar(s.payload.start)} —{' '}
                              {scalar(s.payload.end)}
                            </TableCell>
                            <TableCell>
                              {s.status === 'due'
                                ? t(
                                    Number(s.debtRemaining) === 0
                                      ? 'lease.collected'
                                      : Number(s.debtRemaining) <
                                          -Number(s.amountCents) / 100
                                        ? 'lease.partialCollection'
                                        : 'lease.pendingCollection',
                                  )
                                : t(`hyl.states.${s.status}`)}
                            </TableCell>
                            <TableCell>{format(s.debtRemaining)}</TableCell>
                            <TableCell>
                              {s.status === 'due' &&
                              Number(s.debtRemaining) > 0 &&
                              summary.status !== 'closed' ? (
                                <Actions
                                  allowed={row.allowedLeaseActions}
                                  name={row.number}
                                  actions={['deduct', 'collect']}
                                  source={s.id}
                                />
                              ) : null}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className='text-sm text-muted-foreground'>
                    {t('lease.emptyBills')}
                  </p>
                )}
              </CardContent>
            </Card>
          </>
        ) : null
      ) : null}
    </div>
  );
}
