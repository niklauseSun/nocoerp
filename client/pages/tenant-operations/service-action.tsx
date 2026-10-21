import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { RouteDialog } from '#components/route-dialog';
import { Button } from '#components/ui/button';
import { Textarea } from '#components/ui/textarea';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '#components/ui/alert-dialog';
import {
  BillingError,
  LoadingRows,
  DateField,
  Choice,
} from '../billing/common.js';
import { useBusinessQuery } from '../hyl/hooks.js';
import { useLeave } from '../inspections/leave.js';
import { DiscardDialog } from '../hyl/discard-dialog.js';
import { today } from '../financial-reports/hooks.js';
import { serviceActionSchema } from '../../../server/tenant-operations/delivery-model.js';
import { useRefreshMissing, useDeliveryWrite } from './delivery-hooks.js';
import type { ServiceDetail } from './service-detail.js';
export default function ServiceAction() {
  const { serviceId, serviceAction } = useParams(),
    l = useLocation(),
    navigate = useNavigate(),
    w = useDeliveryWrite(),
    r = useBusinessQuery<{ data: ServiceDetail }>(
      'tenantOperations/serviceRecords/' + serviceId,
    ),
    [requestId] = useState(() => crypto.randomUUID());
  const [text, setText] = useState(''),
    [dueDate, setDueDate] = useState(today),
    [rating, setRating] = useState('5'),
    [attempted, setAttempted] = useState(false),
    ref = useRef<HTMLTextAreaElement>(null),
    versionRef = useRef<number | undefined>(undefined);
  const leave = useLeave(!!text, w.busy),
    back = {
      pathname: '/tenantOperations/service/' + serviceId,
      search: l.search,
    },
    d = r.error ? undefined : r.data?.data,
    requiresText = ['accept', 'reply', 'close', 'feedback'].includes(
      serviceAction || '',
    ),
    valid =
      (!requiresText || !!text.trim()) &&
      (serviceAction !== 'accept' || dueDate >= today());
  useRefreshMissing(r.error || w.error);
  useEffect(() => {
    if (versionRef.current === undefined && d) versionRef.current = d.version;
  }, [d]);
  const close = () => {
    leave.allow();
    void navigate(back);
  };
  const submit = async () => {
    setAttempted(true);
    if (!valid) {
      ref.current?.focus();
      return;
    }
    if (!d || !d.allowedActions.includes(serviceAction || '')) return;
    const body = serviceActionSchema.parse({
      requestId,
      expectedVersion: versionRef.current ?? d.version,
      action: serviceAction,
      text,
      ...(serviceAction === 'accept' ? { dueDate } : {}),
      ...(serviceAction === 'feedback' ? { rating: Number(rating) } : {}),
    });
    const result = await w.write(
      'tenantOperations/serviceRecords/' + serviceId + '/actions',
      body,
      w.t('operations.operationSaved', { name: d.title }),
    );
    if (result) close();
  };
  const reload = async () => {
    const result = await r.refetch();
    if (result.data) {
      versionRef.current = result.data.data.version;
      w.setError(undefined);
    }
  };
  if (serviceAction === 'withdraw' && d)
    return (
      <AlertDialog
        open
        onOpenChange={(open) => {
          if (!open && !w.busy) close();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {w.t('operations.withdrawTitle', { name: d.title })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {w.t('operations.withdrawHint')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {w.error ? <BillingError error={w.error} /> : null}
          {w.conflict ? (
            <>
              <p>{w.t('operations.conflict')}</p>
              <Button variant='outline' onClick={() => void reload()}>
                {w.t('operations.reloadRecord')}
              </Button>
            </>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={w.busy} onClick={close}>
              {w.t('operations.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={w.busy || !d.allowedActions.includes('withdraw')}
              onClick={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              {w.busy ? w.t('hyl.copy.saving') : w.t('operations.withdraw')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  return (
    <>
      <RouteDialog
        title={w.t('operations.serviceActionTitle', {
          action: w.t('operations.' + serviceAction),
          name: d?.title || w.t('operations.tenantService'),
        })}
        closeTo={back}
        beforeClose={leave.guard}
        className='sm:max-w-md'
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
            {d?.allowedActions.includes(serviceAction || '') ? (
              <Button
                type='submit'
                form='service-action-form'
                disabled={w.busy}
              >
                {w.busy
                  ? w.t('hyl.copy.saving')
                  : w.t('operations.' + serviceAction)}
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
            id='service-action-form'
            className='flex flex-col gap-4'
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <p className='break-words'>{d.title}</p>
            {!d.allowedActions.includes(serviceAction || '') ? (
              <p>{w.t('operations.noPermission')}</p>
            ) : null}
            {w.error ? <BillingError error={w.error} /> : null}
            {w.conflict ? (
              <>
                <p>{w.t('operations.conflict')}</p>
                <Button
                  type='button'
                  variant='outline'
                  onClick={() => void reload()}
                >
                  {w.t('operations.reloadRecord')}
                </Button>
              </>
            ) : null}
            {requiresText ? (
              <Field>
                <FieldLabel htmlFor='service-action-text'>
                  {w.t('operations.handlingText')} *
                </FieldLabel>
                <Textarea
                  ref={ref}
                  id='service-action-text'
                  value={text}
                  maxLength={2000}
                  disabled={w.busy}
                  onChange={(e) => setText(e.target.value)}
                  aria-invalid={attempted && !text.trim()}
                />
                {attempted && !text.trim() ? (
                  <FieldError>{w.t('operations.requiredField')}</FieldError>
                ) : null}
              </Field>
            ) : null}
            {serviceAction === 'accept' ? (
              <Field>
                <FieldLabel htmlFor='service-action-due'>
                  {w.t('operations.dueDate')} *
                </FieldLabel>
                <DateField
                  id='service-action-due'
                  value={dueDate}
                  disabled={w.busy}
                  onChange={setDueDate}
                />
                {attempted && dueDate < today() ? (
                  <FieldError>{w.t('operations.requiredField')}</FieldError>
                ) : null}
              </Field>
            ) : null}
            {serviceAction === 'feedback' ? (
              <Field>
                <FieldLabel>{w.t('operations.rating')} *</FieldLabel>
                <Choice
                  ariaLabel={w.t('operations.rating')}
                  value={rating}
                  disabled={w.busy}
                  onChange={setRating}
                  options={['1', '2', '3', '4', '5'].map((v) => ({
                    value: v,
                    label: v,
                  }))}
                />
              </Field>
            ) : null}
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
