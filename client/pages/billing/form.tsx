import { ManagedMeters } from '../energy/managed-meters.js';
import { fieldMessages } from './form-errors.js';
import { useEffect, useState, useCallback } from 'react';
import {
  Link,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
  useResolvedPath,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient, useToaster, ApiClientError } from '@nocobase/app-client';
import { useQueryClient } from '@tanstack/react-query';
import { RouteChildPage } from '#components/route-child-page';
import { BackButton } from '#components/back-button';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import {
  Field,
  FieldLabel,
  FieldError,
  FieldGroup,
} from '#components/ui/field';
import { Checkbox } from '#components/ui/checkbox';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { Spinner } from '#components/ui/spinner';
import { DiscardDialog } from '../hyl/discard-dialog.js';
import { useBusinessQuery, useBusinessPermission } from '../hyl/hooks.js';
import {
  BillingError,
  Choice,
  DateField,
  LoadingRows,
  Money,
  RecordPicker,
  TextField,
  Value,
} from './common.js';
import { Calculation } from './lines.js';
import {
  utilities,
  type Bill,
  type BillInput,
  type Configuration,
  type ConfigResponse,
  type Preview,
  type Meter,
} from './types.js';

export default function BillingForm() {
  const params = useParams(),
    location = useLocation(),
    { t } = useTranslation();
  const viewPath = useResolvedPath('.').pathname;
  const [guard, setGuard] = useState({ dirty: false, busy: false });
  const [backPrompt, setBackPrompt] = useState(false);
  const navigate = useNavigate();
  const onGuardChange = useCallback(
    (value: { dirty: boolean; busy: boolean }) => setGuard(value),
    [],
  );
  const configMode = /\/billingConfig(?:\/[^/]+)?$/.test(viewPath),
    edit = viewPath.endsWith('/edit');
  const [selected, setSelected] = useState(
    () =>
      params.billingContractId ||
      params.id ||
      new URLSearchParams(location.search).get('contractId') ||
      '',
  );
  const can = useBusinessPermission(
    'contracts',
    configMode ? 'billingConfigure' : 'billWrite',
  );
  const [readVersion] = useState(() => crypto.randomUUID());
  const bill = useBusinessQuery<{ data: Bill }>(
    `bills/${params.billId}`,
    { readVersion },
    edit && !!params.billId && can.can,
  );
  const contractId = edit ? bill.data?.data.contractId || '' : selected;
  const cfg = useBusinessQuery<{ data: ConfigResponse }>(
    `contracts/${contractId}/billingConfig`,
    { readVersion },
    !!contractId && can.can,
  );
  return (
    <>
      <RouteChildPage>
        <PageContainer className='mx-auto max-w-4xl'>
          <BackButton
            onClick={(e) => {
              if (guard.busy || guard.dirty) {
                e.preventDefault();
                if (!guard.busy) setBackPrompt(true);
              }
            }}
            to={{
              pathname: configMode
                ? viewPath.replace(/\/billingConfig(?:\/[^/]+)?$/, '')
                : viewPath.slice(0, viewPath.lastIndexOf('/')),
              search: location.search,
            }}
          />
          <PageHeader
            title={t(
              configMode
                ? 'billing.configure'
                : edit
                  ? 'billing.editBill'
                  : 'billing.generate',
            )}
            description={t('billing.offline')}
          />
          {!can.can ? (
            <p>{t('billing.restricted')}</p>
          ) : (
            <>
              {!params.id && !edit && !configMode ? (
                <Field>
                  <FieldLabel htmlFor='billing-contract'>
                    {t('billing.fields.contract')} *
                  </FieldLabel>
                  <RecordPicker
                    id='billing-contract'
                    kind='contracts'
                    value={selected}
                    onChange={setSelected}
                  />
                </Field>
              ) : null}
              {bill.error || cfg.error ? (
                <BillingError
                  error={bill.error || cfg.error}
                  retry={() => {
                    void cfg.refetch();
                    if (edit) void bill.refetch();
                  }}
                />
              ) : !contractId ? (
                <p className='text-sm text-muted-foreground'>
                  {t('hyl.copy.noContract')}
                </p>
              ) : !cfg.data || (edit && !bill.data) ? (
                <LoadingRows />
              ) : (
                <FormBody
                  onGuardChange={onGuardChange}
                  key={`${contractId}:${configMode}`}
                  configMode={configMode}
                  cfg={cfg.data.data}
                  bill={bill.data?.data}
                  onReload={async () => {
                    const [c, b] = await Promise.all([
                      cfg.refetch(),
                      edit ? bill.refetch() : Promise.resolve(undefined),
                    ]);
                    return { cfg: c.data?.data, bill: b?.data?.data };
                  }}
                />
              )}
            </>
          )}
        </PageContainer>
        <DiscardDialog
          open={backPrompt}
          onOpenChange={setBackPrompt}
          onConfirm={() =>
            void navigate({
              pathname: configMode
                ? viewPath.replace(/\/billingConfig(?:\/[^/]+)?$/, '')
                : viewPath.slice(0, viewPath.lastIndexOf('/')),
              search: location.search,
            })
          }
        />
      </RouteChildPage>
      <Outlet />
    </>
  );
}
function FormBody({
  configMode,
  cfg,
  bill,
  onReload,
  onGuardChange,
}: {
  configMode: boolean;
  cfg: ConfigResponse;
  bill?: Bill;
  onReload: () => Promise<{ cfg?: ConfigResponse; bill?: Bill }>;
  onGuardChange: (value: { dirty: boolean; busy: boolean }) => void;
}) {
  const { t } = useTranslation(),
    location = useLocation(),
    navigate = useNavigate(),
    api = useApiClient(),
    toaster = useToaster(),
    cache = useQueryClient();
  const current = cfg.history.at(-1)?.payload;
  const [config, setConfig] = useState<Configuration>(() =>
    current
      ? {
          ...structuredClone(current),
          meters: current.meters.map((m) => ({
            ...m,
            uiKey: crypto.randomUUID(),
          })),
        }
      : {
          effectiveFrom: cfg.contract.start,
          rentChannel: 'settlement',
          property: { enabled: false, method: 'fixed', price: '0' },
          utilities: {},
          meters: [],
          notes: '',
        },
  );
  const defaultMonth = cfg.contract.start.slice(0, 7);
  const firstRules = cfg.history
    .filter((h) => h.effectiveFrom <= cfg.contract.start)
    .at(-1)?.payload;
  const initialInput: BillInput = bill?.payload.input ?? {
    month: defaultMonth,
    part:
      cfg.contract.cycle === 'month'
        ? 'month'
        : Number(cfg.contract.start.slice(8)) > 15
          ? 'second'
          : 'first',
    dueDate: cfg.contract.end,
    fees: [
      ...(firstRules?.rentChannel === 'bill' ? ['rent'] : []),
      ...(firstRules?.property.enabled ? ['property'] : []),
    ],
    readings: [],
    others: [],
    acknowledgeGaps: false,
    zeroReason: '',
    zeroEvidence: '',
    notes: '',
  };
  const [input, setInput] = useState<BillInput>(() => ({
      ...structuredClone(initialInput),
      readings: initialInput.readings.map((r) => ({
        ...r,
        uiKey: crypto.randomUUID(),
      })),
      others: initialInput.others.map((r) => ({
        ...r,
        uiKey: crypto.randomUUID(),
      })),
    })),
    [preview, setPreview] = useState<Preview>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [attempted, setAttempted] = useState(false),
    [version, setVersion] = useState(bill?.version ?? cfg.version),
    [contractVersion, setContractVersion] = useState(cfg.contract.version),
    [requestId, setRequestId] = useState(() => crypto.randomUUID()),
    [discard, setDiscard] = useState(false),
    [copyNotice, setCopyNotice] = useState(false);
  const cycleDay = `${input.month}-${input.part === 'second' ? '16' : '01'}`;
  const selectedRules = cfg.history
    .filter(
      (h) =>
        h.effectiveFrom <=
        (cycleDay < cfg.contract.start ? cfg.contract.start : cycleDay),
    )
    .at(-1)?.payload;
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(configMode ? config : input),
  );
  const dirty = baseline !== JSON.stringify(configMode ? config : input);
  useEffect(() => onGuardChange({ dirty, busy }), [dirty, busy, onGuardChange]);
  const ownPath = useResolvedPath('.').pathname;
  const parent = configMode
    ? ownPath.replace(/\/billingConfig(?:\/[^/]+)?$/, '')
    : ownPath.slice(0, ownPath.lastIndexOf('/'));
  const close = () =>
    void navigate({ pathname: parent, search: location.search });
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty || busy) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);
  const field = (
    name: string,
    value: string,
    setter: (v: string) => void,
    required = false,
    decimal = false,
    label?: string,
  ) => (
    <TextField
      name={name}
      value={value}
      onChange={(v) => {
        setter(v);
        setPreview(undefined);
        if (attempted)
          setErrors((old) => ({
            ...old,
            [name]: required && !v.trim() ? t('billing.required') : '',
          }));
      }}
      required={required}
      decimal={decimal}
      error={errors[name]}
      disabled={busy}
      label={label}
    />
  );
  const update = <K extends keyof BillInput>(key: K, value: BillInput[K]) => {
    setInput((old) => ({ ...old, [key]: value }));
    setPreview(undefined);
  };
  const day = (
    name: string,
    value: string,
    onChange: (v: string) => void,
    required = true,
  ) => (
    <Field>
      <FieldLabel htmlFor={`billing-${name}`}>
        {t(`billing.fields.${name.split('.').at(-1)}`)}
        {required ? ' *' : ''}
      </FieldLabel>
      <DateField
        id={`billing-${name}`}
        value={value}
        onChange={(v) => {
          onChange(v);
          setPreview(undefined);
        }}
        disabled={busy}
      />
      {errors[name] ? <FieldError>{errors[name]}</FieldError> : null}
    </Field>
  );
  const check = (
    label: string,
    checked: boolean,
    onChange: (v: boolean) => void,
  ) => (
    <label className='flex items-center gap-2 text-sm'>
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => {
          onChange(!!v);
          setPreview(undefined);
        }}
        disabled={busy}
      />
      {label}
    </label>
  );
  const validate = () => {
    const e: Record<string, string> = {};
    const required = (key: string, value: string) => {
      if (!value.trim()) e[key] = t('billing.required');
    };
    if (configMode) {
      required('effectiveFrom', config.effectiveFrom);
      if (
        config.property.enabled &&
        (!/^\d+(\.\d{1,4})?$/.test(config.property.price) ||
          Number(config.property.price) <= 0)
      )
        e.propertyPrice = t('billing.positive');
      for (const type of utilities)
        if (
          config.utilities[type] !== undefined &&
          Number(config.utilities[type]) <= 0
        )
          e[type] = t('billing.positive');
      config.meters.forEach((m, i) => {
        for (const key of [
          'assetId',
          'meterCode',
          'activeFrom',
          'openingReading',
          'openingEvidence',
        ] as const)
          required(`meters.${i}.${key}`, m[key]);
        if (m.activeTo) {
          required(`meters.${i}.stopReading`, m.stopReading ?? '');
          required(`meters.${i}.stopEvidence`, m.stopEvidence);
        }
      });
    } else {
      required('month', input.month);
      required('dueDate', input.dueDate);
      input.readings.forEach((r, i) => {
        for (const key of [
          'start',
          'end',
          'previous',
          'current',
          'multiplier',
          'evidence',
        ] as const)
          required(`readings.${i}.${key}`, r[key]);
      });
      input.others.forEach((r, i) => {
        for (const key of [
          'title',
          'amount',
          'reference',
          'reason',
          'evidence',
        ] as const)
          required(`others.${i}.${key}`, r[key]);
        if (Number(r.amount) <= 0)
          e[`others.${i}.amount`] = t('billing.positive');
      });
    }
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
  const execute = async (onlyPreview = false) => {
    if (!validate()) return;
    setError(undefined);
    setBusy(true);
    const cleanConfig = {
      ...config,
      meters: config.meters.map(({ uiKey: _key, ...m }) => m),
    };
    const cleanInput = {
      ...input,
      readings: input.readings.map(({ uiKey: _key, ...r }) => r),
      others: input.others.map(({ uiKey: _key, ...o }) => o),
    };
    try {
      if (configMode) {
        const response = await api.request<{ data: { version: number } }>({
          path: `contracts/${cfg.contract.id}/billingConfig`,
          method: 'PUT',
          json: { ...cleanConfig, requestId, expectedVersion: version },
        });
        setVersion(response.data.version);
        setBaseline(JSON.stringify(config));
        await cache.invalidateQueries({ queryKey: ['hyl'] });
        toaster.show({
          title: t('billing.success', {
            action: t('billing.save'),
            number: cfg.contract.number,
          }),
          type: 'success',
        });
        close();
      } else if (onlyPreview) {
        const response = await api.request<{ data: Preview }>({
          path: `contracts/${cfg.contract.id}/previewBill`,
          method: 'POST',
          json: { ...cleanInput, ...(bill ? { billId: bill.id } : {}) },
        });
        setPreview(response.data);
      } else {
        if (!preview) return;
        const response = await api.request<{ data: Bill }>({
          path: bill ? `bills/${bill.id}` : 'bills',
          method: bill ? 'PATCH' : 'POST',
          json: {
            ...cleanInput,
            requestId,
            configVersion: preview.config.version,
            ...(bill
              ? { expectedVersion: version }
              : {
                  contractId: cfg.contract.id,
                  expectedContractVersion: contractVersion,
                }),
          },
        });
        setBaseline(JSON.stringify(input));
        await cache.invalidateQueries({ queryKey: ['hyl'] });
        toaster.show({
          title: t('billing.success', {
            action: t(bill ? 'billing.save' : 'billing.create'),
            number: response.data.number,
          }),
          type: 'success',
        });
        void navigate({
          pathname: bill
            ? parent
            : parent.startsWith('/contracts/')
              ? `${parent}/bills/${response.data.id}`
              : `${parent}/${response.data.id}`,
          search: location.search,
        });
      }
    } catch (e) {
      setError(e);
      const serverErrors = fieldMessages(e, t);
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
    } finally {
      setBusy(false);
    }
  };
  const loadLatest = async () => {
    setBusy(true);
    try {
      const latest = await onReload();
      setVersion(latest.bill?.version ?? latest.cfg?.version ?? version);
      setContractVersion(latest.cfg?.contract.version ?? contractVersion);
      setRequestId(crypto.randomUUID());
      setPreview(undefined);
      setError(undefined);
    } finally {
      setBusy(false);
    }
  };
  const meterEdit = (index: number, patch: Partial<Meter>) =>
    setConfig((old) => ({
      ...old,
      meters: old.meters.map((m, i) => (i === index ? { ...m, ...patch } : m)),
    }));
  const form = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void execute(!configMode && !preview);
      }}
      className='flex flex-col gap-6'
      noValidate
    >
      <dl className='flex flex-col gap-2'>
        <Value label='contract'>{cfg.contract.number}</Value>
        <Value label='rent'>
          <Money value={cfg.contract.rent} />
        </Value>
        <Value label='start'>{cfg.contract.start}</Value>
        <Value label='end'>{cfg.contract.end}</Value>
      </dl>
      {configMode ? <ManagedMeters contractId={cfg.contract.id} /> : null}
      {error ? <BillingError error={error} /> : null}
      {error instanceof ApiClientError && error.status === 409 ? (
        <Alert>
          <AlertDescription>
            {t('billing.conflict')}
            <Button
              type='button'
              variant='outline'
              onClick={() => void loadLatest()}
              disabled={busy}
            >
              {t('billing.reload')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {cfg.lease.status === 'closed' ? (
        <Alert>
          <AlertDescription>{t('billing.closed')}</AlertDescription>
        </Alert>
      ) : null}
      {configMode ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('billing.feeConfig')}</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                {!cfg.version && cfg.lease.payload?.predecessorId ? (
                  <Button
                    type='button'
                    variant='outline'
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      void api
                        .request<{ data: ConfigResponse }>({
                          path: `contracts/${cfg.lease.payload!.predecessorId}/billingConfig`,
                        })
                        .then(({ data }) => {
                          const prior = data.history
                            .filter((h) => h.effectiveFrom <= data.contract.end)
                            .at(-1)?.payload;
                          if (prior) {
                            setConfig({
                              ...structuredClone(prior),
                              effectiveFrom: cfg.contract.start,
                              meters: prior.meters
                                .filter((m) =>
                                  cfg.assets.some(
                                    (a) => a.assetId === m.assetId,
                                  ),
                                )
                                .map((m) => ({
                                  ...m,
                                  uiKey: crypto.randomUUID(),
                                  activeFrom: cfg.contract.start,
                                  activeTo: undefined,
                                  openingReading:
                                    m.stopReading ?? m.openingReading,
                                  openingEvidence: '',
                                  stopReading: undefined,
                                  stopEvidence: '',
                                })),
                            });
                            setCopyNotice(true);
                          }
                        })
                        .catch(setError)
                        .finally(() => setBusy(false));
                    }}
                  >
                    {t('billing.copyPrevious')}
                  </Button>
                ) : null}
                {copyNotice ? (
                  <Alert>
                    <AlertDescription>
                      {t('billing.copyReview')}
                    </AlertDescription>
                  </Alert>
                ) : null}
                {day('effectiveFrom', config.effectiveFrom, (v) =>
                  setConfig({ ...config, effectiveFrom: v }),
                )}
                <Field>
                  <FieldLabel>{t('billing.fields.rentChannel')} *</FieldLabel>
                  <Choice
                    ariaLabel={t('billing.fields.rentChannel')}
                    value={config.rentChannel}
                    disabled={busy || cfg.channelLocked}
                    onChange={(v) =>
                      setConfig({
                        ...config,
                        rentChannel: v as Configuration['rentChannel'],
                      })
                    }
                    options={['settlement', 'bill'].map((v) => ({
                      value: v,
                      label: t(`billing.channels.${v}`),
                    }))}
                  />
                  <p className='text-sm text-muted-foreground'>
                    {t(
                      cfg.channelLocked
                        ? 'billing.channelLocked'
                        : 'billing.channelNote',
                    )}
                  </p>
                </Field>
                {check(
                  t('billing.fees.property'),
                  config.property.enabled,
                  (v) =>
                    setConfig({
                      ...config,
                      property: { ...config.property, enabled: v },
                    }),
                )}
                {config.property.enabled ? (
                  <>
                    <Choice
                      ariaLabel={t('billing.fields.propertyMethod')}
                      value={config.property.method}
                      onChange={(v) =>
                        setConfig({
                          ...config,
                          property: {
                            ...config.property,
                            method: v as 'fixed' | 'area',
                          },
                        })
                      }
                      options={['fixed', 'area'].map((v) => ({
                        value: v,
                        label: t(`billing.${v}`),
                      }))}
                      disabled={busy}
                    />
                    {field(
                      'propertyPrice',
                      config.property.price,
                      (v) =>
                        setConfig({
                          ...config,
                          property: { ...config.property, price: v },
                        }),
                      true,
                      true,
                    )}
                  </>
                ) : null}
                {utilities.map((type) => (
                  <div key={type} className='flex flex-col gap-2'>
                    {check(
                      t(`billing.fees.${type}`),
                      config.utilities[type] !== undefined,
                      (v) =>
                        setConfig({
                          ...config,
                          utilities: {
                            ...config.utilities,
                            [type]: v ? '1' : undefined,
                          },
                          meters: config.meters,
                        }),
                    )}
                    {config.utilities[type] !== undefined
                      ? field(
                          type,
                          config.utilities[type] ?? '',
                          (v) =>
                            setConfig({
                              ...config,
                              utilities: { ...config.utilities, [type]: v },
                            }),
                          true,
                          true,
                          t(`billing.fees.${type}`) +
                            ' · ' +
                            t('billing.fields.unitPrice'),
                        )
                      : null}
                  </div>
                ))}
                <p className='text-sm text-muted-foreground'>
                  {t('billing.futureConfig')}
                </p>
              </FieldGroup>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('billing.readings')}</CardTitle>
            </CardHeader>
            <CardContent className='flex flex-col gap-4'>
              <p className='text-sm text-muted-foreground'>
                {t('billing.meterHelp')}
              </p>
              {config.meters.map((m, i) => (
                <div
                  key={m.uiKey}
                  className='flex flex-col gap-4 rounded-lg border p-4'
                >
                  <div className='grid gap-4 sm:grid-cols-2'>
                    <Field>
                      <FieldLabel>{t('billing.fields.asset')} *</FieldLabel>
                      <Choice
                        id={`billing-meters.${i}.assetId`}
                        ariaLabel={t('billing.fields.asset')}
                        value={m.assetId}
                        onChange={(v) => meterEdit(i, { assetId: v })}
                        disabled={busy}
                        options={cfg.assets.map((a) => ({
                          value: a.assetId,
                          label: a.snapshot.name,
                        }))}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>{t('billing.fields.feeType')} *</FieldLabel>
                      <Choice
                        ariaLabel={t('billing.fields.feeType')}
                        value={m.feeType}
                        onChange={(v) =>
                          meterEdit(i, { feeType: v as Meter['feeType'] })
                        }
                        disabled={busy}
                        options={utilities
                          .filter(
                            (v) =>
                              config.utilities[v] !== undefined ||
                              v === m.feeType,
                          )
                          .map((v) => ({
                            value: v,
                            label: t(`billing.fees.${v}`),
                          }))}
                      />
                    </Field>
                    {field(
                      `meters.${i}.meterCode`,
                      m.meterCode,
                      (v) => meterEdit(i, { meterCode: v }),
                      true,
                    )}
                    {day(`meters.${i}.activeFrom`, m.activeFrom, (v) =>
                      meterEdit(i, { activeFrom: v }),
                    )}
                    {field(
                      `meters.${i}.openingReading`,
                      m.openingReading,
                      (v) => meterEdit(i, { openingReading: v }),
                      true,
                      true,
                    )}
                    {field(
                      `meters.${i}.openingEvidence`,
                      m.openingEvidence,
                      (v) => meterEdit(i, { openingEvidence: v }),
                      true,
                    )}
                    {day(
                      `meters.${i}.activeTo`,
                      m.activeTo ?? '',
                      (v) => meterEdit(i, { activeTo: v || undefined }),
                      false,
                    )}
                    {m.activeTo ? (
                      <>
                        {field(
                          `meters.${i}.stopReading`,
                          m.stopReading ?? '',
                          (v) => meterEdit(i, { stopReading: v }),
                          true,
                          true,
                        )}
                        {field(
                          `meters.${i}.stopEvidence`,
                          m.stopEvidence,
                          (v) => meterEdit(i, { stopEvidence: v }),
                          true,
                        )}
                      </>
                    ) : null}
                  </div>
                  <Button
                    type='button'
                    variant='outline'
                    disabled={busy}
                    onClick={() =>
                      setConfig({
                        ...config,
                        meters: config.meters.filter((_, n) => n !== i),
                      })
                    }
                  >
                    {t('billing.remove')}
                  </Button>
                </div>
              ))}
              <Button
                type='button'
                variant='outline'
                disabled={
                  busy ||
                  !utilities.some((u) => config.utilities[u] !== undefined) ||
                  config.meters.length >= 50
                }
                onClick={() =>
                  setConfig({
                    ...config,
                    meters: [
                      ...config.meters,
                      {
                        uiKey: crypto.randomUUID(),
                        assetId: cfg.assets[0]?.assetId ?? '',
                        feeType:
                          utilities.find(
                            (u) => config.utilities[u] !== undefined,
                          ) ?? 'water',
                        meterCode: '',
                        activeFrom: config.effectiveFrom,
                        openingReading: '0',
                        openingEvidence: '',
                        stopEvidence: '',
                      },
                    ],
                  })
                }
              >
                {t('billing.add')} · {t('billing.fields.meterCode')}
              </Button>
            </CardContent>
          </Card>
          {cfg.history.length ? (
            <Card>
              <CardHeader>
                <CardTitle>{t('billing.history')}</CardTitle>
              </CardHeader>
              <CardContent className='flex flex-col gap-2'>
                {cfg.history.map((h) => (
                  <p className='text-sm' key={h.id}>
                    {h.effectiveFrom} ·{' '}
                    {t(`billing.channels.${h.payload.rentChannel}`)} ·{' '}
                    {t('billing.fees.property')}:{' '}
                    {h.payload.property.enabled
                      ? h.payload.property.price
                      : '—'}
                  </p>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('billing.feeConfig')}</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Button
                  variant='outline'
                  type='button'
                  nativeButton={false}
                  render={
                    <Link
                      to={{
                        pathname: `billingConfig/${cfg.contract.id}`,
                        search: location.search,
                      }}
                    />
                  }
                >
                  {t('billing.configure')}
                </Button>
                <Field>
                  <FieldLabel htmlFor='billing-month'>
                    {t('billing.fields.month')} *
                  </FieldLabel>
                  <DateField
                    id='billing-month'
                    month
                    value={input.month}
                    onChange={(v) => update('month', v)}
                    disabled={busy}
                  />
                </Field>
                <Field>
                  <FieldLabel>{t('billing.fields.part')} *</FieldLabel>
                  <Choice
                    ariaLabel={t('billing.fields.part')}
                    value={input.part}
                    disabled={busy}
                    onChange={(v) => update('part', v as BillInput['part'])}
                    options={(cfg.contract.cycle === 'month'
                      ? ['month']
                      : ['first', 'second']
                    ).map((v) => ({
                      value: v,
                      label: t(`billing.parts.${v}`),
                    }))}
                  />
                </Field>
                {day('dueDate', input.dueDate, (v) => update('dueDate', v))}
                <div className='flex flex-wrap gap-4'>
                  {(['rent', 'property', ...utilities] as const)
                    .filter((f) =>
                      f === 'rent'
                        ? selectedRules?.rentChannel === 'bill'
                        : f === 'property'
                          ? selectedRules?.property.enabled
                          : selectedRules?.utilities[f] !== undefined,
                    )
                    .map((type) =>
                      check(
                        t(`billing.fees.${type}`),
                        input.fees.includes(type),
                        (v) =>
                          update(
                            'fees',
                            v
                              ? [...input.fees, type]
                              : input.fees.filter((f) => f !== type),
                          ),
                      ),
                    )}
                </div>
              </FieldGroup>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('billing.readings')}</CardTitle>
            </CardHeader>
            <CardContent className='flex flex-col gap-4'>
              {input.readings.map((r, i) => (
                <div
                  className='flex flex-col gap-4 rounded-lg border p-4'
                  key={r.uiKey}
                >
                  <p className='font-medium'>
                    {t(`billing.fees.${r.feeType}`)} · {r.meterCode}
                  </p>
                  <div className='grid gap-4 sm:grid-cols-2'>
                    {(['start', 'end'] as const).map((k) =>
                      day(`readings.${i}.${k}`, r[k], (v) =>
                        update(
                          'readings',
                          input.readings.map((old, n) =>
                            n === i ? { ...old, [k]: v } : old,
                          ),
                        ),
                      ),
                    )}
                    {(
                      ['previous', 'current', 'multiplier', 'evidence'] as const
                    ).map((k) =>
                      field(
                        `readings.${i}.${k}`,
                        r[k],
                        (v) =>
                          update(
                            'readings',
                            input.readings.map((old, n) =>
                              n === i ? { ...old, [k]: v } : old,
                            ),
                          ),
                        true,
                        k !== 'evidence',
                      ),
                    )}
                  </div>
                  <Button
                    type='button'
                    variant='outline'
                    disabled={busy}
                    onClick={() =>
                      update(
                        'readings',
                        input.readings.filter((_, n) => i !== n),
                      )
                    }
                  >
                    {t('billing.remove')}
                  </Button>
                </div>
              ))}
              {(selectedRules?.meters ?? [])
                .filter((m) => input.fees.includes(m.feeType))
                .map((m) => (
                  <Button
                    key={`${m.assetId}:${m.feeType}:${m.meterCode}`}
                    type='button'
                    variant='outline'
                    disabled={busy || input.readings.length >= 50}
                    onClick={() =>
                      update('readings', [
                        ...input.readings,
                        {
                          uiKey: crypto.randomUUID(),
                          assetId: m.assetId,
                          meterCode: m.meterCode,
                          feeType: m.feeType,
                          start:
                            input.month === cfg.contract.start.slice(0, 7)
                              ? cfg.contract.start
                              : `${input.month}-${input.part === 'second' ? '16' : '01'}`,
                          end:
                            input.month === cfg.contract.end.slice(0, 7)
                              ? cfg.contract.end
                              : new Date(
                                  Date.UTC(
                                    Number(input.month.slice(0, 4)),
                                    Number(input.month.slice(5, 7)),
                                    0,
                                  ),
                                )
                                  .toISOString()
                                  .slice(0, 10),
                          previous: m.openingReading,
                          current: m.openingReading,
                          multiplier: '1',
                          evidence: '',
                          notes: '',
                        },
                      ])
                    }
                  >
                    {t('billing.add')} · {t(`billing.fees.${m.feeType}`)} ·{' '}
                    {m.meterCode}
                  </Button>
                ))}
              {check(t('billing.acknowledge'), input.acknowledgeGaps, (v) =>
                update('acknowledgeGaps', v),
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('billing.otherCharges')}</CardTitle>
            </CardHeader>
            <CardContent className='flex flex-col gap-4'>
              {input.others.map((r, i) => (
                <div
                  key={r.uiKey}
                  className='flex flex-col gap-4 rounded-lg border p-4'
                >
                  <div className='grid gap-4 sm:grid-cols-2'>
                    {(
                      [
                        'title',
                        'amount',
                        'reference',
                        'reason',
                        'evidence',
                      ] as const
                    ).map((key) =>
                      field(
                        `others.${i}.${key}`,
                        r[key],
                        (v) =>
                          update(
                            'others',
                            input.others.map((o, n) =>
                              n === i ? { ...o, [key]: v } : o,
                            ),
                          ),
                        true,
                        key === 'amount',
                      ),
                    )}
                  </div>
                  <Button
                    type='button'
                    variant='outline'
                    onClick={() =>
                      update(
                        'others',
                        input.others.filter((_, n) => n !== i),
                      )
                    }
                    disabled={busy}
                  >
                    {t('billing.remove')}
                  </Button>
                </div>
              ))}
              <Button
                type='button'
                variant='outline'
                disabled={busy || input.others.length >= 30}
                onClick={() =>
                  update('others', [
                    ...input.others,
                    {
                      uiKey: crypto.randomUUID(),
                      title: '',
                      amount: '',
                      reference: '',
                      reason: '',
                      evidence: '',
                    },
                  ])
                }
              >
                {t('billing.add')} · {t('billing.fees.other')}
              </Button>
            </CardContent>
          </Card>
          <FieldGroup>
            {field(
              'zeroReason',
              input.zeroReason,
              (v) => update('zeroReason', v),
              false,
              false,
              t('billing.zeroReason'),
            )}
            {field(
              'zeroEvidence',
              input.zeroEvidence,
              (v) => update('zeroEvidence', v),
              false,
              false,
              t('billing.zeroEvidence'),
            )}
          </FieldGroup>
          {preview ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  {t('billing.preview')} · <Money value={preview.total} />
                </CardTitle>
              </CardHeader>
              <CardContent className='flex flex-col gap-4'>
                <Calculation lines={preview.lines} />
                {preview.warnings.map((w) => (
                  <Alert key={w}>
                    <AlertDescription>{t('billing.gap')}</AlertDescription>
                  </Alert>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
      {field('notes', configMode ? config.notes : input.notes, (v) =>
        configMode ? setConfig({ ...config, notes: v }) : update('notes', v),
      )}
      <div className='flex justify-end gap-2'>
        <Button
          type='button'
          variant='outline'
          disabled={busy}
          onClick={() => (dirty ? setDiscard(true) : close())}
        >
          {t('billing.cancel')}
        </Button>
        {!configMode && preview ? (
          <Button
            variant='outline'
            type='button'
            disabled={busy}
            onClick={() => void execute(true)}
          >
            {t('billing.preview')}
          </Button>
        ) : null}
        <Button type='submit' disabled={busy || cfg.lease.status === 'closed'}>
          {busy ? <Spinner /> : null}
          {t(
            configMode || (bill && preview)
              ? 'billing.save'
              : preview
                ? 'billing.create'
                : 'billing.preview',
          )}
        </Button>
      </div>
    </form>
  );
  return (
    <>
      {form}
      <DiscardDialog
        open={discard}
        onOpenChange={setDiscard}
        onConfirm={close}
      />
    </>
  );
}
