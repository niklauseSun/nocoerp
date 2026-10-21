import { useState, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { RouteDialog } from '#components/route-dialog';
import { Button } from '#components/ui/button';
import { Textarea } from '#components/ui/textarea';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import { LongText } from '#components/long-text';
import { useBusinessQuery } from '../hyl/hooks.js';
import {
  BillingError,
  LoadingRows,
  Choice,
  DateField,
  Money,
  Day,
} from '../billing/common.js';
import { RecordedAt } from '../cashier/common.js';
import { today } from '../financial-reports/hooks.js';
import { useLeave } from '../inspections/leave.js';
import { DiscardDialog } from '../hyl/discard-dialog.js';
import {
  resolutionSchema,
  type BankRow,
  type BankResolution,
} from '../../../server/tenant-operations/model.js';
import { useDeliveryWrite } from './delivery-hooks.js';
export default function BankResolution() {
  const { bankRowId } = useParams(),
    l = useLocation(),
    navigate = useNavigate(),
    w = useDeliveryWrite(),
    [requestId] = useState(() => crypto.randomUUID()),
    [note, setNote] = useState(''),
    [nextDate, setNextDate] = useState(today),
    [conclusion, setConclusion] = useState('investigating'),
    [attempted, setAttempted] = useState(false),
    ref = useRef<HTMLTextAreaElement>(null);
  const r = useBusinessQuery<{
      data: {
        row: BankRow;
        mayConfirm: boolean;
        resolutions: BankResolution[];
      };
    }>('tenantOperations/reconciliation/' + bankRowId),
    d = r.error ? undefined : r.data?.data,
    leave = useLeave(!!note, w.busy),
    back = { pathname: '/tenantOperations', search: l.search };
  const close = () => {
    leave.allow();
    void navigate(back);
  };
  const parsed = resolutionSchema.safeParse({
    requestId,
    rowId: bankRowId,
    note,
    nextDate,
    conclusion,
  });
  const submit = async () => {
    setAttempted(true);
    if (!parsed.success) {
      ref.current?.focus();
      return;
    }
    const result = await w.write(
      'tenantOperations/reconciliation/resolve',
      parsed.data,
      w.t('operations.operationSaved', {
        name: d?.row.externalId || bankRowId,
      }),
    );
    if (result) close();
  };
  return (
    <>
      <RouteDialog
        title={w.t('operations.resolutionTitle')}
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
            {d?.mayConfirm ? (
              <Button
                type='submit'
                form='bank-resolution-form'
                disabled={w.busy}
              >
                {w.busy ? w.t('hyl.copy.saving') : w.t('operations.save')}
              </Button>
            ) : null}
          </>
        }
      >
        {r.error ? (
          <BillingError error={r.error} retry={() => void r.refetch()} />
        ) : r.isPending ? (
          <LoadingRows />
        ) : d ? (
          <form
            id='bank-resolution-form'
            noValidate
            className='flex flex-col gap-4'
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <p className='break-all'>
              {d.row.externalId} · <Day value={d.row.date} /> ·{' '}
              <Money cents={d.row.amountCents} />
            </p>
            <p className='text-sm text-muted-foreground'>
              {w.t('operations.resolutionHint')}
            </p>
            <p className='text-sm font-medium'>
              {w.t('operations.resolutionHistory')}
            </p>
            {d.resolutions.length ? (
              d.resolutions.map((item) => (
                <article key={item.id} className='flex flex-col gap-2'>
                  <p className='text-sm text-muted-foreground'>
                    <RecordedAt value={item.createdAt} /> ·{' '}
                    {w.t('operations.conclusions.' + item.conclusion)} ·{' '}
                    {w.t('operations.actor')}: {item.actor} ·{' '}
                    <Day value={item.nextDate} />
                  </p>
                  <LongText>{item.note}</LongText>
                </article>
              ))
            ) : (
              <p>{w.t('operations.empty')}</p>
            )}
            {d.mayConfirm ? (
              <>
                <Field>
                  <FieldLabel>{w.t('operations.conclusion')} *</FieldLabel>
                  <Choice
                    ariaLabel={w.t('operations.conclusion')}
                    value={conclusion}
                    disabled={w.busy}
                    onChange={setConclusion}
                    options={[
                      'investigating',
                      'externalError',
                      'ledgerCorrection',
                      'unexplained',
                    ].map((v) => ({
                      value: v,
                      label: w.t('operations.conclusions.' + v),
                    }))}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor='bank-resolution-note'>
                    {w.t('operations.note')}
                  </FieldLabel>
                  <Textarea
                    ref={ref}
                    id='bank-resolution-note'
                    value={note}
                    disabled={w.busy}
                    maxLength={1000}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  {attempted && !note.trim() ? (
                    <FieldError>{w.t('operations.requiredField')}</FieldError>
                  ) : null}
                </Field>
                <Field>
                  <FieldLabel htmlFor='bank-resolution-next'>
                    {w.t('operations.nextDate')}
                  </FieldLabel>
                  <DateField
                    id='bank-resolution-next'
                    value={nextDate}
                    disabled={w.busy}
                    onChange={setNextDate}
                  />
                </Field>
              </>
            ) : null}
            {w.error ? <BillingError error={w.error} /> : null}
          </form>
        ) : null}
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
