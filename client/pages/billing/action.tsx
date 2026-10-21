import { RecordSearch } from '#components/record-search';
import { useRecordSearchState } from '#hooks/use-record-search';
import { sourceRecordLabel } from '../hyl/source-record-label.js';
import { formatMoney } from './format.js';
import { fieldMessages } from './form-errors.js';
import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient, ApiClientError, useToaster } from '@nocobase/app-client';
import { useQueryClient } from '@tanstack/react-query';
import { RouteDialog } from '#components/route-dialog';
import { RouteChildPage } from '#components/route-child-page';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { Button } from '#components/ui/button';
import {
  Field,
  FieldLabel,
  FieldError,
  FieldGroup,
} from '#components/ui/field';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Input } from '#components/ui/input';
import { Spinner } from '#components/ui/spinner';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '#components/ui/alert-dialog';
import { useBusinessPermission, useBusinessQuery } from '../hyl/hooks.js';
import {
  BillingError,
  Choice,
  DateField,
  Day,
  LoadingRows,
  Money,
  Paged,
  RecordPicker,
  TextField,
  Value,
} from './common.js';
import type { Bill, Receipt, ListResponse } from './types.js';

const permission: Record<string, string> = {
  issue: 'billIssue',
  void: 'billVoid',
  deposit: 'depositDeduct',
  allocate: 'receiptAllocate',
  refund: 'receiptRefund',
  reverseAllocation: 'receiptReverse',
  reverseRefund: 'receiptReverse',
  reverseDeposit: 'depositReverse',
  newReceipt: 'receiptReceive',
};
export default function BillingAction() {
  const params = useParams(),
    location = useLocation(),
    { t } = useTranslation();
  const action =
    location.pathname.match(
      /\/(issue|void|deposit|allocate|refund|reverseAllocation|reverseRefund|reverseDeposit)(?:\/[^/]+)?$/,
    )?.[1] ?? 'newReceipt';
  const billAt = Math.max(
    location.pathname.lastIndexOf('/bills/'),
    location.pathname.lastIndexOf('/bill/'),
  );
  const receiptAt = Math.max(
    location.pathname.lastIndexOf('/receipts/'),
    location.pathname.lastIndexOf('/receiptDetail/'),
  );
  const billAction = billAt > receiptAt;
  const kind = billAction ? 'bills' : 'receipts',
    id = billAction ? params.billId : params.receiptId;
  const [contractId, setContractId] = useState(
    () =>
      params.id || new URLSearchParams(location.search).get('contractId') || '',
  );
  const can = useBusinessPermission(
    'contracts',
    action === 'void' && !billAction ? 'receiptReverse' : permission[action],
  );
  const [readVersion] = useState(() => crypto.randomUUID());
  const existing = useBusinessQuery<{ data: Bill & Receipt }>(
    `${kind}/${id}`,
    { linePage: 1, ledgerPage: 1, readVersion },
    can.can && !!id,
  );
  const parentContract = existing.data?.data.contractId || contractId;
  const contract = useBusinessQuery<{
    data: {
      id: string;
      number: string;
      lease: { version: number; status: string };
    };
  }>(
    `contracts/${parentContract}`,
    undefined,
    can.can && action === 'newReceipt' && !!parentContract,
  );
  const ready = !!existing.data;
  const [busy, setBusy] = useState(false);
  const [footerTarget, setFooterTarget] = useState<HTMLDivElement | null>(null);
  const title = t(
    action === 'newReceipt' ? 'billing.newReceipt' : 'billing.actionTitle',
    {
      action: t(
        `billing.${action === 'deposit' ? 'applyDeposit' : action === 'reverseDeposit' ? 'reverseAllocation' : action}`,
      ),
      object: t(`billing.${kind}`),
      number: existing.data?.data.number ?? '',
    },
  );
  const content = !can.can ? (
    <p>{t('billing.restricted')}</p>
  ) : existing.error || contract.error ? (
    <BillingError
      error={existing.error || contract.error}
      retry={() => {
        void existing.refetch();
        void contract.refetch();
      }}
    />
  ) : action === 'newReceipt' && !id && !parentContract ? (
    <Field>
      <FieldLabel>{t('billing.fields.contract')} *</FieldLabel>
      <RecordPicker
        id='billing-receipt-contract'
        kind='contracts'
        value={contractId}
        onChange={setContractId}
      />
    </Field>
  ) : (action === 'newReceipt' && !contract.data) ||
    (action !== 'newReceipt' && !ready) ||
    (id && !existing.data) ? (
    <LoadingRows />
  ) : (
    <ActionBody
      action={action}
      footerTarget={footerTarget}
      kind={kind}
      row={existing.data?.data}
      contract={contract.data?.data}
      entryId={params.entryId}
      busy={busy}
      setBusy={setBusy}
      reload={async () => {
        const r = await existing.refetch();
        if (action === 'newReceipt') await contract.refetch();
        return r.data?.data;
      }}
    />
  );
  return action === 'allocate' ? (
    <RouteChildPage>
      <PageContainer className='mx-auto max-w-4xl'>
        <BackButton
          to={{
            pathname: location.pathname.replace(/\/allocate$/, ''),
            search: location.search,
          }}
        />
        <PageHeader title={title} description={t('billing.offline')} />
        {content}
      </PageContainer>
    </RouteChildPage>
  ) : (
    <RouteDialog
      title={title}
      className={
        [
          'issue',
          'void',
          'deposit',
          'reverseAllocation',
          'reverseRefund',
          'reverseDeposit',
        ].includes(action)
          ? 'sm:max-w-md'
          : undefined
      }
      description={t('billing.offline')}
      beforeClose={() => !busy}
      footer={<div ref={setFooterTarget} className='w-full' />}
    >
      {content}
    </RouteDialog>
  );
}
interface Selected {
  billId: string;
  number: string;
  expectedBillVersion: number;
  amount: string;
}
function ActionBody({
  action,
  kind,
  row,
  contract,
  entryId,
  busy,
  setBusy,
  reload,
  footerTarget,
}: {
  action: string;
  footerTarget: HTMLDivElement | null;
  kind: string;
  row?: Bill & Receipt;
  contract?: {
    id: string;
    number: string;
    lease: { version: number; status: string };
  };
  entryId?: string;
  busy: boolean;
  setBusy: (v: boolean) => void;
  reload: () => Promise<(Bill & Receipt) | undefined>;
}) {
  const { t, i18n } = useTranslation(),
    location = useLocation(),
    navigate = useNavigate(),
    api = useApiClient(),
    toaster = useToaster(),
    cache = useQueryClient();
  const formId = useId();
  const newReceipt = action === 'newReceipt',
    billAction = kind === 'bills';
  const [values, setValues] = useState(() => ({
    amount: '',
    date: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date()),
    method: 'bank',
    reference: '',
    evidence: '',
    reason: '',
    notes: '',
  }));
  const [version, setVersion] = useState(row?.version ?? 0),
    [leaseVersion, setLeaseVersion] = useState(
      row?.lease.version ?? contract?.lease.version ?? 0,
    ),
    [requestId, setRequestId] = useState(() => crypto.randomUUID()),
    [error, setError] = useState<unknown>(),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [attempted, setAttempted] = useState(false),
    [confirm, setConfirm] = useState(false),
    [selected, setSelected] = useState<Record<string, Selected>>({}),
    { q, setQ, page, setPage } = useRecordSearchState(
      'receipt-allocation:' + (row?.contractId ?? contract?.id ?? ''),
    );
  const contractId = row?.contractId ?? contract?.id ?? '';
  const bills = useBusinessQuery<ListResponse<Bill>>(
    'bills',
    { contractId, status: 'open', q, page, pageSize: 20 },
    action === 'allocate',
  );
  const closePath = location.pathname
    .replace(/\/(reverseAllocation|reverseRefund|reverseDeposit)\/[^/]+$/, '')
    .replace(/\/(issue|void|deposit|allocate|refund|receipt|new)$/, '');
  const close = () =>
    void navigate({ pathname: closePath, search: location.search });
  const target = (row?.entries ?? row?.ledger ?? []).find(
    (e) => e.id === entryId,
  );
  const total = Object.values(selected).reduce(
    (n, a) => n + Number(a.amount || 0),
    0,
  );
  const set = (key: keyof typeof values, v: string) => {
    setValues((old) => ({ ...old, [key]: v }));
    if (attempted)
      setErrors(validationErrors({ ...values, [key]: v }, selected));
  };
  const field = (key: keyof typeof values, required = true) => (
    <TextField
      name={key}
      value={values[key]}
      onChange={(v) => set(key, v)}
      required={required}
      error={errors[key]}
      disabled={busy}
      label={
        key === 'reference' ? t('billing.fields.paymentReference') : undefined
      }
      decimal={key === 'amount'}
    />
  );
  const validationErrors = (current = values, allocations = selected) => {
    const e: Record<string, string> = {};
    const keys = newReceipt
      ? [
          'amount',
          'date',
          ...(current.method === 'bank' ? ['reference'] : []),
          'evidence',
        ]
      : action === 'deposit'
        ? ['amount', 'date', 'reason', 'evidence']
        : action === 'refund'
          ? ['amount', 'date', 'reference', 'reason', 'evidence']
          : [
                'void',
                'reverseAllocation',
                'reverseRefund',
                'reverseDeposit',
              ].includes(action)
            ? ['reason', 'evidence']
            : [];
    for (const key of keys)
      if (!current[key as keyof typeof values].trim())
        e[key] = t('billing.required');
    if (
      keys.includes('amount') &&
      (!/^\d{1,12}(\.\d{1,2})?$/.test(current.amount) ||
        Number(current.amount) <= 0)
    )
      e.amount = t('billing.positive');
    if (action === 'allocate') {
      if (!Object.keys(allocations).length)
        e.allocations = t('billing.errors.BILLING_ALLOCATION_REQUIRED');
      for (const item of Object.values(allocations)) {
        if (
          !/^\d{1,12}(\.\d{1,2})?$/.test(item.amount) ||
          Number(item.amount) <= 0
        )
          e[`allocation-${item.billId}`] = t('billing.positive');
      }
    }
    return e;
  };
  const updateSelected = (next: Record<string, Selected>) => {
    setSelected(next);
    if (attempted) setErrors(validationErrors(values, next));
  };
  const validate = () => {
    const e = validationErrors();
    setErrors(e);
    setAttempted(true);
    if (Object.keys(e).length) {
      setTimeout(
        () => document.getElementById(`billing-${Object.keys(e)[0]}`)?.focus(),
        0,
      );
      return false;
    }
    return true;
  };
  const execute = async () => {
    setBusy(true);
    setError(undefined);
    try {
      let path: string, body: Record<string, unknown>;
      if (newReceipt) {
        path = 'receipts';
        body = {
          ...values,
          contractId,
          expectedLeaseVersion: leaseVersion,
          requestId,
        };
        delete body.reason;
      } else if (action === 'reverseDeposit') {
        path = `contracts/${contractId}/leaseActions/reverse`;
        body = {
          requestId,
          expectedVersion: leaseVersion,
          sourceId: entryId,
          reason: values.reason,
          evidence: values.evidence,
          date: values.date,
        };
      } else {
        path = `${kind}/${row!.id}/${action === 'deposit' ? 'applyDeposit' : action}`;
        body = {
          requestId,
          expectedVersion: version,
          ...(['deposit', 'refund'].includes(action)
            ? { amount: values.amount, date: values.date }
            : {}),
          ...([
            'void',
            'deposit',
            'refund',
            'reverseAllocation',
            'reverseRefund',
          ].includes(action)
            ? { reason: values.reason, evidence: values.evidence }
            : {}),
          ...(action === 'refund' ? { reference: values.reference } : {}),
          ...(action === 'deposit'
            ? { expectedLeaseVersion: leaseVersion }
            : {}),
          ...(['reverseAllocation', 'reverseRefund'].includes(action)
            ? { sourceId: entryId }
            : {}),
          ...(action === 'allocate'
            ? {
                allocations: Object.values(selected).map(
                  ({ billId, expectedBillVersion, amount }) => ({
                    billId,
                    expectedBillVersion,
                    amount,
                  }),
                ),
              }
            : {}),
        };
      }
      const response = await api.request<{ data: Receipt & Bill }>({
        path,
        method: 'POST',
        json: body,
      });
      await cache.invalidateQueries({ queryKey: ['hyl'] });
      toaster.show({
        title: t('billing.success', {
          action: t(
            newReceipt
              ? 'billing.newReceipt'
              : action === 'deposit'
                ? 'billing.applyDeposit'
                : action === 'reverseDeposit'
                  ? 'billing.reverseAllocation'
                  : `billing.${action}`,
          ),
          number: response.data.number || row?.number || contract?.number,
        }),
        type: 'success',
      });
      setConfirm(false);
      if (newReceipt)
        void navigate({
          pathname: billAction
            ? `${closePath}/receiptDetail/${response.data.id}`
            : `${closePath}/${response.data.id}`,
          search: location.search,
        });
      else close();
    } catch (e) {
      setError(e);
      const serverErrors = Object.fromEntries(
        Object.entries(fieldMessages(e, t)).map(([key, message]) => {
          const match = key.match(/^allocations\.(\d+)\.amount$/);
          const item = match
            ? Object.values(selected)[Number(match[1])]
            : undefined;
          return [item ? `allocation-${item.billId}` : key, message];
        }),
      );
      if (Object.keys(serverErrors).length) {
        setErrors(serverErrors);
        setAttempted(true);
        setTimeout(
          () =>
            document
              .getElementById(`billing-${Object.keys(serverErrors)[0]}`)
              ?.focus(),
          0,
        );
      }
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };
  const latest = async () => {
    setBusy(true);
    try {
      const current = await reload();
      if (current) {
        setVersion(current.version);
        setLeaseVersion(current.lease.version);
      }
      const copies = { ...selected };
      for (const id of Object.keys(copies)) {
        const b = await api.request<{ data: Bill }>({ path: `bills/${id}` });
        copies[id] = { ...copies[id], expectedBillVersion: b.data.version };
      }
      setSelected(copies);
      setRequestId(crypto.randomUUID());
      setError(undefined);
    } finally {
      setBusy(false);
    }
  };
  const label =
    action === 'deposit'
      ? 'applyDeposit'
      : action === 'reverseDeposit'
        ? 'reverseAllocation'
        : action;
  const remaining =
    action === 'allocate'
      ? Number(row?.unusedCents ?? 0) / 100 - total
      : action === 'deposit'
        ? Number(row?.remainingCents ?? 0) / 100 - Number(values.amount || 0)
        : action === 'refund'
          ? Number(row?.unusedCents ?? 0) / 100 - Number(values.amount || 0)
          : 0;
  const closed = (row?.lease.status ?? contract?.lease.status) === 'closed';
  const amountView = (v: number) =>
    new Intl.NumberFormat(i18n.language, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(v);
  const actions = (
    <div className='flex justify-end gap-2'>
      <Button type='button' variant='outline' disabled={busy} onClick={close}>
        {t('billing.cancel')}
      </Button>
      <Button form={formId} type='submit' disabled={busy || closed}>
        {busy ? <Spinner /> : null}
        {t(newReceipt ? 'billing.newReceipt' : `billing.${label}`)}
      </Button>
    </div>
  );
  return (
    <>
      <form
        id={formId}
        className='flex flex-col gap-4'
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (validate()) {
            if (newReceipt) void execute();
            else setConfirm(true);
          }
        }}
      >
        {error ? <BillingError error={error} /> : null}
        {error instanceof ApiClientError && error.status === 409 ? (
          <Alert>
            <AlertDescription>
              {t('billing.conflict')}
              <Button
                type='button'
                variant='outline'
                disabled={busy}
                onClick={() => void latest()}
              >
                {t('billing.reload')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {closed ? (
          <Alert>
            <AlertDescription>{t('billing.closed')}</AlertDescription>
          </Alert>
        ) : null}
        <dl className='flex flex-col gap-2'>
          <Value label='contract'>{contract?.number ?? contractId}</Value>
          {row ? (
            <Value label={billAction ? 'remainingCents' : 'unusedCents'}>
              <Money
                cents={billAction ? row.remainingCents : row.unusedCents}
              />
            </Value>
          ) : null}
          {action === 'deposit' ? (
            <Value label='depositBalance'>
              {row?.depositBalance === null ? (
                t('billing.restricted')
              ) : (
                <Money value={row?.depositBalance ?? '0'} />
              )}
            </Value>
          ) : null}
          {target ? (
            <Value label='source'>
              <Money cents={target.amountCents} /> ·{' '}
              <Day value={target.createdAt} />
            </Value>
          ) : null}
        </dl>
        <FieldGroup>
          {newReceipt || ['deposit', 'refund'].includes(action) ? (
            <>
              {field('amount')}
              <Field>
                <FieldLabel htmlFor='billing-date'>
                  {t('billing.fields.date')} *
                </FieldLabel>
                <DateField
                  id='billing-date'
                  value={values.date}
                  onChange={(v) => set('date', v)}
                  disabled={busy}
                />
                {errors.date ? <FieldError>{errors.date}</FieldError> : null}
              </Field>
            </>
          ) : null}
          {newReceipt ? (
            <Field>
              <FieldLabel htmlFor='billing-method'>
                {t('billing.fields.method')} *
              </FieldLabel>
              <Choice
                id='billing-method'
                value={values.method}
                onChange={(v) => set('method', v)}
                disabled={busy}
                options={['bank', 'cash', 'other'].map((v) => ({
                  value: v,
                  label: t(`billing.methods.${v}`),
                }))}
              />
            </Field>
          ) : null}
          {newReceipt || action === 'refund'
            ? field('reference', !newReceipt || values.method === 'bank')
            : null}
          {!newReceipt && action !== 'issue' && action !== 'allocate'
            ? field('reason')
            : null}
          {action !== 'issue' && action !== 'allocate'
            ? field('evidence')
            : null}
          {newReceipt ? field('notes', false) : null}
        </FieldGroup>
        {action === 'allocate' ? (
          <>
            <Field>
              <FieldLabel htmlFor='billing-source-picker'>
                {t('hyl.copy.sourceRecord')}
              </FieldLabel>
              <RecordSearch
                id='billing-source-picker'
                label={t('hyl.copy.sourceRecord')}
                value=''
                scopeKey={'receipt-allocation:' + contractId}
                hasSelection={!!Object.keys(selected).length}
                onClear={() => updateSelected({})}
                disabled={busy}
                loading={bills.isFetching}
                options={(bills.isPlaceholderData ||
                Object.keys(selected).length >= 50
                  ? []
                  : (bills.data?.data ?? [])
                )
                  .filter((b) => !selected[b.id])
                  .map((b) => ({
                    value: b.id,
                    label:
                      sourceRecordLabel(b) +
                      ' · ' +
                      formatMoney(b.remainingCents, i18n.language, true),
                  }))}
                onChange={(id) => {
                  if (busy || Object.keys(selected).length >= 50) return;
                  const b = bills.data?.data.find((row) => row.id === id);
                  if (!b || selected[id]) return;
                  updateSelected({
                    ...selected,
                    [b.id]: {
                      billId: b.id,
                      number: b.number,
                      expectedBillVersion: b.version,
                      amount: Math.min(
                        Number(b.remainingCents) / 100,
                        Math.max(
                          0,
                          Number(row?.unusedCents ?? 0) / 100 - total,
                        ),
                      ).toFixed(2),
                    },
                  });
                }}
                onSearch={(query) => {
                  setQ(query);
                  setPage(1);
                }}
                placeholder={t('hyl.copy.sourceSearch')}
                status={
                  bills.error ? (
                    <BillingError
                      error={bills.error}
                      retry={() => void bills.refetch()}
                    />
                  ) : Object.keys(selected).length >= 50 ? (
                    <p role='status'>
                      {t('hyl.copy.sourceLimit', { count: 50 })}
                    </p>
                  ) : undefined
                }
                footer={
                  bills.data && bills.data.meta.total > 20 ? (
                    <Paged
                      meta={bills.data.meta}
                      busy={busy || bills.isFetching}
                      onChange={setPage}
                    />
                  ) : undefined
                }
              />
            </Field>
            <h2 className='text-base font-medium'>{t('billing.selected')}</h2>
            {Object.values(selected).map((s) => (
              <Field
                key={s.billId}
                data-invalid={!!errors[`allocation-${s.billId}`]}
              >
                <FieldLabel htmlFor={`billing-allocation-${s.billId}`}>
                  {s.number} · {t('billing.fields.amount')} *
                </FieldLabel>
                <div className='flex gap-2'>
                  <Input
                    id={`billing-allocation-${s.billId}`}
                    value={s.amount}
                    inputMode='decimal'
                    aria-invalid={!!errors[`allocation-${s.billId}`]}
                    aria-describedby={
                      errors[`allocation-${s.billId}`]
                        ? `billing-allocation-error-${s.billId}`
                        : undefined
                    }
                    onChange={(e) =>
                      updateSelected({
                        ...selected,
                        [s.billId]: { ...s, amount: e.target.value },
                      })
                    }
                    disabled={busy}
                  />
                  <Button
                    type='button'
                    variant='outline'
                    disabled={busy}
                    onClick={() =>
                      updateSelected(
                        (() => {
                          const next = { ...selected };
                          delete next[s.billId];
                          return next;
                        })(),
                      )
                    }
                  >
                    {t('billing.remove')}
                  </Button>
                </div>
                {errors[`allocation-${s.billId}`] ? (
                  <FieldError id={`billing-allocation-error-${s.billId}`}>
                    {errors[`allocation-${s.billId}`]}
                  </FieldError>
                ) : null}
              </Field>
            ))}
            {errors.allocations ? (
              <FieldError id='billing-allocations' tabIndex={-1}>
                {errors.allocations}
              </FieldError>
            ) : null}
          </>
        ) : null}
        {['deposit', 'allocate', 'refund'].includes(action) ? (
          <p className='text-sm text-muted-foreground'>
            {t('billing.beforeAfter', {
              amount: amountView(
                action === 'allocate' ? total : Number(values.amount || 0),
              ),
              remaining: amountView(remaining),
            })}
          </p>
        ) : null}
        {[
          'void',
          'reverseAllocation',
          'reverseRefund',
          'reverseDeposit',
          'refund',
          'issue',
        ].includes(action) ? (
          <p className='text-sm text-muted-foreground'>
            {t(
              action === 'void'
                ? 'billing.voidHelp'
                : action.startsWith('reverse')
                  ? 'billing.reverseHelp'
                  : action === 'refund'
                    ? 'billing.refundHelp'
                    : 'billing.issueHelp',
            )}
          </p>
        ) : null}
        {action === 'allocate'
          ? actions
          : footerTarget
            ? createPortal(actions, footerTarget)
            : null}
      </form>
      <AlertDialog
        open={confirm}
        onOpenChange={(open) => {
          if (!busy) setConfirm(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('billing.confirmTitle', {
                action: t(`billing.${label}`),
                object: t(`billing.${kind}`),
                number: row?.number,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('billing.confirmDescription')}{' '}
              {['deposit', 'allocate', 'refund'].includes(action)
                ? t('billing.beforeAfter', {
                    amount: amountView(
                      action === 'allocate'
                        ? total
                        : Number(values.amount || 0),
                    ),
                    remaining: amountView(remaining),
                  })
                : action === 'void'
                  ? t('billing.voidHelp')
                  : action.startsWith('reverse')
                    ? t('billing.reverseHelp')
                    : t('billing.issueHelp') +
                      (action === 'issue'
                        ? ` ${amountView(Number(row?.amountCents ?? 0) / 100)}`
                        : '')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              {t('billing.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              variant={
                [
                  'void',
                  'refund',
                  'reverseAllocation',
                  'reverseRefund',
                  'reverseDeposit',
                ].includes(action)
                  ? 'destructive'
                  : 'default'
              }
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void execute();
              }}
            >
              {busy ? <Spinner /> : null}
              {t(`billing.${label}`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
