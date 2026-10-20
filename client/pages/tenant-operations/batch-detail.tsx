import { useState } from 'react';
import { Link, Outlet, useLocation, useParams } from 'react-router';
import { resolveAppUrl } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { StatusBadge } from '#components/status-badge';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { Button } from '#components/ui/button';
import { Checkbox } from '#components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';
import { useBusinessQuery } from '../hyl/hooks.js';
import {
  LoadingRows,
  BillingError,
  Money,
  Truncated,
  Refresh,
} from '../billing/common.js';
import { RecordedAt } from '../cashier/common.js';
import { useLeave } from '../inspections/leave.js';
import type {
  Batch,
  BatchItem,
} from '../../../server/tenant-operations/delivery-model.js';
import { Cover, DeliveryStatus, Reason } from './delivery-common.js';
import {
  useDeliveryWrite,
  toggleSelection,
  useRefreshMissing,
} from './delivery-hooks.js';
interface Detail {
  batch: Batch;
  status: string;
  canGenerate: boolean;
  canReviewPermission: boolean;
  items: (BatchItem & {
    number: string;
    merchantName: string;
    settlementNumber: string;
    settlementStatus: string;
    amountCents: string;
    canReview: boolean;
    canPay: boolean;
  })[];
}
export default function BatchDetail() {
  const { batchId } = useParams(),
    l = useLocation(),
    { t, i18n } = useTranslation(),
    w = useDeliveryWrite(),
    r = useBusinessQuery<{ data: Detail }>(
      'tenantOperations/batches/' + batchId,
    ),
    [selected, setSelected] = useState<string[]>([]);
  useLeave(false, w.busy);
  useRefreshMissing(r.error || w.error);
  const d = r.error ? undefined : r.data?.data,
    items = d?.items ?? [],
    run = async (action: string) => {
      const result = await w.write(
        'tenantOperations/batches/' + batchId + '/run',
        { action, itemIds: selected },
        t('operations.batchResult'),
      );
      if (result) setSelected([]);
    };
  return (
    <>
      <Cover
        title={d?.batch.number || t('operations.batches')}
        description={t('operations.notPaymentProof')}
        actions={
          <>
            {items.some((i) => i.canPay) ? (
              <Button
                variant='outline'
                nativeButton={false}
                render={
                  <a
                    href={resolveAppUrl(
                      `/api/tenantOperations/batches/${batchId}/paymentExport?locale=${i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US'}`,
                    )}
                  />
                }
              >
                {t('operations.paymentList')}
              </Button>
            ) : null}
            <Refresh
              busy={r.isFetching || w.busy}
              onClick={() => void r.refetch()}
            />
          </>
        }
      >
        {r.error ? (
          <BillingError error={r.error} retry={() => void r.refetch()} />
        ) : r.isPending ? (
          <LoadingRows />
        ) : d ? (
          <>
            <div className='flex flex-wrap items-center gap-3'>
              <DeliveryStatus status={d.status} />
              <span>
                {d.batch.month} · {t('operations.parts.' + d.batch.part)}
              </span>
              <span>
                {t('operations.progress')}{' '}
                {items.filter((i) => i.settlementId).length}/{items.length}
              </span>
            </div>
            {selected.length ? (
              <div className='flex flex-wrap items-center gap-2'>
                <span className='text-sm'>
                  {t('operations.selected', { count: selected.length })}
                </span>
                {d.canGenerate ? (
                  <>
                    <Button
                      disabled={
                        w.busy ||
                        !items.some(
                          (i) => selected.includes(i.id) && !i.settlementId,
                        )
                      }
                      onClick={() => void run('generate')}
                    >
                      {w.busy
                        ? t('hyl.copy.saving')
                        : t('operations.generateSelected')}
                    </Button>
                    <Button
                      variant='outline'
                      disabled={
                        w.busy ||
                        !items.some(
                          (i) =>
                            selected.includes(i.id) &&
                            !i.settlementId &&
                            i.payload.attempts.at(-1)?.outcome === 'failed',
                        )
                      }
                      onClick={() => void run('retry')}
                    >
                      {t('operations.retryFailed')}
                    </Button>
                  </>
                ) : null}
                {d.canReviewPermission ? (
                  <Button
                    variant='outline'
                    disabled={
                      w.busy ||
                      !items.some((i) => selected.includes(i.id) && i.canReview)
                    }
                    onClick={() => void run('review')}
                  >
                    {t('operations.reviewSelected')}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {d.status === 'failed' ? (
              <p className='text-sm text-muted-foreground'>
                {t('operations.failedItems')}
              </p>
            ) : null}
            <div className='overflow-x-auto'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <Checkbox
                        aria-label={t('operations.selectAll')}
                        disabled={w.busy}
                        checked={
                          items.length > 0 && selected.length === items.length
                        }
                        onCheckedChange={(v) =>
                          setSelected(v ? items.map((i) => i.id) : [])
                        }
                      />
                    </TableHead>
                    {[
                      'contract',
                      'tenant',
                      'settlement',
                      'status',
                      'amount',
                      'reasonLabel',
                    ].map((k) => (
                      <TableHead
                        key={k}
                        className={k === 'amount' ? 'text-right' : undefined}
                      >
                        {t('operations.' + k)}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>
                        <Checkbox
                          aria-label={
                            t('operations.selection') + ' ' + i.number
                          }
                          disabled={w.busy}
                          checked={selected.includes(i.id)}
                          onCheckedChange={(v) =>
                            setSelected((s) => toggleSelection(s, i.id, !!v))
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Link
                          to={{
                            pathname: 'contract/' + i.contractId,
                            search: l.search,
                          }}
                        >
                          <Truncated>{i.number}</Truncated>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Truncated>{i.merchantName}</Truncated>
                      </TableCell>
                      <TableCell>
                        {i.settlementId ? (
                          <Link
                            to={{
                              pathname: 'settlement/' + i.settlementId,
                              search: l.search,
                            }}
                            className='underline'
                          >
                            <Truncated>{i.settlementNumber}</Truncated>
                          </Link>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        {i.settlementId ? (
                          <StatusBadge tone='info'>
                            {t(
                              'operations.statementStatuses.' +
                                i.settlementStatus,
                            )}
                          </StatusBadge>
                        ) : (
                          <DeliveryStatus
                            status={
                              i.payload.attempts.at(-1)?.outcome === 'failed'
                                ? 'failed'
                                : 'ready'
                            }
                          />
                        )}
                      </TableCell>
                      <TableCell className='text-right'>
                        <Money cents={i.amountCents} />
                      </TableCell>
                      <TableCell>
                        <Reason
                          reason={i.payload.attempts.at(-1)?.reason || ''}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>{t('operations.attempts')}</CardTitle>
              </CardHeader>
              <CardContent className='flex flex-col gap-3'>
                {items.flatMap((i) =>
                  i.payload.attempts.map((a) => (
                    <p
                      key={i.id + ':' + a.at + ':' + a.action}
                      className='break-all text-sm'
                    >
                      {i.number} · <RecordedAt value={a.at} /> ·{' '}
                      {t('operations.' + a.action)} ·{' '}
                      {t('operations.' + a.outcome)} · {t('operations.actor')}:{' '}
                      {a.actor} · <Reason reason={a.reason} />
                    </p>
                  )),
                )}
                {items.every((i) => !i.payload.attempts.length) ? (
                  <p>{t('operations.noAttempts')}</p>
                ) : null}
              </CardContent>
            </Card>
          </>
        ) : null}
        {w.error ? <BillingError error={w.error} /> : null}
      </Cover>
      <Outlet />
    </>
  );
}
