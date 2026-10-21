import { useCoverFocus } from '../profit-sharing/focus.js';
import { useNavigationGuard } from '@nocobase/app-client';
import { useBusinessIdentity } from './hooks.js';
import { AssetError as ErrorPanel } from '../assets/shared.js';
import { ContractAssetsSelector } from '../assets/bindings.js';
import { AssociationPicker } from './association-picker.js';
import { MerchantPicker } from './merchant-picker.js';
import { useCreateLicense } from './merchant-profile/create-license.js';
import { DiscardDialog } from './discard-dialog.js';
import { drafts } from './drafts.js';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { scalar } from './model.js';
import { useBusinessQuery } from './hooks.js';
import { useEffect, useMemo, useState, useRef, Fragment } from 'react';
import { useForm, Controller, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  useNavigate,
  useLocation,
  useOutletContext,
  useParams,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient, ApiClientError } from '@nocobase/app-client';
import { useQueryClient } from '@tanstack/react-query';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { RouteDialog } from '#components/route-dialog';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from '#components/ui/field';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Spinner } from '#components/ui/spinner';
import { useToaster } from '@nocobase/app-client';
import {
  specs,
  defaults,
  type Kind,
  type BusinessRow,
  type Values,
} from './model.js';
import { LoadingRows, Choice, DateField, RecordPicker } from './common.js';

