import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { RouteDialog } from '#components/route-dialog';
import { Button } from '#components/ui/button';
import { Textarea } from '#components/ui/textarea';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import { useBusinessQuery } from '../hyl/hooks.js';
import {
  BillingError,
  LoadingRows,
  Money,
  Day,
  Truncated,
} from '../billing/common.js';
import { useLeave } from '../inspections/leave.js';
import { DiscardDialog } from '../hyl/discard-dialog.js';
import {
  matchBatchSchema,
  type BankRow,
} from '../../../server/tenant-operations/model.js';
import { useDeliveryWrite } from './delivery-hooks.js';
import { Reason } from './delivery-common.js';
interface Preview {
  data: {
    items: { row: BankRow; candidates: { id: string }[]; canWrite: boolean }[];
  };
}
export default function BankBatch() {
  const l = useLocation(),
    navigate = useNavigate(),
    w = useDeliveryWrite(),
    [requestId] = useState(() => crypto.randomUUID()),
    [reason, setReason] = useState(''),
    [attempted, setAttempted] = useState(false),
    [results, setResults] =
      useState<{ rowId: string; status: string; reason: string }[]>();
  const params = new URLSearchParams(l.search),
    ids = params.get('rowIds') || '';
  params.delete('rowIds');
  const back = { pathname: '/tenantOperations', search: params.toString() },
    leave = useLeave(!!reason, w.busy);
  const r = useBusinessQuery<Preview>(
      'tenantOperations/reconciliation/batchPreview',
      { rowIds: ids },
    ),
    items = r.error ? [] : (r.data?.data.items ?? []),
    valid =
      items.length > 0 &&
      items.every((i) => i.canWrite && i.candidates.length === 1);
  const close = () => {
    leave.allow();
    void navigate(back);
  };
  const submit = async () => {
    setAttempted(true);
    if (!valid || !reason.trim()) {
      document.getElementById('bank-batch-reason')?.focus();
      return;
    }
    const body = matchBatchSchema.parse({
      requestId,
      reason,
      items: items.map((i) => ({
        rowId: i.row.id,
        eventId: i.candidates[0].id,
      })),
    });
    const result = await w.write<
      { rowId: string; status: string; reason: string }[]
    >(
      'tenantOperations/reconciliation/confirmBatch',
      body,
      w.t('operations.saved'),
    );
    if (result) {
      setResults(result);
      leave.allow();
    }
  };
  return (
    <>
      <RouteDialog
        title={w.t('operations.batchMatchTitle')}
        closeTo={back}
        beforeClose={leave.guard}
        footer={
          <>
            <Button
              variant='outline'
              disabled={w.busy}
              onClick={() =>
                void (async () => {
                  if (await leave.guard()) close();
                })()
              }
            >
              {w.t('operations.cancel')}
            </Button>
            {!results ? (
              <Button disabled={w.busy || !valid} onClick={() => void submit()}>
                {w.busy ? w.t('hyl.copy.saving') : w.t('operations.confirm')}
              </Button>
            ) : null}
          </>
        }
      >
        {r.error ? (
          <BillingError error={r.error} retry={() => void r.refetch()} />
        ) : r.isPending ? (
          <LoadingRows />
        ) : (
          <div className='flex flex-col gap-4'>
            <p className='text-sm text-muted-foreground'>
              {w.t('operations.batchMatchHelp')}
            </p>
            <p>
              {w.t('operations.batchMatchPreview', { count: items.length })}{' '}
              <Money
                cents={String(
                  items.reduce((n, i) => n + BigInt(i.row.amountCents), 0n),
                )}
              />
            </p>
            {items.map((i) => (
              <p key={i.row.id} className='break-all text-sm'>
                <Truncated>{i.row.externalId}</Truncated> ·{' '}
                <Day value={i.row.date} /> · <Money cents={i.row.amountCents} />{' '}
                ·{' '}
                {w.t(
                  i.canWrite && i.candidates.length === 1
                    ? 'operations.statuses.candidate'
                    : 'operations.statuses.ambiguous',
                )}
              </p>
            ))}
            {!results ? (
              <Field>
                <FieldLabel htmlFor='bank-batch-reason'>
                  {w.t('operations.reason')}
                </FieldLabel>
                <Textarea
                  id='bank-batch-reason'
                  value={reason}
                  maxLength={1000}
                  disabled={w.busy}
                  onChange={(e) => setReason(e.target.value)}
                />
                {attempted && !reason.trim() ? (
                  <FieldError>{w.t('operations.requiredField')}</FieldError>
                ) : null}
              </Field>
            ) : (
              <div role='status'>
                <p>
                  {w.t('operations.batchMatchResult', {
                    success: results.filter((i) => i.status === 'matched')
                      .length,
                    failed: results.filter((i) => i.status !== 'matched')
                      .length,
                  })}
                </p>
                {results
                  .filter((i) => i.status !== 'matched')
                  .map((i) => (
                    <p key={i.rowId} className='break-all text-sm'>
                      {i.rowId} · <Reason reason={i.reason} />
                    </p>
                  ))}
              </div>
            )}
            {w.error ? <BillingError error={w.error} /> : null}
          </div>
        )}
      </RouteDialog>
      <DiscardDialog
        open={leave.discard}
        onOpenChange={(v) => {
          if (!v) leave.dismiss();
        }}
        onConfirm={() => leave.accept(close)}
      />
    </>
  );
}
