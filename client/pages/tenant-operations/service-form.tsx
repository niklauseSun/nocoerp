import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { RouteDialog } from '#components/route-dialog';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import {
  Choice,
  DateField,
  BillingError,
  LoadingRows,
} from '../billing/common.js';
import { useBusinessQuery } from '../hyl/hooks.js';
import { useLeave } from '../inspections/leave.js';
import { DiscardDialog } from '../hyl/discard-dialog.js';
import { today } from '../financial-reports/hooks.js';
import { serviceCreateSchema } from '../../../server/tenant-operations/delivery-model.js';
import { useDeliveryWrite } from './delivery-hooks.js';
export default function ServiceForm() {
  const l = useLocation(),
    navigate = useNavigate(),
    w = useDeliveryWrite(),
    [requestId] = useState(() => crypto.randomUUID()),
    formRef = useRef<HTMLFormElement>(null);
  const r = useBusinessQuery<{
    data: { manage: boolean; merchants: { id: string; name: string }[] };
  }>('tenantOperations/serviceRecords/options');
  const [type, setType] = useState('complaint'),
    [merchantId, setMerchantId] = useState(''),
    [title, setTitle] = useState(''),
    [body, setBody] = useState(''),
    [start, setStart] = useState(today),
    [dueDate, setDueDate] = useState(today),
    [notes, setNotes] = useState(''),
    [attempted, setAttempted] = useState(false);
  const leave = useLeave(!!(title || body || notes || merchantId), w.busy),
    back = { pathname: '/tenantOperations', search: l.search };
  const values = {
      requestId,
      type,
      merchantId: merchantId || r.data?.data.merchants[0]?.id || '',
      title,
      body,
      start: ['notice', 'policy'].includes(type) ? start : today(),
      dueDate,
      notes,
    },
    parsed = serviceCreateSchema.safeParse(values);
  const issues = parsed.success
    ? {}
    : Object.fromEntries(
        parsed.error.issues.map((i) => [
          i.path[0],
          w.t('operations.requiredField'),
        ]),
      );
  const close = () => {
    leave.allow();
    void navigate(back);
  };
  const submit = async () => {
    setAttempted(true);
    if (!parsed.success) {
      const key = String(parsed.error.issues[0]?.path[0]);
      (
        formRef.current?.querySelector(
          `[data-field="${key}"] input, [data-field="${key}"] textarea, [data-field="${key}"] button`,
        ) as HTMLElement | null
      )?.focus();
      return;
    }
    const result = await w.write<{ id: string }>(
      'tenantOperations/serviceRecords',
      parsed.data,
      w.t('operations.serviceCreated', { name: title }),
    );
    if (result) {
      leave.allow();
      void navigate(
        {
          pathname: '/tenantOperations/service/' + result.id,
          search: l.search,
        },
        { replace: true },
      );
    }
  };
  return (
    <>
      <RouteDialog
        title={w.t('operations.serviceCreate')}
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
            {r.data?.data.merchants.length ? (
              <Button
                type='submit'
                form='service-create-form'
                disabled={w.busy}
              >
                {w.busy
                  ? w.t('hyl.copy.saving')
                  : w.t('operations.submitService')}
              </Button>
            ) : null}
          </>
        }
      >
        {r.error ? (
          <BillingError error={r.error} retry={() => void r.refetch()} />
        ) : r.isPending ? (
          <LoadingRows />
        ) : !r.data?.data.merchants.length ? (
          <p>{w.t('operations.noPermission')}</p>
        ) : (
          <form
            ref={formRef}
            id='service-create-form'
            className='flex flex-col gap-4'
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {w.error ? <BillingError error={w.error} /> : null}
            <Field data-field='type'>
              <FieldLabel>{w.t('operations.recordType')} *</FieldLabel>
              <Choice
                value={type}
                ariaLabel={w.t('operations.recordType')}
                disabled={w.busy}
                onChange={setType}
                options={(r.data.data.manage
                  ? ['notice', 'policy', 'complaint', 'suggestion']
                  : ['complaint', 'suggestion']
                ).map((v) => ({
                  value: v,
                  label: w.t('operations.serviceTypes.' + v),
                }))}
              />
            </Field>
            <Field data-field='merchantId'>
              <FieldLabel>{w.t('operations.tenant')} *</FieldLabel>
              <Choice
                value={values.merchantId}
                ariaLabel={w.t('operations.tenant')}
                disabled={w.busy}
                onChange={setMerchantId}
                options={r.data.data.merchants.map((m) => ({
                  value: m.id,
                  label: m.name,
                }))}
              />
              {attempted && issues.merchantId ? (
                <FieldError>{issues.merchantId}</FieldError>
              ) : null}
            </Field>
            <Field data-field='title'>
              <FieldLabel htmlFor='service-title'>
                {w.t('operations.recordTitle')} *
              </FieldLabel>
              <Input
                id='service-title'
                value={title}
                maxLength={100}
                disabled={w.busy}
                onChange={(e) => setTitle(e.target.value)}
                aria-invalid={attempted && !!issues.title}
              />
              {attempted && issues.title ? (
                <FieldError>{issues.title}</FieldError>
              ) : null}
            </Field>
            <Field data-field='body'>
              <FieldLabel htmlFor='service-body'>
                {w.t('operations.body')} *
              </FieldLabel>
              <Textarea
                id='service-body'
                value={body}
                maxLength={5000}
                disabled={w.busy}
                onChange={(e) => setBody(e.target.value)}
                aria-invalid={attempted && !!issues.body}
              />
              {attempted && issues.body ? (
                <FieldError>{issues.body}</FieldError>
              ) : null}
            </Field>
            {['notice', 'policy'].includes(type) ? (
              <Field data-field='start'>
                <FieldLabel htmlFor='service-start'>
                  {w.t('operations.start')} *
                </FieldLabel>
                <DateField
                  id='service-start'
                  value={start}
                  disabled={w.busy}
                  onChange={setStart}
                />
                {attempted && issues.start ? (
                  <FieldError>{issues.start}</FieldError>
                ) : null}
              </Field>
            ) : (
              <p className='text-sm text-muted-foreground'>
                {w.t('operations.submitHint')}
              </p>
            )}
            <Field data-field='dueDate'>
              <FieldLabel htmlFor='service-due'>
                {w.t('operations.dueDate')} *
              </FieldLabel>
              <DateField
                id='service-due'
                value={dueDate}
                disabled={w.busy}
                onChange={setDueDate}
              />
              {attempted && issues.dueDate ? (
                <FieldError>{issues.dueDate}</FieldError>
              ) : null}
            </Field>
            <Field>
              <FieldLabel htmlFor='service-notes'>
                {w.t('operations.notes')}
              </FieldLabel>
              <Textarea
                id='service-notes'
                value={notes}
                maxLength={1000}
                disabled={w.busy}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </form>
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