export default function BusinessForm() {
  useCoverFocus();
  const businessIdentity = useBusinessIdentity();
  const toaster = useToaster();
  const { kind } = useOutletContext<{ kind: Kind }>(),
    { id } = useParams();
  const api = useApiClient(),
    client = useQueryClient();
  const { t } = useTranslation(),
    navigate = useNavigate(),
    location = useLocation();
  const { session } = useAuthentication();
  const draftKey = `${session?.user.id}/${kind}/${id ?? 'new'}`;
  const [restored] = useState(() => drafts.get(draftKey));
  const initializedRef = useRef(false);
  const [assetSelection, setAssetSelection] = useState<
    { merchantId: string; ids: string[] } | undefined
  >(restored?.assetSelection);
  const assetsDirty = !!assetSelection;
  const [discard, setDiscard] = useState(false);
  const baseVersionRef = useRef<number | undefined>(undefined);
  const [error, setError] = useState<unknown>();
  const latest = useBusinessQuery<{ data: BusinessRow }>(
    `${kind}/${id}`,
    undefined,
    !!id,
  );
  const fields = useMemo(
    () =>
      specs[kind].filter(
        (spec) =>
          (kind !== 'merchants' || spec.key !== 'code') &&
          (kind !== 'contracts' || spec.key !== 'number'),
      ),
    [kind],
  );
  const schema = useMemo(
    () =>
      z
        .record(z.string(), z.union([z.string(), z.boolean()]))
        .superRefine((values, ctx) => {
          for (const field of fields) {
            const value = values[field.key];
            if (
              field.type === 'boolean' ||
              (kind === 'merchants' &&
                field.key === 'bindingStart' &&
                !values.assetId)
            )
              continue;
            if (!field.optional && !scalar(value ?? '').trim())
              ctx.addIssue({
                code: 'custom',
                path: [field.key],
                message: t('hyl.errors.required'),
              });
            else if (
              field.type === 'money' &&
              !/^\d{1,12}(\.\d{1,2})?$/.test(scalar(value))
            )
              ctx.addIssue({
                code: 'custom',
                path: [field.key],
                message: t('hyl.errors.money'),
              });
          }
          if (kind === 'merchants') {
            if (
              values.category === 'other' &&
              !scalar(values.categoryName).trim()
            )
              ctx.addIssue({
                code: 'custom',
                path: ['categoryName'],
                message: t('hyl.errors.required'),
              });
            if (
              values.category === 'other' &&
              scalar(values.categoryName).length > 50
            )
              ctx.addIssue({
                code: 'custom',
                path: ['categoryName'],
                message: t('hyl.errors.invalidField'),
              });
            if (
              values.creditCode &&
              !/^[0-9A-Z]{18}$/.test(scalar(values.creditCode))
            )
              ctx.addIssue({
                code: 'custom',
                path: ['creditCode'],
                message: t('hyl.profile.creditCodeHelp'),
              });
            for (const [key, max] of [
              ['legalRepresentative', 100],
              ['businessHours', 500],
            ] as const)
              if (scalar(values[key]).length > max)
                ctx.addIssue({
                  code: 'custom',
                  path: [key],
                  message: t('hyl.errors.invalidField'),
                });
          }
          if (kind === 'contracts') {
            if (scalar(values.end) < scalar(values.start))
              ctx.addIssue({
                code: 'custom',
                path: ['end'],
                message: t('hyl.errors.INVALID_PERIOD'),
              });
            if (Number(values.rate) > 100)
              ctx.addIssue({
                code: 'custom',
                path: ['rate'],
                message: t('hyl.errors.rate'),
              });
          }
          if (kind === 'revenueReports') {
            if (Number(values.refunds) > Number(values.receipts))
              ctx.addIssue({
                code: 'custom',
                path: ['refunds'],
                message: t('hyl.errors.refunds'),
              });
            if (
              Number(values.collected) >
              Number(values.receipts) - Number(values.refunds)
            )
              ctx.addIssue({
                code: 'custom',
                path: ['collected'],
                message: t('hyl.errors.collected'),
              });
          }
          if (kind === 'expenses' && Number(values.amount) <= 0)
            ctx.addIssue({
              code: 'custom',
              path: ['amount'],
              message: t('hyl.errors.positive'),
            });
        }),
    [fields, t, kind],
  );
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: restored?.values ?? defaults(kind),
  });
  const license = useCreateLicense(
    kind === 'merchants' && !id,
    draftKey,
    setError,
    form.formState.isSubmitting,
  );
  useEffect(() => {
    if (
      latest.data &&
      latest.isFetchedAfterMount &&
      !latest.isFetching &&
      !initializedRef.current
    ) {
      initializedRef.current = true;
      baseVersionRef.current = restored?.version ?? latest.data.data.version;
      const values: Values = {};
      for (const spec of fields) {
        const value = latest.data.data.payload[spec.key];
        values[spec.key] =
          typeof value === 'boolean' ? value : scalar(value ?? '');
      }
      form.reset(restored?.values ?? values);
    }
  }, [
    latest.data,
    latest.isFetchedAfterMount,
    latest.isFetching,
    fields,
    form,
    restored,
    kind,
  ]);
  useEffect(() => {
    if (latest.error instanceof ApiClientError && latest.error.status === 404)
      void client.invalidateQueries({ queryKey: ['hyl', kind] });
  }, [latest.error, client, kind]);
  useEffect(() => {
    if (
      !form.formState.isDirty &&
      !license.dirty &&
      !license.busy &&
      !form.formState.isSubmitting
    )
      return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [
    form.formState.isDirty,
    form.formState.isSubmitting,
    license.dirty,
    license.busy,
  ]);
  const preview = useWatch({ control: form.control });
  const dirty = form.formState.isDirty || assetsDirty;
  useEffect(() => {
    if (dirty)
      drafts.set(draftKey, {
        values: preview as Values,
        version: baseVersionRef.current,
        assetSelection,
      });
  }, [dirty, preview, draftKey, assetSelection]);
  const merchantAssetId = useWatch({ control: form.control, name: 'assetId' });
  const merchantId = useWatch({ control: form.control, name: 'merchantId' });
  const assetIds = assetSelection
    ? assetSelection.merchantId === scalar(merchantId)
      ? assetSelection.ids
      : []
    : id
      ? ((latest.data?.data.payload.assetIds as string[] | undefined) ?? [])
      : [];
  const pending = form.formState.isSubmitting || license.busy;
  const completedRef = useRef(false);
  // A successful save must pass the guard before React clears submitting state.
  useNavigationGuard(() => completedRef.current || !pending);
  const close = () => {
    void navigate(
      { pathname: '..', search: location.search },
      { replace: true },
    );
  };
  const title = id
    ? t('hyl.copy.actionTitle', {
        action: t('hyl.actions.edit'),
        name: latest.data?.data.number ?? t(`hyl.nav.${kind}`),
      })
    : kind === 'settlements'
      ? t('hyl.actions.generate')
      : t('hyl.actions.create', { resource: t(`hyl.nav.${kind}`) });
  const save = async (values: Values) => {
    setError(undefined);
    // Old in-memory drafts can still carry a manually entered merchant code.
    if (kind === 'merchants') {
      values = { ...values };
      delete values.code;
      if (values.category !== 'other') values.categoryName = '';
      if (!id) {
        values.creationId = license.creationId;
        if (license.fileId) values.licenseFileId = license.fileId;
      }
    }
    if (kind === 'contracts') {
      values = { ...values };
      delete values.number;
    }
    if (kind === 'merchants' && !id) {
      values = license.submission ?? values;
      license.freeze(values);
    }
    try {
      const response = await api.request<{ data: BusinessRow }>({
        path: id ? `${kind}/${id}` : kind,
        method: id ? 'PATCH' : 'POST',
        json: id
          ? {
              values: {
                ...values,
                ...(kind === 'contracts' ? { assetIds } : {}),
              },
              expectedVersion: baseVersionRef.current,
            }
          : { ...values, ...(kind === 'contracts' ? { assetIds } : {}) },
      });
      client.setQueryData(
        ['hyl', `${kind}/${response.data.id}`, undefined, ...businessIdentity],
        {
          data: response.data,
        },
      );
      await client
        .invalidateQueries({ queryKey: ['hyl'] })
        .catch(() => undefined);
      toaster.show({
        title: t(id ? 'hyl.copy.saved' : 'hyl.copy.created', {
          name: response.data.number,
        }),
        type: 'success',
      });
      if (kind === 'merchants' && !id && license.dirty) {
        await license.cleanupUnused(license.fileId).catch(() => {
          toaster.show({
            title: t('hyl.profile.cleanupFailed'),
            type: 'error',
          });
        });
      }
      license.clear();
      drafts.delete(draftKey);
      form.reset(values);
      completedRef.current = true;
      close();
    } catch (cause) {
      if (kind === 'merchants' && !id)
        license.failed(
          !(cause instanceof ApiClientError) || cause.status >= 500,
        );
      setError(cause);
      if (cause instanceof ApiClientError) {
        const payload = cause.payload as
          { error?: { fieldViolations?: { field: string }[] } } | undefined;
        for (const violation of payload?.error?.fieldViolations ?? []) {
          const key = violation.field.replace(/^values\./, '');
          if (fields.some((f) => f.key === key))
            form.setError(
              key,
              { message: t('hyl.errors.invalidField') },
              { shouldFocus: true },
            );
        }
      }
    }
  };
  const footer = (
    <>
      <Button
        variant='outline'
        disabled={pending}
        onClick={() => {
          if (form.formState.isDirty || restored || license.dirty)
            setDiscard(true);
          else close();
        }}
      >
        {t('hyl.actions.back')}
      </Button>
      <Button disabled={pending} type='submit' form='hyl-record-form'>
        {pending ? <Spinner /> : null}
        {pending
          ? t('hyl.copy.saving')
          : id
            ? t('hyl.actions.save')
            : kind === 'settlements'
              ? t('hyl.actions.generate')
              : t('hyl.actions.new')}
      </Button>
    </>
  );
  const content =
    id &&
    (latest.isPending || (!latest.isFetchedAfterMount && !latest.error)) ? (
      <LoadingRows />
    ) : id && latest.error ? (
      <ErrorPanel error={latest.error} retry={() => void latest.refetch()} />
    ) : (
      <form
        id='hyl-record-form'
        noValidate
        onSubmit={(e) => {
          if (pending) {
            e.preventDefault();
            return;
          }
          void form.handleSubmit(save)(e);
        }}
        className='flex flex-col gap-6'
      >
        {error ? (
          <>
            <ErrorPanel error={error} />
            {id ? (
              <Button
                type='button'
                variant='outline'
                onClick={() => {
                  void latest.refetch().then((fresh) => {
                    if (fresh.data)
                      baseVersionRef.current = fresh.data.data.version;
                  });
                }}
              >
                {t('hyl.actions.reloadDraft')}
              </Button>
            ) : null}
          </>
        ) : null}
        <p className='text-sm text-muted-foreground'>
          {t('hyl.copy.draftHelp')}
        </p>
        {kind === 'merchants' && !id ? (
          <p className='text-sm text-muted-foreground'>
            {t('hyl.profile.generatedCodeHelp')}
          </p>
        ) : null}
        {kind === 'contracts' && !id ? (
          <p className='text-sm text-muted-foreground'>
            {t('hyl.copy.generatedContractNumberHelp')}
          </p>
        ) : null}
        {kind === 'contracts' || kind === 'settlements' ? (
          <Alert>
            <AlertDescription>
              <p>{t('hyl.copy.trial')}</p>
              <p>{t('hyl.copy.formula')}</p>
              {kind === 'settlements' &&
              /^\d{4}-\d{2}$/.test(scalar(preview.month)) ? (
                <p>
                  {t('hyl.fields.date')}：{scalar(preview.month)}-
                  {preview.part === 'second' ? '16' : '01'} —{' '}
                  {scalar(preview.month)}-
                  {preview.part === 'first'
                    ? '15'
                    : new Date(
                        Number(scalar(preview.month).slice(0, 4)),
                        Number(scalar(preview.month).slice(5)),
                        0,
                      ).getDate()}
                </p>
              ) : null}
              {kind === 'contracts' ? (
                <p>
                  {t('hyl.fields.method')}：
                  {t(`hyl.enums.${scalar(preview.method)}`)} ·{' '}
                  {t('hyl.fields.basis')}：
                  {t(`hyl.enums.${scalar(preview.basis)}`)} ·{' '}
                  {t('hyl.fields.rate')}：{scalar(preview.rate)}%
                </p>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
        {kind === 'revenueReports' ? (
          <p className='text-sm text-muted-foreground'>
            {t('mobile.reportHelp')}
          </p>
        ) : null}
        <FieldGroup className='grid min-w-0 gap-6 md:grid-cols-2'>
          {fields
            .filter(
              (spec) =>
                kind !== 'merchants' ||
                (spec.key !== 'assetId' &&
                  (!['bindingStart', 'bindingEnd'].includes(spec.key) ||
                    !!merchantAssetId) &&
                  (spec.key !== 'categoryName' ||
                    preview.category === 'other')),
            )
            .map((spec) => (
              <Fragment key={spec.key}>
                {kind === 'revenueReports' &&
                ['merchantId', 'receipts', 'evidence'].includes(spec.key) ? (
                  <h2 className='text-base font-medium md:col-span-2'>
                    {t(
                      'mobile.' +
                        {
                          merchantId: 'reportBasics',
                          receipts: 'reportAmounts',
                          evidence: 'reportEvidence',
                        }[spec.key],
                    )}
                  </h2>
                ) : null}
                {kind === 'contracts' &&
                ['merchantId', 'method', 'includeActivity'].includes(
                  spec.key,
                ) ? (
                  <h2 className='text-base font-semibold md:col-span-2'>
                    {t(
                      `hyl.copy.group${spec.key === 'merchantId' ? 'number' : spec.key}`,
                    )}
                  </h2>
                ) : null}
                <Controller
                  name={spec.key}
                  control={form.control}
                  render={({ field, fieldState }) => {
                    const inputId = `hyl-${kind}-${spec.key}`;
                    const control =
                      spec.type === 'boolean' ? (
                        <Choice
                          id={inputId}
                          disabled={pending || license.uncertain}
                          value={scalar(field.value)}
                          onChange={(v) => field.onChange(v === 'true')}
                          options={[
                            { value: 'true', label: t('hyl.copy.yes') },
                            { value: 'false', label: t('hyl.copy.no') },
                          ]}
                        />
                      ) : kind === 'merchants' &&
                        ['unit', 'userId'].includes(spec.key) ? (
                        <AssociationPicker
                          id={inputId}
                          kind={spec.key === 'unit' ? 'asset' : 'user'}
                          value={
                            spec.key === 'unit'
                              ? scalar(merchantAssetId)
                              : scalar(field.value)
                          }
                          fallback={
                            spec.key === 'unit'
                              ? scalar(field.value)
                              : field.value &&
                                  latest.data?.data.payload.userId ===
                                    scalar(field.value)
                                ? scalar(latest.data?.data.payload.userName) ||
                                  t('hyl.profile.linkedAccount')
                                : ''
                          }
                          invalid={fieldState.invalid}
                          disabled={pending || license.uncertain}
                          onChange={(value, label) => {
                            if (spec.key === 'unit') {
                              form.setValue('assetId', value, {
                                shouldDirty: true,
                              });
                              if (!value) {
                                form.setValue('bindingStart', '', {
                                  shouldDirty: true,
                                });
                                form.setValue('bindingEnd', '', {
                                  shouldDirty: true,
                                });
                              }
                              if (value && !form.getValues('bindingStart'))
                                form.setValue(
                                  'bindingStart',
                                  new Intl.DateTimeFormat('en-CA', {
                                    timeZone: 'Asia/Shanghai',
                                    year: 'numeric',
                                    month: '2-digit',
                                    day: '2-digit',
                                  }).format(new Date()),
                                  { shouldDirty: true },
                                );
                              field.onChange(label.split(' · ')[0]);
                            } else field.onChange(value);
                          }}
                        />
                      ) : spec.type === 'select' ? (
                        <Choice
                          id={inputId}
                          disabled={pending || license.uncertain}
                          value={scalar(field.value ?? '')}
                          onChange={field.onChange}
                          options={[
                            ...(spec.options ?? []).map((v) => ({
                              value: v,
                              label: t(`hyl.enums.${v}`),
                            })),
                            // Preserve an existing free-text category when editing an old merchant.
                            ...(kind === 'merchants' &&
                            spec.key === 'category' &&
                            field.value &&
                            !spec.options?.includes(scalar(field.value))
                              ? [
                                  {
                                    value: scalar(field.value),
                                    label: scalar(field.value),
                                  },
                                ]
                              : []),
                          ]}
                        />
                      ) : spec.type === 'date' || spec.type === 'month' ? (
                        <DateField
                          id={inputId}
                          disabled={pending || license.uncertain}
                          month={spec.type === 'month'}
                          value={scalar(field.value ?? '')}
                          onChange={field.onChange}
                        />
                      ) : spec.type === 'merchant' ? (
                        <MerchantPicker
                          invalid={fieldState.invalid}
                          id={inputId}
                          value={scalar(field.value ?? '')}
                          onChange={(value) => {
                            field.onChange(value);
                            if (kind === 'settlements')
                              form.setValue('contractId', '');
                          }}
                          disabled={pending || license.uncertain || !!id}
                        />
                      ) : spec.type === 'contract' ? (
                        <RecordPicker
                          id={inputId}
                          disabled={
                            pending ||
                            license.uncertain ||
                            (!!id && spec.key === 'merchantId')
                          }
                          kind='contracts'
                          value={scalar(field.value ?? '')}
                          onChange={(v) => {
                            field.onChange(v);
                            if (
                              spec.key === 'merchantId' &&
                              kind === 'settlements'
                            )
                              form.setValue('contractId', '');
                          }}
                          merchantId={
                            spec.type === 'contract'
                              ? scalar(merchantId)
                              : undefined
                          }
                        />
                      ) : spec.type === 'notes' ? (
                        <Textarea
                          id={inputId}
                          {...field}
                          value={scalar(field.value ?? '')}
                          disabled={pending || license.uncertain}
                        />
                      ) : (
                        <Input
                          id={inputId}
                          {...field}
                          value={scalar(field.value ?? '')}
                          aria-invalid={fieldState.invalid}
                          aria-required={
                            !spec.optional ||
                            (kind === 'merchants' &&
                              spec.key === 'categoryName')
                          }
                          disabled={pending || license.uncertain}
                          inputMode={
                            spec.type === 'money' ? 'decimal' : undefined
                          }
                        />
                      );
                    return (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={inputId}>
                          {t(
                            `hyl.fields.${kind === 'merchants' && spec.key === 'category' ? 'merchantCategory' : spec.key}`,
                          )}
                          {(!spec.optional ||
                            (kind === 'merchants' &&
                              spec.key === 'categoryName')) &&
                          spec.type !== 'boolean' ? (
                            <span aria-hidden='true'> *</span>
                          ) : null}
                        </FieldLabel>
                        {control}
                        {spec.type === 'money' ? (
                          <FieldDescription>
                            {t(
                              spec.key === 'rate'
                                ? 'hyl.copy.rateHelp'
                                : 'hyl.copy.amountHelp',
                            )}
                          </FieldDescription>
                        ) : spec.type === 'month' ? (
                          <FieldDescription>
                            {t('hyl.copy.dateHelp')}
                          </FieldDescription>
                        ) : null}
                        {kind === 'merchants' && spec.key === 'userId' ? (
                          <FieldDescription>
                            {t('hyl.profile.accountAssociationHelp')}
                          </FieldDescription>
                        ) : null}
                        <FieldError errors={[fieldState.error]} />
                      </Field>
                    );
                  }}
                />
              </Fragment>
            ))}
        </FieldGroup>
        {license.uncertain ? (
          <p className='text-sm text-muted-foreground'>
            {t('hyl.profile.retryCreationHelp')}
          </p>
        ) : null}
        {kind === 'contracts' ? (
          <ContractAssetsSelector
            merchantId={scalar(merchantId ?? '')}
            value={assetIds}
            onChange={(ids) => {
              setAssetSelection({ merchantId: scalar(merchantId), ids });
            }}
            disabled={pending}
          />
        ) : null}
        {license.element}
      </form>
    );

  return (
    <>
      {kind === 'settlements' ? (
        <RouteDialog
          title={title}
          beforeClose={() => {
            if (pending) return false;
            if (form.formState.isDirty || restored || license.dirty) {
              setDiscard(true);
              return false;
            }
            return true;
          }}
          footer={footer}
        >
          {content}
        </RouteDialog>
      ) : (
        <RouteChildPage>
          <PageContainer>
            <Button
              variant='ghost'
              className='w-fit'
              disabled={pending || license.uncertain}
              onClick={() => {
                if (form.formState.isDirty || restored || license.dirty)
                  setDiscard(true);
                else close();
              }}
            >
              {t('hyl.actions.back')}
            </Button>
            <PageHeader title={title} />
            <div className='flex max-w-4xl flex-col gap-6'>
              {content}
              <div
                data-slot='business-form-footer'
                className='sticky bottom-0 flex flex-wrap justify-end gap-2 border-t bg-background py-4 md:static md:border-0'
              >
                {footer}
              </div>
            </div>
          </PageContainer>
        </RouteChildPage>
      )}
      <DiscardDialog
        open={discard}
        onOpenChange={setDiscard}
        onConfirm={() => {
          setDiscard(false);
          void (async () => {
            try {
              if (kind === 'merchants' && !id) await license.cleanup();
              drafts.delete(draftKey);
              close();
            } catch (cause) {
              setError(cause);
            }
          })();
        }}
      />
    </>
  );
}
