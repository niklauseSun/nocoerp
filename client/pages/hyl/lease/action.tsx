import { BackButton } from '#components/back-button';
import { Spinner } from '#components/ui/spinner';
import { SourcePicker } from './source-picker.js';
import { Fragment, useEffect, useRef, useState } from 'react';
import {
  Link,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient, useToaster, ApiClientError } from '@nocobase/app-client';
import { useQueryClient } from '@tanstack/react-query';
import { useBusinessPermission, useBusinessQuery } from '../hooks.js';
import {
  amountText,
  scalar,
  specs,
  type BusinessRow,
  type Values,
} from '../model.js';
import { Choice, DateField, ErrorPanel, LoadingRows } from '../common.js';
import { ContractAssetsSelector } from '../../assets/bindings.js';
import { DiscardDialog } from '../discard-dialog.js';
import { RouteDialog } from '#components/route-dialog';
import { RouteChildPage } from '#components/route-child-page';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';

import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { Checkbox } from '#components/ui/checkbox';
import {
  Field,
  FieldLabel,
  FieldError,
  FieldGroup,
} from '#components/ui/field';
import { Alert, AlertDescription } from '#components/ui/alert';
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
import { permissions, type LeaseSummary } from './model.js';
export default function LeaseAction() {
  const { id, action = '' } = useParams(),
    { t } = useTranslation();
  const permission = useBusinessPermission(
      'contracts',
      permissions[action] ?? 'depositRead',
    ),
    canRead = useBusinessPermission('contracts', 'depositRead');
  const latest = useBusinessQuery<{ data: BusinessRow }>(`contracts/${id}`),
    summary = useBusinessQuery<{ data: LeaseSummary }>(
      `contracts/${id}/leaseSummary`,
      undefined,
      canRead.can,
    );
  if (!permissions[action])
    return (
      <RouteChildPage>
        <PageContainer>
          <BackButton />
          <p>{t('hyl.errors.404')}</p>
        </PageContainer>
      </RouteChildPage>
    );
  if (latest.error || (canRead.can && summary.error))
    return (
      <RouteChildPage>
        <PageContainer>
          <BackButton />
          <ErrorPanel
            error={latest.error ?? summary.error}
            retry={() => {
              void latest.refetch();
              if (canRead.can) void summary.refetch();
            }}
          />
        </PageContainer>
      </RouteChildPage>
    );
  if (!latest.data || (canRead.can && !summary.data))
    return (
      <RouteChildPage>
        <PageContainer>
          <BackButton />
          <LoadingRows />
        </PageContainer>
      </RouteChildPage>
    );
  if (!permission.can)
    return (
      <RouteChildPage>
        <PageContainer>
          <BackButton />
          <p>{t('hyl.errors.403')}</p>
        </PageContainer>
      </RouteChildPage>
    );
  return (
    <>
      <LeaseActionForm
        key={`${id}/${action}`}
        id={id!}
        action={action}
        current={latest.data.data}
        initialSummary={summary.data?.data}
      />
      <Outlet />
    </>
  );
}
// Mount once after loading the latest version. Subsequent cache refreshes never overwrite a dirty form.
function LeaseActionForm({
  id,
  action,
  current,
  initialSummary,
}: {
  id: string;
  action: string;
  current: BusinessRow;
  initialSummary?: LeaseSummary;
}) {
  const { t, i18n } = useTranslation(),
    api = useApiClient(),
    client = useQueryClient(),
    toaster = useToaster(),
    location = useLocation(),
    navigate = useNavigate();
  const [checkedSummary, setCheckedSummary] = useState(initialSummary);
  const summary = {
    data: checkedSummary ? { data: checkedSummary } : undefined,
  };
  const [values, setValues] = useState<Values>(() => {
    const defaults: Values = {
      amount: '0',
      method: 'bank',
      sourceId: new URLSearchParams(location.search).get('sourceId') ?? '',
      date: new Date().toISOString().slice(0, 10),
    };
    if (action !== 'renew') return defaults;
    const next = new Date(`${scalar(current.payload.end)}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const from = next.toISOString().slice(0, 10);
    return {
      ...(current.payload as Values),
      ...defaults,
      start: from,
      end: from.slice(0, 4) + '-12-31',
      title: scalar(current.payload.title),
      reason: '',
    };
  });
  const [assets, setAssets] = useState<string[]>(() =>
      Array.isArray(current.payload.assetIds)
        ? (current.payload.assetIds as string[])
        : [],
    ),
    versionRef = useRef(
      initialSummary?.version ??
        Number((current.lease as { version?: number })?.version ?? 0),
    ),
    [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [dirty, setDirty] = useState(false),
    [discard, setDiscard] = useState(false),
    [confirm, setConfirm] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState<unknown>(),
    [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{
    actualEnd: string;
    blockers: {
      kind: string;
      id: string;
      number: string;
      date: string;
      status: string;
      contractId?: string;
    }[];
    occupancy?: {
      id: string;
      asset: string;
      start: string;
      end: string;
      proposedEnd: string;
    }[];
  }>();
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const change = (key: string, value: string | boolean) => {
    setValues((old) => ({ ...old, [key]: value }));
    setDirty(true);
    setErrors((old) => ({ ...old, [key]: '' }));
    setError(undefined);
    if (key === 'actualEnd') setPreview(undefined);
  };
  const close = () =>
    void navigate(
      {
        pathname: '..',
        search: (() => {
          const p = new URLSearchParams(location.search);
          p.delete('sourceId');
          return p.toString();
        })(),
      },
      { replace: true },
    );
  const large = ['renew', 'terminate'].includes(action);
  const fields =
    action === 'renew'
      ? [
          'title',
          'start',
          'end',
          'cycle',
          'method',
          'basis',
          'rate',
          'fixedFee',
          'minimum',
          'rent',
          'includeActivity',
          'includeCash',
          'includeHospitality',
          'depositTarget',
          'amount',
          'reason',
          'notes',
        ]
      : action === 'terminate'
        ? ['actualEnd', 'reason', 'handover']
        : ['receive', 'refund', 'collect'].includes(action)
          ? [
              ...(action === 'collect' ? ['sourceId'] : []),
              'amount',
              'date',
              'reference',
              'method',
              'evidence',
              'notes',
              ...(action === 'refund' ? ['reason'] : []),
            ]
          : action === 'deduct'
            ? ['sourceId', 'amount', 'date', 'reason', 'evidence', 'notes']
            : action === 'charge'
              ? [
                  'title',
                  'amount',
                  'date',
                  'reference',
                  'reason',
                  'evidence',
                  'notes',
                ]
              : [
                    'reverse',
                    'reverseCollection',
                    'confirmCharge',
                    'cancelCharge',
                  ].includes(action)
                ? [
                    'sourceId',
                    ...(['reverse', 'reverseCollection'].includes(action)
                      ? ['date']
                      : []),
                    'reason',
                    'evidence',
                  ]
                : ['reason', 'evidence'];
  const sourceOptions = () => {
    const data = summary.data?.data;
    if (['reverse', 'reverseCollection'].includes(action))
      return (data?.entries ?? [])
        .filter(
          (e) =>
            !e.reverseOf &&
            !data?.entries.some((x) => x.reverseOf === e.id) &&
            (['reverseCollection'].includes(action)
              ? e.kind === 'collect'
              : [
                  'receive',
                  'deduct',
                  'refund',
                  'transferIn',
                  'transferOut',
                ].includes(e.kind)),
        )
        .map((e) => ({
          value: e.id,
          label: `${t(`lease.kinds.${e.kind}`)} · ${e.reference ?? e.createdAt.slice(0, 10)} · ${amountText(Number(e.amountCents) / 100, i18n.language)}`,
        }));
    if (['confirmCharge', 'cancelCharge'].includes(action))
      return (data?.charges ?? [])
        .filter((c) => c.state !== 'cancelled')
        .map((c) => ({
          value: c.id,
          kind: 'charge',
          label: `${scalar(c.payload.reason)} · ${amountText(Number(c.amountCents) / 100, i18n.language)}`,
        }));
    return [
      ...(action === 'deduct' ? (data?.bills ?? []) : [])
        .filter((b) => Number(b.remaining) > 0)
        .map((b) => ({
          value: b.id,
          kind: 'bill',
          label: `${b.number} · ${amountText(b.remaining, i18n.language)}`,
        })),
      ...(data?.settlements ?? [])
        .filter((s) => s.status === 'due' && Number(s.debtRemaining) > 0)
        .map((s) => ({
          value: s.id,
          kind: 'settlement',
          label: `${s.number} · ${amountText(s.debtRemaining, i18n.language)}`,
        })),
      ...(data?.charges ?? [])
        .filter((c) => c.state === 'confirmed' && Number(c.remaining) > 0)
        .map((c) => ({
          value: c.id,
          kind: 'charge',
          label: `${scalar(c.payload.reason)} · ${amountText(c.remaining, i18n.language)}`,
        })),
    ];
  };
  const readonlySource = [
    'reverse',
    'reverseCollection',
    'confirmCharge',
    'cancelCharge',
  ].includes(action);
  const selectedEntry = summary.data?.data.entries.find(
    (e) => e.id === values.sourceId,
  );
  const reversalBlockers = ['reverse', 'reverseCollection'].includes(action)
    ? (selectedEntry?.reversalBlockers ?? [])
    : [];
  const validate = () => {
    const e: Record<string, string> = {};
    for (const key of fields) {
      const spec = specs.contracts.find((s) => s.key === key),
        value = values[key];
      if (
        ![
          'notes',
          ...(action === 'renew' ? ['title'] : []),
          'includeActivity',
          'includeCash',
          'includeHospitality',
        ].includes(key) &&
        !scalar(value).trim()
      )
        e[key] = t('hyl.errors.required');
      if (
        (spec?.type === 'money' || key === 'amount') &&
        !/^\d{1,12}(\.\d{1,2})?$/.test(scalar(value))
      )
        e[key] = t('hyl.errors.money');
    }
    if (
      action !== 'renew' &&
      fields.includes('amount') &&
      Number(values.amount) <= 0
    )
      e.amount = t('hyl.errors.money');
    if (action === 'renew' && scalar(values.end) < scalar(values.start))
      e.end = t('hyl.errors.INVALID_PERIOD');
    if (
      action === 'terminate' &&
      (!preview ||
        preview.actualEnd !== values.actualEnd ||
        preview.blockers.length)
    )
      e.actualEnd = t('lease.previewRequired');
    if (
      fields.includes('sourceId') &&
      !sourceOptions().some((o) => o.value === values.sourceId)
    )
      e.sourceId = t('lease.noSources');
    if (reversalBlockers.length) e.sourceId = t('lease.reverseBlocked');
    setErrors(e);
    const first = Object.keys(e)[0];
    if (first) document.getElementById(`lease-${first}`)?.focus();
    return !Object.keys(e).length;
  };
  const perform = async () => {
    if (pending || !current) return;
    setPending(true);
    setError(undefined);
    const body: Record<string, unknown> = {
      requestId: requestId,
      expectedVersion: versionRef.current,
    };
    if (action === 'renew') {
      body.values = {
        ...Object.fromEntries(
          specs.contracts
            .filter((s) => s.key !== 'number')
            .map((s) => [
              s.key,
              values[s.key] ??
                (s.type === 'boolean' ? false : s.type === 'money' ? '0' : ''),
            ]),
        ),
        merchantId: current.merchantId,
        assetIds: assets,
      };
      body.amount = values.amount;
      body.reason = values.reason;
    } else
      for (const key of fields)
        if (values[key] !== '' && values[key] !== undefined)
          body[key] = values[key];
    try {
      const response = await api.request<{ data: { successorId?: string } }>({
        path: `contracts/${id}/leaseActions/${action}`,
        method: 'POST',
        json: body,
      });
      await client.invalidateQueries({ queryKey: ['hyl'] });
      await client.invalidateQueries({ queryKey: ['assets'] });
      setDirty(false);
      toaster.show({
        title: t('lease.savedNamed', { number: current.number }),
        type: 'success',
      });
      if (response.data.successorId)
        void navigate(
          {
            pathname: `/contracts/${response.data.successorId}`,
            search: location.search,
          },
          { replace: true },
        );
      else close();
    } catch (e) {
      setError(e);
      setConfirm(false);
    } finally {
      setPending(false);
    }
  };
  const refreshConflict = async () => {
    setPending(true);
    try {
      const record = await api.request<{ data: BusinessRow }>({
        path: `contracts/${id}`,
      });
      const fresh = initialSummary
        ? await api.request<{ data: LeaseSummary }>({
            path: `contracts/${id}/leaseSummary`,
          })
        : undefined;
      versionRef.current =
        fresh?.data.version ??
        Number((record.data.lease as { version?: number })?.version ?? 0);
      setCheckedSummary(fresh?.data);
      setRequestId(crypto.randomUUID());
      setPreview(undefined);
      setError(undefined);
      toaster.show({ title: t('lease.refreshed'), type: 'success' });
    } catch (cause) {
      setError(cause);
    } finally {
      setPending(false);
    }
  };
  const getPreview = async () => {
    if (!values.actualEnd) return;
    setPending(true);
    setError(undefined);
    try {
      const response = await api.request<{ data: NonNullable<typeof preview> }>(
        {
          path: `contracts/${id}/terminationPreview`,
          method: 'POST',
          json: { actualEnd: values.actualEnd },
        },
      );
      setPreview(response.data);
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };
  const form = (
    <form
      id='lease-action-form'
      className='flex flex-col gap-5'
      onSubmit={(e) => {
        e.preventDefault();
        if (validate()) setConfirm(true);
      }}
    >
      <p className='text-sm text-muted-foreground'>{t('lease.ledgerOnly')}</p>
      {summary.data ? (
        <p>
          {t('lease.balance')}：
          {amountText(summary.data.data.balance, i18n.language)}
        </p>
      ) : null}
      {error ? (
        <>
          <ErrorPanel error={error} />
          {error instanceof ApiClientError && error.status === 409 ? (
            <Button
              type='button'
              variant='outline'
              disabled={pending}
              onClick={() => void refreshConflict()}
            >
              {t('lease.refreshConflict')}
            </Button>
          ) : null}
        </>
      ) : null}
      {['renew', 'terminate'].includes(action) && summary.data ? (
        <div className='rounded-lg border p-4 text-sm'>
          <p>
            {t('lease.existingItems', {
              bills: summary.data.data.settlements.filter(
                (s) =>
                  !['paid', 'settled'].includes(s.status) &&
                  !(s.status === 'due' && Number(s.debtRemaining) === 0),
              ).length,
              charges: summary.data.data.charges.filter(
                (c) => c.state !== 'cancelled' && Number(c.remaining) > 0,
              ).length,
            })}
          </p>
        </div>
      ) : null}
      {action === 'renew' ? (
        <dl className='grid grid-cols-[8rem_1fr] gap-3 rounded-lg border p-4'>
          <dt>{t('hyl.fields.merchantId')}</dt>
          <dd>{current.name}</dd>
          <dt>{t('hyl.fields.number')}</dt>
          <dd className='break-all'>{current.number}</dd>
        </dl>
      ) : null}
      {reversalBlockers.length ? (
        <Alert>
          <AlertDescription>
            <p>{t('lease.reverseBlocked')}</p>
            {reversalBlockers.map((b) => (
              <div key={b.reason + b.contractId}>
                <p>{t(`lease.reverseReasons.${b.reason}`)}</p>
                {b.contractId ? (
                  <Link className='underline' to={`/contracts/${b.contractId}`}>
                    {t('lease.openContract')}
                  </Link>
                ) : null}
                {b.entries.length ? (
                  <p className='break-all'>{b.entries.join(' / ')}</p>
                ) : null}
              </div>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}
      <FieldGroup>
        {fields.map((key) => {
          const spec = specs.contracts.find((s) => s.key === key),
            label = t(
              action === 'charge' && key === 'title'
                ? 'lease.chargeTitle'
                : action === 'renew' && key === 'amount'
                  ? 'lease.transferAmount'
                  : i18n.exists(`lease.${key}`)
                    ? `lease.${key}`
                    : `hyl.fields.${key}`,
            );
          return (
            <Fragment key={key}>
              {action === 'renew' &&
              [
                'title',
                'start',
                'cycle',
                'includeActivity',
                'depositTarget',
              ].includes(key) ? (
                <h2 className='border-t pt-4 font-medium'>
                  {t(`lease.groups.${key}`)}
                </h2>
              ) : null}
              <Field data-invalid={!!errors[key]}>
                <FieldLabel htmlFor={`lease-${key}`}>
                  {label}
                  {![
                    'notes',
                    ...(action === 'renew' ? ['title'] : []),
                  ].includes(key)
                    ? ' *'
                    : ''}
                </FieldLabel>
                {key === 'sourceId' ? (
                  readonlySource ? (
                    <div
                      id='lease-sourceId'
                      tabIndex={-1}
                      className='rounded-lg border p-3 text-sm'
                    >
                      <p>
                        {sourceOptions().find(
                          (o) => o.value === values.sourceId,
                        )?.label ?? t('lease.noSources')}
                      </p>
                      <p className='mt-1 break-all text-muted-foreground'>
                        {scalar(values.sourceId)}
                      </p>
                    </div>
                  ) : (
                    <SourcePicker
                      value={scalar(values[key])}
                      onChange={(v) => change(key, v)}
                      options={sourceOptions()}
                      disabled={pending}
                    />
                  )
                ) : key === 'method' && action !== 'renew' ? (
                  <Choice
                    disabled={pending}
                    id={`lease-${key}`}
                    ariaLabel={label}
                    value={scalar(values[key])}
                    onChange={(v) => change(key, v)}
                    options={['bank', 'cash', 'other'].map((v) => ({
                      value: v,
                      label: t(`hyl.enums.${v}`),
                    }))}
                  />
                ) : spec?.type === 'select' ? (
                  <Choice
                    disabled={pending}
                    id={`lease-${key}`}
                    ariaLabel={label}
                    value={scalar(values[key])}
                    onChange={(v) => change(key, v)}
                    options={(spec.options ?? []).map((v) => ({
                      value: v,
                      label: t(`hyl.enums.${v}`),
                    }))}
                  />
                ) : spec?.type === 'boolean' ? (
                  <Checkbox
                    id={`lease-${key}`}
                    checked={!!values[key]}
                    onCheckedChange={(v) => change(key, !!v)}
                    disabled={pending}
                  />
                ) : spec?.type === 'date' ||
                  ['date', 'actualEnd'].includes(key) ? (
                  <DateField
                    id={`lease-${key}`}
                    value={scalar(values[key])}
                    onChange={(v) => change(key, v)}
                    disabled={pending}
                  />
                ) : ['notes', 'reason', 'handover', 'evidence'].includes(
                    key,
                  ) ? (
                  <Textarea
                    id={`lease-${key}`}
                    value={scalar(values[key])}
                    onChange={(e) => change(key, e.target.value)}
                    disabled={pending}
                    maxLength={
                      key === 'evidence' || key === 'reason' ? 500 : 1000
                    }
                  />
                ) : (
                  <Input
                    id={`lease-${key}`}
                    value={scalar(values[key])}
                    onChange={(e) => change(key, e.target.value)}
                    disabled={pending}
                    inputMode={
                      spec?.type === 'money' || key === 'amount'
                        ? 'decimal'
                        : undefined
                    }
                    maxLength={
                      key === 'reference' || key === 'title' ? 100 : undefined
                    }
                  />
                )}
                <FieldError>{errors[key]}</FieldError>
              </Field>
            </Fragment>
          );
        })}
      </FieldGroup>
      {action === 'renew' && current ? (
        <>
          <p className='text-sm text-muted-foreground'>
            {t('lease.renewHelp')}
          </p>
          <ContractAssetsSelector
            merchantId={current.merchantId}
            value={assets}
            onChange={(v) => {
              setAssets(v);
              setDirty(true);
            }}
            disabled={pending}
          />
        </>
      ) : null}
      {action === 'terminate' ? (
        <>
          <Button
            type='button'
            variant='outline'
            disabled={pending || !values.actualEnd}
            onClick={() => void getPreview()}
          >
            {t('lease.preview')}
          </Button>
          {preview ? (
            <Alert>
              <AlertDescription>
                <p>{t('lease.previewImpact', { date: preview.actualEnd })}</p>
                {preview.occupancy?.map((b) => (
                  <p key={b.id}>
                    {b.asset} · {b.start} — {b.end || '—'} → {b.proposedEnd}
                  </p>
                ))}
                {preview.blockers.length ? (
                  <>
                    <p>{t('lease.blocked')}</p>
                    {preview.blockers.map((b) =>
                      b.kind === 'billingCoverage' ? (
                        <p key={b.id + b.status}>
                          {b.number} · {b.date} ·{' '}
                          {t('energy.closing.' + b.status, {
                            defaultValue: t('energy.closing.other'),
                          })}
                        </p>
                      ) : (
                        <Link
                          className='block underline'
                          key={b.id}
                          to={{
                            pathname:
                              b.kind === 'bills' || b.kind === 'receipts'
                                ? `${b.kind}/${b.id}`
                                : b.kind === 'bindings'
                                  ? `/contracts/${b.contractId}`
                                  : `/${b.kind}/${b.id}`,
                            search: location.search,
                          }}
                        >
                          {b.number} · {b.date} ·{' '}
                          {t(
                            `${b.kind === 'bills' || b.kind === 'receipts' ? 'billing' : 'hyl'}.states.${b.status}`,
                          )}
                        </Link>
                      ),
                    )}
                  </>
                ) : (
                  <p>{t('lease.noBlockers')}</p>
                )}
              </AlertDescription>
            </Alert>
          ) : null}
        </>
      ) : null}
    </form>
  );
  const content = form;
  const buttons = (
    <>
      <Button
        variant='outline'
        type='button'
        disabled={pending}
        onClick={() => (dirty ? setDiscard(true) : close())}
      >
        {t('hyl.actions.back')}
      </Button>
      <Button
        type='submit'
        form='lease-action-form'
        disabled={pending || !!reversalBlockers.length}
      >
        {pending ? <Spinner /> : null}
        {t(`lease.actions.${action}`)}
      </Button>
    </>
  );
  return (
    <>
      {large ? (
        <RouteChildPage>
          <PageContainer className='max-w-4xl'>
            <Button
              variant='ghost'
              disabled={pending}
              onClick={() => (dirty ? setDiscard(true) : close())}
            >
              {t('navigation.back')}
            </Button>
            <PageHeader title={t(`lease.actions.${action}`)} />
            {content}
            <div className='mt-6 flex justify-end gap-3'>{buttons}</div>
          </PageContainer>
        </RouteChildPage>
      ) : (
        <RouteDialog
          title={t(`lease.actions.${action}`)}
          description={current?.number}
          className='sm:max-w-2xl'
          closeTo={{ pathname: '..', search: location.search }}
          beforeClose={() => {
            if (pending) return false;
            if (dirty) {
              setDiscard(true);
              return false;
            }
            return true;
          }}
          footer={buttons}
        >
          {content}
        </RouteDialog>
      )}
      <DiscardDialog
        open={discard}
        onOpenChange={setDiscard}
        onConfirm={() => {
          setDirty(false);
          close();
        }}
      />
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('lease.confirmTitle', {
                action: t(`lease.actions.${action}`),
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className='mb-2 block'>{t(`lease.effects.${action}`)}</span>
              {t('lease.confirmImpact', {
                number: current?.number,
                action: t(`lease.actions.${action}`),
                amount: [
                  'reverse',
                  'reverseCollection',
                  'confirmCharge',
                  'cancelCharge',
                ].includes(action)
                  ? amountText(
                      Number(
                        checkedSummary?.entries.find(
                          (e) => e.id === values.sourceId,
                        )?.amountCents ?? 0,
                      ) / 100,
                      i18n.language,
                    )
                  : amountText(values.amount ?? '0', i18n.language),
                date:
                  action === 'renew'
                    ? `${scalar(values.start)} — ${scalar(values.end)}`
                    : (values.actualEnd ?? values.date ?? '—'),
              })}
              {values.sourceId ? (
                <span className='mt-2 block'>
                  {t('lease.source')}：
                  {sourceOptions().find((s) => s.value === values.sourceId)
                    ?.label ?? scalar(values.sourceId)}
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              {t('hyl.actions.back')}
            </AlertDialogCancel>
            <AlertDialogAction
              variant={
                [
                  'refund',
                  'deduct',
                  'reverse',
                  'reverseCollection',
                  'terminate',
                  'cancelCharge',
                  'closeLease',
                  'reopenLease',
                ].includes(action)
                  ? 'destructive'
                  : 'default'
              }
              disabled={pending || !!reversalBlockers.length}
              onClick={(e) => {
                e.preventDefault();
                void perform();
              }}
            >
              {t('lease.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
