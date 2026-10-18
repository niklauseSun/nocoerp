import { useCoverFocus } from './focus.js';
import { today } from '../cashier/helpers.js';
import { useWork } from '../cashier/work.js';
import { useState, useId } from 'react';
import {
  useLocation,
  useNavigate,
  useParams,
  useResolvedPath,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient, useToaster } from '@nocobase/app-client';
import { useQueryClient } from '@tanstack/react-query';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { RouteDialog } from '#components/route-dialog';
import { BackButton } from '#components/back-button';
import { Button } from '#components/ui/button';
import { Spinner } from '#components/ui/spinner';
import { Field, FieldLabel } from '#components/ui/field';
import { useBusinessQuery, useBusinessPermission } from '../hyl/hooks.js';
import {
  FormField,
  Group,
  Choice,
  DateField,
  Money,
  Confirm,
  BillingError,
  LoadingRows,
  SplitAmounts,
} from './common.js';
import type { Order, Snapshot } from './types.js';
export default function SplitAction() {
  useCoverFocus();
  const p = useParams(),
    path = useResolvedPath('.').pathname,
    l = useLocation(),
    navigate = useNavigate(),
    { t } = useTranslation(),
    api = useApiClient(),
    cache = useQueryClient(),
    toaster = useToaster(),
    w = useWork(),
    formId = useId();
  const action = path.includes('/reverse/')
      ? 'reverse'
      : path.split('/').at(-1)!,
    large = action === 'execute' || action === 'recover',
    parent =
      action === 'reverse'
        ? path.split('/').slice(0, -2).join('/')
        : path.slice(0, path.lastIndexOf('/'));
  const permission = useBusinessPermission(
      'contracts',
      action === 'execute'
        ? 'splitExecute'
        : action === 'recover' || action === 'reverse'
          ? 'splitRecover'
          : 'splitReview',
    ),
    [readVersion, setReadVersion] = useState(() => crypto.randomUUID());
  const result = useBusinessQuery<{
      data: Order & {
        allowedActions: string[];
        closed: boolean;
        revisions?: { data: { revision: number; payload: Snapshot }[] };
      };
    }>(`splitOrders/${p.splitId}`, { readVersion }, permission.can),
    row = result.data?.data;
  const [values, setValues] = useState(() => ({
      recipientKey: '',
      amount: '',
      date: today(),
      method: 'bank',
      reference: '',
      evidence: '',
      reason: '',
      notes: '',
      result: '',
      failureReason: '',
    })),
    [requestId, setRequestId] = useState(() => crypto.randomUUID()),
    [confirm, setConfirm] = useState(false),
    [discard, setDiscard] = useState(false),
    [previewed, setPreviewed] = useState(false);
  const actionAllowed =
    !!row &&
    row.status !== 'cancelled' &&
    row.allowedActions.includes(
      action === 'execute'
        ? 'splitExecute'
        : action === 'recover' || action === 'reverse'
          ? 'splitRecover'
          : 'splitReview',
    ) &&
    (!large ||
      (row.payload.reviewedHash === row.sourceHash &&
        BigInt(row.payload.snapshot.fundingGapCents) === 0n));
  const line = row?.payload.snapshot.lines.find(
    (r) => r.key === values.recipientKey,
  );
  const validate = (v = values) => {
    const e: Record<string, string> = {};
    if (large) {
      if (!v.recipientKey) e.recipientKey = t('split.required');
      if (!/^\d{1,12}(\.\d{1,2})?$/.test(v.amount) || Number(v.amount) <= 0)
        e.amount = t('split.positive');
      const selected = row?.payload.snapshot.lines.find(
        (r) => r.key === v.recipientKey,
      );
      if (
        selected &&
        Number(v.amount) >
          Number(
            action === 'recover'
              ? selected.recoveryCents
              : selected.remainingCents,
          ) /
            100
      )
        e.amount = t('split.positive');
      if (!v.date) e.date = t('split.required');
      if (action === 'execute' && !v.result) e.result = t('split.required');
      if (action === 'execute' && v.result === 'failed') {
        if (!v.failureReason.trim()) e.failureReason = t('split.required');
      } else {
        for (const k of ['reference', 'evidence'])
          if (!v[k as keyof typeof v].trim()) e[k] = t('split.required');
      }
      if (action === 'recover' && !v.reason.trim())
        e.reason = t('split.required');
    } else {
      if (!v.evidence.trim()) e.evidence = t('split.required');
      if (action !== 'review' && !v.reason.trim())
        e.reason = t('split.required');
    }
    return e;
  };
  const update = (k: keyof typeof values, v: string) => {
    const next = { ...values, [k]: v };
    setValues(next);
    setPreviewed(false);
    setRequestId(crypto.randomUUID());
    if (w.attempted) w.setErrors(validate(next));
  };
  const close = () => {
    if (w.busy) return;
    if (
      Object.entries(values).some(
        ([k, v]) => !['date', 'method'].includes(k) && v,
      )
    )
      setDiscard(true);
    else void navigate({ pathname: parent, search: l.search });
  };
  const record = async () => {
    if (!row) return;
    w.setBusy(true);
    w.setError(undefined);
    try {
      const json = {
        ...values,
        ...(!values.result ? { result: undefined } : {}),
        requestId,
        expectedVersion: row.version,
        sourceHash: row.sourceHash,
        ...(action === 'reverse' ? { transferId: p.transferId } : {}),
        ...(values.recipientKey === 'merchant'
          ? { expectedSettlementVersion: row.payload.snapshot.sourceVersion }
          : {}),
      };
      const response = await api.request<{ data: Order }>({
        path: `splitOrders/${row.id}/${action}`,
        method: 'POST',
        json,
      });
      await cache.invalidateQueries({ queryKey: ['hyl'] });
      toaster.show({
        title: t(
          action === 'execute' && values.result === 'failed'
            ? 'split.failedRecorded'
            : 'split.recorded',
          { number: response.data.number },
        ),
        type: 'success',
      });
      w.setBusy(false);
      setConfirm(false);
      void navigate({ pathname: parent, search: l.search });
    } catch (e) {
      w.fail(e);
      setConfirm(false);
    } finally {
      w.setBusy(false);
    }
  };
  const fields = (
    <>
      {w.error ? <BillingError error={w.error} /> : null}
      {w.conflict ? (
        <Button
          type='button'
          variant='outline'
          disabled={w.busy}
          onClick={() => {
            setReadVersion(crypto.randomUUID());
            setPreviewed(false);
            setRequestId(crypto.randomUUID());
            w.setError(undefined);
          }}
        >
          {t('split.latest')}
        </Button>
      ) : null}
      {!permission.can ? (
        <p>{t('split.restricted')}</p>
      ) : result.error ? (
        <BillingError
          error={result.error}
          retry={() => void result.refetch()}
        />
      ) : !row ? (
        <LoadingRows />
      ) : !actionAllowed ? (
        <p>{t(large ? 'split.stale' : 'split.restricted')}</p>
      ) : row.closed ? (
        <p>{t('split.closed')}</p>
      ) : (
        <>
          <p className='text-sm text-muted-foreground'>
            {t(
              action === 'review'
                ? 'split.reviewHelp'
                : action === 'reverse'
                  ? 'split.reverseHelp'
                  : action === 'cancel'
                    ? 'split.cancelHelp'
                    : 'split.offline',
            )}
          </p>
          {action === 'review' ? (
            <Group title={row.payload.snapshot.sourceNumber}>
              <SplitAmounts
                values={{
                  sourceFundsCents: row.sourceFundsCents,
                  netPaidCents: row.netPaidCents,
                  remainingCents: row.remainingCents,
                  recoveryCents: row.recoveryCents,
                }}
              />
              {row.payload.snapshot.lines.map((line) => {
                const prior = row.revisions?.data
                  .find((r) => r.revision === row.activeRevision - 1)
                  ?.payload.lines.find((r) => r.key === line.key);
                return (
                  <p key={line.key}>
                    {line.name} · {t('split.fields.targetCents')}{' '}
                    <Money cents={line.targetCents} /> · {t('split.delta')}{' '}
                    <Money
                      cents={String(
                        BigInt(line.targetCents) -
                          BigInt(prior?.targetCents ?? '0'),
                      )}
                    />
                  </p>
                );
              })}
            </Group>
          ) : null}
          {large ? (
            <>
              <Field>
                <FieldLabel htmlFor='cashier-recipientKey'>
                  {t('split.fields.recipientKey')} *
                </FieldLabel>
                <Choice
                  id='cashier-recipientKey'
                  ariaLabel={t('split.fields.recipientKey')}
                  value={values.recipientKey || 'none'}
                  disabled={w.busy}
                  onChange={(v) =>
                    update('recipientKey', v === 'none' ? '' : v)
                  }
                  options={[
                    { value: 'none', label: t('split.required') },
                    ...row.payload.snapshot.lines
                      .filter(
                        (r) =>
                          ['partner', 'merchant'].includes(r.kind) &&
                          (r.kind !== 'merchant' ||
                            row.allowedActions.includes('merchantPay')) &&
                          (action !== 'recover' || r.kind === 'partner'),
                      )
                      .map((r) => ({
                        value: r.key,
                        label: r.name || t(`split.roles.${r.kind}`),
                      })),
                  ]}
                />
                {w.errors.recipientKey ? (
                  <p
                    id='cashier-recipientKey-error'
                    tabIndex={-1}
                    className='text-destructive'
                  >
                    {w.errors.recipientKey}
                  </p>
                ) : null}
              </Field>
              {line ? (
                <p>
                  {t(
                    action === 'recover'
                      ? 'split.fields.recoveryCents'
                      : 'split.fields.remainingCents',
                  )}{' '}
                  <Money
                    cents={
                      action === 'recover'
                        ? line.recoveryCents
                        : line.remainingCents
                    }
                  />
                </p>
              ) : null}
              <FormField
                name='amount'
                label={t('split.fields.amount')}
                value={values.amount}
                required
                decimal
                disabled={w.busy}
                error={w.errors.amount}
                onChange={(v) => update('amount', v)}
              />
              <Field>
                <FieldLabel htmlFor='cashier-date'>
                  {t('split.fields.date')} *
                </FieldLabel>
                <DateField
                  id='cashier-date'
                  value={values.date}
                  disabled={w.busy}
                  onChange={(v) => update('date', v)}
                />
              </Field>
              <Field>
                <FieldLabel>{t('split.fields.method')} *</FieldLabel>
                <Choice
                  ariaLabel={t('split.fields.method')}
                  value={values.method}
                  disabled={w.busy}
                  onChange={(v) => update('method', v)}
                  options={['bank', 'cash', 'other'].map((value) => ({
                    value,
                    label: t(`cashier.methods.${value}`),
                  }))}
                />
              </Field>
              {action === 'execute' ? (
                <Field>
                  <FieldLabel>{t('split.fields.result')} *</FieldLabel>
                  <Choice
                    id='cashier-result'
                    ariaLabel={t('split.fields.result')}
                    value={values.result || 'none'}
                    disabled={w.busy}
                    onChange={(v) => update('result', v === 'none' ? '' : v)}
                    options={['none', 'success', 'failed'].map((value) => ({
                      value,
                      label: t(
                        value === 'none'
                          ? 'split.required'
                          : `split.states.${value}`,
                      ),
                    }))}
                  />
                  {w.errors.result ? (
                    <p
                      id='cashier-result-error'
                      tabIndex={-1}
                      className='text-destructive'
                    >
                      {w.errors.result}
                    </p>
                  ) : null}
                </Field>
              ) : null}
            </>
          ) : null}
          {(large
            ? ['reference', 'evidence', 'reason', 'failureReason', 'notes']
            : ['evidence', 'reason']
          )
            .filter((k) => k !== 'failureReason' || values.result === 'failed')
            .map((k) => (
              <FormField
                key={k}
                name={k}
                label={t(`split.fields.${k}`)}
                value={values[k as keyof typeof values]}
                required={
                  (k === 'evidence' && values.result !== 'failed') ||
                  (k === 'reference' && large && values.result !== 'failed') ||
                  (k === 'failureReason' && values.result === 'failed') ||
                  (k === 'reason' &&
                    (action === 'recover' ||
                      action === 'cancel' ||
                      action === 'reverse'))
                }
                multiline={k === 'notes'}
                disabled={w.busy}
                error={w.errors[k]}
                onChange={(v) => update(k as keyof typeof values, v)}
              />
            ))}
          {previewed ? (
            <Group title={t('split.previewTitle')}>
              <p>
                {line?.name ?? row.number} · {values.amount} ·{' '}
                {values.result ? t(`split.states.${values.result}`) : ''}
              </p>
            </Group>
          ) : null}
        </>
      )}
    </>
  );
  const footer = (
    <div className='flex justify-end gap-2'>
      <Button type='button' variant='outline' disabled={w.busy} onClick={close}>
        {t(large ? 'split.cancel' : 'split.back')}
      </Button>
      {large ? (
        <Button
          type='button'
          variant='outline'
          disabled={w.busy}
          onClick={() => {
            if (w.focus(validate())) setPreviewed(true);
          }}
        >
          {t('split.preview')}
        </Button>
      ) : null}
      <Button
        type='submit'
        form={formId}
        disabled={
          w.busy ||
          !row ||
          !actionAllowed ||
          row.closed ||
          !permission.can ||
          (large && !previewed)
        }
      >
        {w.busy ? <Spinner /> : null}
        {t(`split.${action}`)}
      </Button>
    </div>
  );
  const form = (
    <form
      id={formId}
      noValidate
      className='flex flex-col gap-4'
      onSubmit={(e) => {
        e.preventDefault();
        if (w.focus(validate())) setConfirm(true);
      }}
    >
      {fields}
    </form>
  );
  return (
    <>
      {large ? (
        <RouteChildPage>
          <PageContainer className='mx-auto max-w-4xl'>
            <BackButton
              to={{ pathname: parent, search: l.search }}
              onClick={(e) => {
                e.preventDefault();
                close();
              }}
            />
            <PageHeader
              title={t('split.actionTitle', {
                action: t(`split.${action}`),
                number: row?.number ?? '',
              })}
              description={t('split.offline')}
            />
            {form}
            {footer}
          </PageContainer>
        </RouteChildPage>
      ) : (
        <RouteDialog
          title={t('split.actionTitle', {
            action: t(`split.${action}`),
            number: row?.number ?? '',
          })}
          description={t('split.offline')}
          beforeClose={() => !w.busy}
          className='sm:max-w-md'
          footer={footer}
        >
          {form}
        </RouteDialog>
      )}
      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        busy={w.busy}
        title={t('split.confirm', {
          action: t(`split.${action}`),
          number: row?.number ?? '',
        })}
        label={t(`split.${action}`)}
        destructive={action === 'cancel' || action === 'reverse'}
        onConfirm={() => void record()}
      >
        {t(
          action === 'reverse'
            ? 'split.reverseHelp'
            : action === 'cancel'
              ? 'split.cancelHelp'
              : action === 'review'
                ? 'split.reviewHelp'
                : 'split.offline',
        )}{' '}
        {values.amount}
      </Confirm>
      <Confirm
        open={discard}
        onOpenChange={setDiscard}
        busy={w.busy}
        title={t('split.discardTitle')}
        label={t('split.discard')}
        destructive
        onConfirm={() => void navigate({ pathname: parent, search: l.search })}
      >
        {t('split.discardHelp')}
      </Confirm>
    </>
  );
}
