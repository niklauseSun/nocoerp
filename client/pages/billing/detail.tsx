import { EnergyRelated } from '../energy/related.js';
import { InvoiceRelated } from '../invoicing/related.js';
import { useQueryClient, useIsFetching } from '@tanstack/react-query';
import { useCashierPermission } from '../cashier/permission.js';
import { scalar } from '../hyl/model.js';
import {
  Link,
  Outlet,
  useLocation,
  useParams,
  useSearchParams,
  useResolvedPath,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { BackButton } from '#components/back-button';
import { Button } from '#components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { Alert, AlertDescription } from '#components/ui/alert';
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from '#components/ui/table';
import { LongText } from '#components/long-text';
import { useBusinessQuery } from '../hyl/hooks.js';
import { Calculation } from './lines.js';
import {
  BillingError,
  Day,
  LoadingRows,
  Metrics,
  Money,
  Paged,
  Refresh,
  State,
  Value,
} from './common.js';
import type { Bill, Receipt, LedgerEntry } from './types.js';

export default function BillingDetail() {
  const params = useParams(),
    { t } = useTranslation(),
    location = useLocation(),
    [search, setSearch] = useSearchParams();
  const queryClient = useQueryClient();
  const cashierCan = useCashierPermission('cashierCheckout');
  const viewPath = useResolvedPath('.').pathname;
  const isBill =
      Math.max(
        viewPath.lastIndexOf('/bills/'),
        viewPath.lastIndexOf('/bill/'),
      ) >
      Math.max(
        viewPath.lastIndexOf('/receipts/'),
        viewPath.lastIndexOf('/receiptDetail/'),
      ),
    kind = isBill ? 'bills' : 'receipts',
    id = isBill ? params.billId : params.receiptId;
  const linePage = Math.max(1, Number(search.get('linePage') || 1)),
    ledgerPage = Math.max(1, Number(search.get('ledgerPage') || 1));
  const result = useBusinessQuery<{ data: Bill & Receipt }>(`${kind}/${id}`, {
    linePage,
    ledgerPage,
    auditPage: Math.max(1, Number(search.get('auditPage') || 1)),
  });
  const receiptQueries = {
    predicate: (q: { queryKey: readonly unknown[] }) =>
      q.queryKey[0] === 'hyl' &&
      q.queryKey[1] === 'receipts' &&
      (q.queryKey[2] as { contractId?: string } | undefined)?.contractId ===
        result.data?.data.contractId,
  };
  const receiptBusy = useIsFetching(receiptQueries);
  const row = result.error ? undefined : result.data?.data,
    allowed = row?.allowedActions ?? [],
    closed = row?.lease.status === 'closed';
  const canDeposit =
    allowed.includes('depositDeduct') &&
    allowed.includes('depositRead') &&
    Number(row?.depositBalance ?? 0) > 0;
  const link = (
    path: string,
    label: string,
    primary = false,
    disabled = false,
  ) => (
    <Button
      nativeButton={false}
      variant={primary ? 'default' : 'outline'}
      disabled={disabled}
      render={<Link to={{ pathname: path, search: location.search }} />}
    >
      {t(`billing.${label}`)}
    </Button>
  );
  const changePage = (key: string, page: number) =>
    setSearch((old) => {
      const next = new URLSearchParams(old);
      next.set(key, scalar(page));
      return next;
    });
  const nested = /\/(?:receiptDetail|bill)\//.test(viewPath);
  const rootPath = viewPath;
  const orderId = scalar(
    (row?.payload as Record<string, unknown> | undefined)?.cashierOrderId ?? '',
  );
  const orderSegments = ['/orders/', '/order/', '/cashierOrder/'];
  const orderAncestor = orderSegments
    .map((segment) => ({
      segment,
      index: viewPath.indexOf(`${segment}${orderId}/`),
    }))
    .find((match) => orderId && match.index >= 0);
  const orderPath = orderAncestor
    ? viewPath.slice(
        0,
        orderAncestor.index + orderAncestor.segment.length + orderId.length,
      )
    : !nested && orderId
      ? `${rootPath}/cashierOrder/${orderId}`
      : undefined;

  const parent = viewPath.slice(0, viewPath.lastIndexOf('/'));
  const back = nested
    ? viewPath.replace(/\/(receiptDetail|bill)\/[^/]+$/, '')
    : /\/contracts\//.test(viewPath)
      ? viewPath.replace(/\/(bills|receipts)\/[^/]+$/, '')
      : parent;
  const sourcePath = (billId?: string, receiptId?: string) => {
    const target = isBill ? receiptId : billId;
    if (!target) return undefined;
    if (!nested) return isBill ? `receiptDetail/${target}` : `bill/${target}`;
    return back.endsWith(`/${isBill ? 'receipts' : 'bills'}/${target}`) ||
      back.endsWith(`/${isBill ? 'receiptDetail' : 'bill'}/${target}`)
      ? back
      : undefined;
  };
  return (
    <>
      <RouteChildPage>
        <PageContainer>
          <BackButton to={{ pathname: back, search: location.search }} />
          <PageHeader
            title={
              row
                ? t(isBill ? 'billing.billDetail' : 'billing.receiptDetail', {
                    number: row.number,
                  })
                : t(`billing.${kind}`)
            }
            actions={
              <>
                {row && !closed ? (
                  isBill ? (
                    <>
                      {row.status === 'draft' && allowed.includes('billWrite')
                        ? link('edit', 'edit')
                        : null}
                      {row.status === 'draft' && allowed.includes('billIssue')
                        ? link('issue', 'issue', true)
                        : null}
                      {row.status === 'issued' &&
                      BigInt(row.remainingCents) > 0n &&
                      allowed.includes('depositDeduct') &&
                      allowed.includes('depositRead')
                        ? link(
                            'deposit',
                            'applyDeposit',
                            canDeposit,
                            !canDeposit,
                          )
                        : null}
                      {row.status === 'issued' &&
                      allowed.includes('receiptReceive')
                        ? link(
                            'receipt',
                            'newReceipt',
                            !canDeposit && BigInt(row.remainingCents) > 0n,
                          )
                        : null}
                      {!closed &&
                      row.status !== 'voided' &&
                      allowed.includes('billVoid')
                        ? link(
                            'void',
                            'void',
                            false,
                            BigInt(row.allocatedCents) > 0n ||
                              BigInt(row.depositCents) > 0n,
                          )
                        : null}
                    </>
                  ) : (
                    <>
                      {row.status !== 'voided' &&
                      allowed.includes('receiptAllocate')
                        ? link(
                            'allocate',
                            'allocate',
                            true,
                            BigInt(row.unusedCents) <= 0n,
                          )
                        : null}
                      {row.status !== 'voided' &&
                      allowed.includes('receiptRefund')
                        ? link(
                            'refund',
                            'refund',
                            false,
                            BigInt(row.unusedCents) <= 0n,
                          )
                        : null}
                      {row.status !== 'voided' &&
                      allowed.includes('receiptReverse')
                        ? link(
                            'void',
                            'void',
                            false,
                            BigInt(row.allocatedCents) > 0n ||
                              BigInt(row.refundedCents) > 0n,
                          )
                        : null}
                    </>
                  )
                ) : null}
                {row && !closed && cashierCan.can && !nested
                  ? link('cashierNew', 'cashierCheckout')
                  : null}
                {!isBill && orderPath ? (
                  <Button
                    nativeButton={false}
                    variant='outline'
                    render={
                      <Link
                        to={{ pathname: orderPath, search: location.search }}
                      />
                    }
                  >
                    {t('cashier.orders')}
                  </Button>
                ) : null}
                <Refresh
                  busy={result.isFetching || receiptBusy > 0}
                  onClick={() => {
                    void queryClient.invalidateQueries({ queryKey: ['hyl'] });
                  }}
                />
                {row &&
                !isBill &&
                !closed &&
                row.status !== 'voided' &&
                BigInt(row.unusedCents) === 0n &&
                (allowed.includes('receiptAllocate') ||
                  allowed.includes('receiptRefund')) ? (
                  <p className='text-sm text-muted-foreground'>
                    {t('billing.noUnusedFunds')}
                  </p>
                ) : null}
              </>
            }
          />
          {result.error ? (
            <BillingError
              error={result.error}
              retry={() => void result.refetch()}
            />
          ) : !row ? (
            <LoadingRows />
          ) : (
            <>
              <div className='flex flex-wrap gap-2'>
                <State
                  value={
                    !isBill && row.displayStatus === 'partial'
                      ? 'partlyAllocated'
                      : row.displayStatus
                  }
                />
                {row.overdue ? <State value='overdue' /> : null}
                {isBill && row.amountCents === '0' ? (
                  <span className='text-sm text-muted-foreground'>
                    {t('billing.zero')}
                  </span>
                ) : null}
              </div>
              {!closed &&
              row.status !== 'voided' &&
              (BigInt(row.allocatedCents || '0') > 0n ||
                BigInt(row.depositCents || '0') > 0n ||
                BigInt(row.refundedCents || '0') > 0n) ? (
                <p className='text-sm text-muted-foreground'>
                  {t('billing.errors.BILLING_HAS_ALLOCATIONS')}
                </p>
              ) : null}
              {closed ? (
                <Alert>
                  <AlertDescription>
                    {t('billing.readonlyClosed')}
                  </AlertDescription>
                </Alert>
              ) : null}
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
                    !isBill && label === 'amountCents'
                      ? 'receiptAmount'
                      : label,
                  cents: scalar(row[label as keyof typeof row] ?? '0'),
                }))}
              />
              <Card>
                <CardHeader>
                  <CardTitle>{t('billing.fields.contract')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className='flex flex-col gap-3'>
                    <Value label='contract'>
                      {isBill
                        ? scalar(row.payload.contract.number ?? row.contractId)
                        : row.contractNumber || row.contractId}
                    </Value>
                    <Value label='merchant'>
                      {row.merchantName ?? t('billing.restricted')}
                    </Value>
                    <Value label='date'>
                      <Day value={row.date} />
                    </Value>
                    {isBill ? (
                      <>
                        <Value label='start'>
                          <Day value={row.start} />
                        </Value>
                        <Value label='end'>
                          <Day value={row.end} />
                        </Value>
                        <Value label='dueDate'>
                          <Day value={row.dueDate} />
                        </Value>
                        <Value label='rentChannel'>
                          {t(
                            `billing.channels.${row.payload.config.rentChannel}`,
                          )}
                        </Value>
                      </>
                    ) : (
                      <>
                        <Value label='method'>
                          {t(`billing.methods.${row.payload.method}`)}
                        </Value>
                        <Value label='reference'>{row.reference}</Value>
                        <Value label='evidence'>
                          <LongText>{row.payload.evidence || '—'}</LongText>
                        </Value>
                      </>
                    )}
                    <Value label='notes'>
                      <LongText>{row.payload.notes || '—'}</LongText>
                    </Value>
                    <Value label='operator'>{row.payload.actor}</Value>
                  </dl>
                </CardContent>
              </Card>

              {isBill ? (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('billing.lines')}</CardTitle>
                  </CardHeader>
                  <CardContent className='flex flex-col gap-4'>
                    <Calculation lines={row.lines} />
                    <Paged
                      meta={row.linesMeta}
                      onChange={(p) => changePage('linePage', p)}
                      busy={result.isFetching}
                    />
                  </CardContent>
                </Card>
              ) : null}
              <Card>
                <CardHeader>
                  <CardTitle>{t('billing.ledger')}</CardTitle>
                </CardHeader>
                <CardContent className='flex flex-col gap-4'>
                  {(isBill ? row.ledger : row.entries).length ? (
                    <div className='overflow-x-auto'>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {[
                              'source',
                              'date',
                              'amount',
                              'operator',
                              'evidence',
                              'reason',
                              'status',
                            ].map((k) => (
                              <TableHead
                                key={k}
                                className={k === 'amount' ? 'text-right' : ''}
                              >
                                {t(`billing.fields.${k}`)}
                              </TableHead>
                            ))}
                            <TableHead />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(isBill ? row.ledger : row.entries).map(
                            (entry: LedgerEntry) => (
                              <TableRow key={entry.id}>
                                <TableCell>
                                  <div className='flex flex-col gap-1'>
                                    <span>
                                      {t(
                                        `billing.${entry.kind === 'deduct' ? 'applyDeposit' : entry.kind === 'collect' ? 'newReceipt' : entry.kind === 'reverse' ? 'reverseAllocation' : entry.kind}`,
                                      )}
                                    </span>
                                    {sourcePath(
                                      entry.billId,
                                      entry.receiptId,
                                    ) &&
                                    ((isBill &&
                                      entry.receiptId &&
                                      allowed.includes('receiptRead')) ||
                                      (!isBill &&
                                        entry.billId &&
                                        allowed.includes('billingRead'))) ? (
                                      <Link
                                        className='underline'
                                        to={{
                                          pathname: sourcePath(
                                            entry.billId,
                                            entry.receiptId,
                                          ),
                                          search: location.search,
                                        }}
                                      >
                                        {entry.sourceNumber ??
                                          (isBill
                                            ? entry.receiptId
                                            : entry.billId)}
                                      </Link>
                                    ) : (
                                      <span className='text-xs break-all text-muted-foreground'>
                                        {entry.sourceNumber ||
                                          entry.reference ||
                                          '—'}
                                      </span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Day
                                    value={scalar(
                                      entry.payload.date || entry.createdAt,
                                    )}
                                  />
                                </TableCell>
                                <TableCell className='text-right'>
                                  <Money cents={entry.amountCents} />
                                </TableCell>
                                <TableCell>
                                  {scalar(entry.payload.actor || '—')}
                                </TableCell>
                                <TableCell className='whitespace-normal'>
                                  <LongText>
                                    {scalar(entry.payload.evidence || '—')}
                                  </LongText>
                                </TableCell>
                                <TableCell>
                                  <LongText>
                                    {scalar(entry.payload.reason || '—')}
                                  </LongText>
                                </TableCell>
                                <TableCell>
                                  {entry.reverseOf ? (
                                    <span>
                                      {t('billing.reverseAllocation')}
                                    </span>
                                  ) : entry.reversed ? (
                                    <span>{t('billing.void')}</span>
                                  ) : (
                                    '—'
                                  )}
                                </TableCell>
                                <TableCell>
                                  {!isBill &&
                                  !closed &&
                                  !entry.reverseOf &&
                                  !entry.reversed &&
                                  ['allocate', 'refund'].includes(entry.kind) &&
                                  allowed.includes('receiptReverse') ? (
                                    link(
                                      `${entry.kind === 'allocate' ? 'reverseAllocation' : 'reverseRefund'}/${entry.id}`,
                                      entry.kind === 'allocate'
                                        ? 'reverseAllocation'
                                        : 'reverseRefund',
                                    )
                                  ) : isBill &&
                                    entry.sourceType === 'deposit' &&
                                    entry.kind === 'deduct' &&
                                    !entry.reverseOf &&
                                    !entry.reversed &&
                                    allowed.includes('depositReverse') &&
                                    !closed ? (
                                    <Link
                                      className='underline'
                                      to={{
                                        pathname: `reverseDeposit/${entry.id}`,
                                        search: location.search,
                                      }}
                                    >
                                      {t('billing.reverseAllocation')}
                                    </Link>
                                  ) : null}
                                </TableCell>
                              </TableRow>
                            ),
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <p className='text-sm text-muted-foreground'>
                      {t('billing.noData')}
                    </p>
                  )}
                  <Paged
                    meta={isBill ? row.ledgerMeta : row.entriesMeta}
                    onChange={(p) => changePage('ledgerPage', p)}
                    busy={result.isFetching}
                  />
                  {nested ? (
                    <p className='text-sm text-muted-foreground'>
                      {t('billing.deepGuidance')}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
              {isBill ? <EnergyRelated kind='bill' /> : null}
              <InvoiceRelated
                kind={isBill ? 'billId' : 'receiptId'}
                id={row.id}
              />
              {row.eventsMeta ? (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('billing.events')}</CardTitle>
                  </CardHeader>
                  <CardContent className='flex flex-col gap-4'>
                    {(row.events ?? []).map((event) => (
                      <div
                        key={`${event.at}:${event.action}:${event.actor}`}
                        className='flex flex-col gap-2 border-b pb-3'
                      >
                        <div className='flex flex-wrap gap-3'>
                          <span>
                            {t(
                              `billing.${({ createBill: 'create', editBill: 'save', receive: 'newReceipt' } as Record<string, string>)[event.action.replace('billing.', '')] ?? event.action.replace('billing.', '')}`,
                            )}
                          </span>
                          <Day value={event.at} />
                          <span className='text-sm text-muted-foreground'>
                            {event.actor}
                          </span>
                        </div>
                        {event.reason ? (
                          <LongText>{event.reason}</LongText>
                        ) : null}
                        {event.evidence ? (
                          <LongText>{event.evidence}</LongText>
                        ) : null}
                      </div>
                    ))}
                    <Paged
                      meta={row.eventsMeta}
                      onChange={(p) => changePage('auditPage', p)}
                    />
                  </CardContent>
                </Card>
              ) : null}
              {isBill &&
              row.status === 'issued' &&
              allowed.includes('receiptRead') ? (
                <AvailableReceipts
                  contractId={row.contractId}
                  path={rootPath}
                  search={location.search}
                  nested={nested}
                  back={back}
                />
              ) : null}
            </>
          )}
        </PageContainer>
      </RouteChildPage>
      <Outlet />
    </>
  );
}
function AvailableReceipts({
  contractId,
  path,
  search,
  nested,
  back,
}: {
  contractId: string;
  path: string;
  search: string;
  nested: boolean;
  back: string;
}) {
  const { t } = useTranslation(),
    [params, setParams] = useSearchParams(),
    page = Math.max(1, Number(params.get('availablePage') || 1));
  const result = useBusinessQuery<import('./types.js').ListResponse<Receipt>>(
    'receipts',
    { contractId, page, pageSize: 5 },
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('billing.receipts')}</CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-3'>
        {result.error ? (
          <BillingError
            error={result.error}
            retry={() => void result.refetch()}
          />
        ) : !result.data ? (
          <LoadingRows />
        ) : (
          <>
            {result.data.data.map((r) => (
              <div
                key={r.id}
                className='flex flex-wrap items-center justify-between gap-2'
              >
                {nested &&
                !back.endsWith(`/receipts/${r.id}`) &&
                !back.endsWith(`/receiptDetail/${r.id}`) ? (
                  <span>{r.number}</span>
                ) : (
                  <Link
                    className='underline'
                    to={{
                      pathname: nested ? back : `${path}/receiptDetail/${r.id}`,
                      search,
                    }}
                  >
                    {r.number}
                  </Link>
                )}
                <Money cents={r.unusedCents} />
              </div>
            ))}
            <Paged
              meta={result.data.meta}
              onChange={(p) =>
                setParams((old) => {
                  const n = new URLSearchParams(old);
                  n.set('availablePage', scalar(p));
                  return n;
                })
              }
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
