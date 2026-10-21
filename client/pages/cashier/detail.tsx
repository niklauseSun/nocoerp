import { InvoiceRelated } from '../invoicing/related.js';
import { useQueryClient } from '@tanstack/react-query';
import { SplitRelated } from '../profit-sharing/related.js';
import { scalar } from '../hyl/model.js';
import { routeKind } from './helpers.js';
import {
  Link,
  Outlet,
  useLocation,
  useParams,
  useResolvedPath,
  useSearchParams,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { BackButton } from '#components/back-button';
import { Button } from '#components/ui/button';
import { Badge } from '#components/ui/badge';
import { LongText } from '#components/long-text';
import { useBusinessQuery } from '../hyl/hooks.js';
import {
  Group,
  Amounts,
  Money,
  Day,
  RecordedAt,
  Value,
  Refresh,
  LoadingRows,
  BillingError,
} from './common.js';
import { ChannelTable, EventTable } from './reconciliation.js';
import { apiPaths, type CashRow, type Checkout, type Report } from './types.js';
export default function CashierDetail() {
  const cache = useQueryClient();
  const { t } = useTranslation(),
    p = useParams(),
    l = useLocation(),
    path = useResolvedPath('.').pathname,
    kind = routeKind(path),
    [search, setSearch] = useSearchParams();
  const id =
      kind === 'orders'
        ? p.orderId
        : kind === 'refunds'
          ? p.refundId
          : p.reconciliationId,
    result = useBusinessQuery<{ data: CashRow }>(`${apiPaths[kind]}/${id}`),
    row = result.error ? undefined : result.data?.data;
  const parent = path.slice(0, path.lastIndexOf('/'));
  const back = /(?:cashierOrder|order|refund|reconciliation)\/[^/]+$/.test(path)
    ? parent.slice(0, parent.lastIndexOf('/'))
    : parent;
  const allowed = row?.allowedActions ?? [];
  const metricKeys =
    kind === 'orders'
      ? ['receivedCents', 'allocatedCents', 'refundedCents', 'unusedCents']
      : kind === 'refunds'
        ? ['amountCents', 'refundedCents']
        : ['receivedCents', 'refundedCents', 'netCents', 'differenceCents'];
  const input = row?.payload.input as Checkout | undefined;
  const actionSearch = (action: string) => {
    const query = new URLSearchParams(l.search);
    if (action === 'reconciliationNew' && row) {
      query.set('cashierDay', row.day);
      query.set('cashierScope', String(row.payload.scope));
    }
    return query.toString();
  };
  const actionLink = (action: string, label: string, primary = false) => (
    <Button
      nativeButton={false}
      variant={primary ? 'default' : 'outline'}
      disabled={
        row?.closed ||
        (action === 'void' &&
          (BigInt(row?.allocatedCents ?? 0) > 0n ||
            BigInt(row?.refundedCents ?? 0) > 0n ||
            (input?.targets ?? []).some((r) => Number(r.deposit) > 0))) ||
        (action === 'refundNew' &&
          BigInt(row?.receivedCents ?? 0) <= BigInt(row?.refundedCents ?? 0))
      }
      render={
        <Link
          to={{ pathname: `${path}/${action}`, search: actionSearch(action) }}
        />
      }
    >
      {t(`cashier.${label}`)}
    </Button>
  );
  const sourceKey = `cashierSourcePage_${id}`;
  const backSearch = new URLSearchParams(l.search);
  backSearch.delete(sourceKey);
  const members = row?.members ?? [],
    sourcePage = Math.max(1, Number(search.get(sourceKey) ?? 1));
  return (
    <>
      <RouteChildPage>
        <PageContainer>
          <BackButton to={{ pathname: back, search: backSearch.toString() }} />
          <PageHeader
            title={
              row
                ? t(
                    `cashier.${kind === 'orders' ? 'orderTitle' : kind === 'refunds' ? 'refundTitle' : 'reconciliationTitle'}`,
                    { number: row.number },
                  )
                : t(`cashier.${kind}`)
            }
            actions={
              <>
                {row?.status === 'draft' && allowed.includes('cashierCheckout')
                  ? actionLink('edit', 'edit', true)
                  : null}
                {kind === 'orders' &&
                row?.status === 'posted' &&
                allowed.includes('cashierRefund')
                  ? actionLink('refundNew', 'newRefund', true)
                  : null}
                {kind === 'orders' &&
                row?.status !== 'voided' &&
                allowed.includes('cashierReverse')
                  ? actionLink('void', 'void')
                  : null}
                {kind === 'refunds' &&
                ['posted', 'partiallyCorrected'].includes(row?.status ?? '') &&
                allowed.includes('cashierReverse')
                  ? actionLink('reverse', 'reverse')
                  : null}
                {kind === 'reconciliations' &&
                allowed.includes('cashierReconcile')
                  ? actionLink('reconciliationNew', 'revise', true)
                  : null}
                <Refresh
                  busy={result.isFetching}
                  onClick={() =>
                    void cache.invalidateQueries({ queryKey: ['hyl'] })
                  }
                />
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
              {row.closed ? (
                <p className='text-muted-foreground'>{t('cashier.closed')}</p>
              ) : null}
              <Badge variant='secondary'>
                {t(`cashier.states.${row.status}`)}
              </Badge>
              {kind === 'orders' && row.status === 'posted' ? (
                <p className='text-sm text-muted-foreground'>
                  {t('cashier.voidHelp')}
                </p>
              ) : null}
              <Amounts
                labels={
                  kind === 'reconciliations'
                    ? { refundedCents: 'cashier.fields.grossRefundCents' }
                    : undefined
                }
                values={Object.fromEntries(
                  metricKeys.map((k) => [
                    k,
                    scalar(row[k as keyof CashRow] ?? 0),
                  ]),
                )}
              />
              <Group title={t(`cashier.${kind}`)}>
                <dl className='grid gap-3 sm:grid-cols-[8rem_1fr]'>
                  {kind !== 'reconciliations' ? (
                    <Value label={t('cashier.fields.merchant')}>
                      {row.merchantName || '—'}
                    </Value>
                  ) : (
                    <>
                      <Value label={t('cashier.fields.scope')}>
                        {t(`cashier.${String(row.payload.scope)}`)}
                      </Value>
                      <Value label={t('cashier.fields.cashCents')}>
                        <Money cents={scalar(row.payload.cashCents)} />
                      </Value>
                      <Value label={t('cashier.fields.countedCash')}>
                        <Money
                          cents={String(
                            Math.round(Number(row.payload.countedCash) * 100),
                          )}
                        />
                      </Value>
                    </>
                  )}
                  <Value label={t('cashier.fields.day')}>
                    <Day value={row.day} />
                  </Value>
                  <Value label={t('cashier.fields.createdAt')}>
                    <RecordedAt value={row.createdAt} />
                  </Value>
                  <Value label={t('cashier.fields.actor')}>{row.actor}</Value>
                  {kind === 'reconciliations' ? (
                    <Value label={t('cashier.fields.revision')}>
                      {row.revision}
                    </Value>
                  ) : null}
                  <Value label={t('cashier.fields.notes')}>
                    <LongText>
                      {scalar(
                        (row.payload.input as { notes?: string } | undefined)
                          ?.notes ??
                          row.payload.notes ??
                          '—',
                      )}
                    </LongText>
                  </Value>
                </dl>
              </Group>
              {kind === 'orders' && input ? (
                <Group title={t('cashier.fields.original')}>
                  {input.targets.map((r) => (
                    <div
                      key={r.billId}
                      className='flex flex-wrap justify-between gap-3'
                    >
                      <Link
                        className='underline'
                        to={{
                          pathname: `${path}/bill/${r.billId}`,
                          search: l.search,
                        }}
                      >
                        {row.members?.find(
                          (m) => m.kind === 'bill' && m.sourceId === r.billId,
                        )?.number || r.billId}
                      </Link>
                      <span>
                        {t('cashier.fields.allocatedCents')}{' '}
                        <Money
                          cents={scalar(Math.round(Number(r.amount) * 100))}
                        />
                      </span>
                      <span>
                        {t('cashier.fields.deposit')}{' '}
                        <Money
                          cents={scalar(Math.round(Number(r.deposit) * 100))}
                        />
                      </span>
                    </div>
                  ))}
                  {input.payments.map((payment) => (
                    <div
                      key={payment.key}
                      className='flex flex-col gap-2 border-t pt-3'
                    >
                      <span>
                        {t(`cashier.methods.${payment.method}`)} ·{' '}
                        {payment.reference} ·{' '}
                        <Money
                          cents={scalar(
                            Math.round(Number(payment.amount) * 100),
                          )}
                        />
                      </span>
                      <LongText>{payment.evidence}</LongText>
                    </div>
                  ))}
                </Group>
              ) : null}
              {kind === 'reconciliations' ? (
                <>
                  <p className='text-sm text-muted-foreground'>
                    {t('cashier.revisionHelp')}
                  </p>
                  {row.laterEvents ? (
                    <p>{t('cashier.lateEvents', { count: row.laterEvents })}</p>
                  ) : null}
                  {(row.payload as unknown as Report).unclassified ? (
                    <p>{t('cashier.unclassified')}</p>
                  ) : null}
                  <ChannelTable report={row.payload as unknown as Report} />
                  <Group title={t('cashier.sources')}>
                    <EventTable
                      events={(row.payload.events ?? []) as Report['events']}
                      path={path}
                      search={l.search}
                    />
                  </Group>
                </>
              ) : (
                <Group title={t('cashier.sources')}>
                  {members
                    .slice((sourcePage - 1) * 20, sourcePage * 20)
                    .map((m) => (
                      <div key={`${m.kind}:${m.sourceId}`}>
                        <Link
                          className='underline'
                          to={{
                            pathname: `${path}/${m.kind === 'receipt' ? 'receiptDetail' : m.kind === 'bill' ? 'bill' : 'contract'}/${m.sourceId}`,
                            search: l.search,
                          }}
                        >
                          {t(
                            `cashier.fields.${m.kind === 'receipt' ? 'reference' : m.kind === 'bill' ? 'source' : 'contract'}`,
                          )}{' '}
                          · {m.number || m.sourceId}
                        </Link>
                      </div>
                    ))}
                  {members.length > 20 ? (
                    <div className='flex justify-end gap-2'>
                      <Button
                        variant='outline'
                        disabled={sourcePage === 1}
                        onClick={() =>
                          setSearch((old) => {
                            const n = new URLSearchParams(old);
                            n.set(sourceKey, scalar(sourcePage - 1));
                            return n;
                          })
                        }
                      >
                        {t('hyl.actions.previous')}
                      </Button>
                      <Button
                        variant='outline'
                        disabled={sourcePage * 20 >= members.length}
                        onClick={() =>
                          setSearch((old) => {
                            const n = new URLSearchParams(old);
                            n.set(sourceKey, scalar(sourcePage + 1));
                            return n;
                          })
                        }
                      >
                        {t('hyl.actions.next')}
                      </Button>
                    </div>
                  ) : null}
                </Group>
              )}
              {kind !== 'reconciliations' ? (
                <InvoiceRelated
                  kind={
                    kind === 'orders' ? 'cashierOrderId' : 'cashierRefundId'
                  }
                  id={row.id}
                />
              ) : null}
              {kind === 'orders' ? (
                <SplitRelated kind='cashier' id={row.id} />
              ) : null}
              <Group title={t('cashier.history')}>
                {row.events?.map((e) => (
                  <div
                    key={`${e.action}:${e.at}`}
                    className='flex flex-wrap gap-3'
                  >
                    <RecordedAt value={e.at} />
                    <span>{t(`cashier.audit.${e.action}`)}</span>
                    <span>{e.actor}</span>
                  </div>
                ))}
                {[
                  'reason',
                  'evidence',
                  'voidReason',
                  'voidEvidence',
                  'differenceReason',
                ].map((key) =>
                  row.payload[key] ? (
                    <LongText key={key}>{scalar(row.payload[key])}</LongText>
                  ) : null,
                )}
                {kind === 'refunds' ? (
                  <RefundEvidence
                    input={
                      row.payload.input as {
                        reason: string;
                        evidence: string;
                        reference: string;
                      }
                    }
                  />
                ) : null}
                {row.payload.correction ? (
                  <LongText>
                    {scalar(
                      (row.payload.correction as { reason?: string }).reason ??
                        '—',
                    )}
                  </LongText>
                ) : null}
              </Group>
            </>
          )}
        </PageContainer>
      </RouteChildPage>
      <Outlet />
    </>
  );
}
function RefundEvidence({
  input,
}: {
  input: { reason: string; evidence: string; reference: string };
}) {
  return (
    <>
      <LongText>{input.reason}</LongText>
      <LongText>{input.evidence}</LongText>
      <LongText>{input.reference}</LongText>
    </>
  );
}
