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
import {
  ErrorPanel,
  LoadingRows,
  Choice,
  DateField,
  RecordPicker,
} from './common.js';

export default function BusinessForm() {
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
  const [discard, setDiscard] = useState(false);
  const baseVersionRef = useRef<number | undefined>(undefined);
  const [error, setError] = useState<unknown>();
  const latest = useBusinessQuery<{ data: BusinessRow }>(
    `${kind}/${id}`,
    undefined,
    !!id,
  );
  const fields = specs[kind];
  const schema = useMemo(
    () =>
      z
        .record(z.string(), z.union([z.string(), z.boolean()]))
        .superRefine((values, ctx) => {
          for (const field of fields) {
            const value = values[field.key];
            if (field.type === 'boolean') continue;
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
  useEffect(() => {
    if (latest.data && !initializedRef.current) {
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
  }, [latest.data, fields, form, restored]);
  useEffect(() => {
    if (!form.formState.isDirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [form.formState.isDirty]);
  const preview = useWatch({ control: form.control });
  const dirty = form.formState.isDirty;
  useEffect(() => {
    if (dirty)
      drafts.set(draftKey, {
        values: preview as Values,
        version: baseVersionRef.current,
      });
  }, [dirty, preview, draftKey]);
  const merchantId = useWatch({ control: form.control, name: 'merchantId' });
  const pending = form.formState.isSubmitting;
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
    try {
      const response = await api.request<{ data: BusinessRow }>({
        path: id ? `${kind}/${id}` : kind,
        method: id ? 'PATCH' : 'POST',
        json: id ? { values, expectedVersion: baseVersionRef.current } : values,
      });
      client.setQueryData(['hyl', `${kind}/${response.data.id}`, undefined], {
        data: response.data,
      });
      await client.invalidateQueries({ queryKey: ['hyl'] });
      toaster.show({
        title: t(id ? 'hyl.copy.saved' : 'hyl.copy.created', {
          name: response.data.number,
        }),
        type: 'success',
      });
      drafts.delete(draftKey);
      form.reset(values);
      close();
    } catch (cause) {
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
          if (form.formState.isDirty || restored) setDiscard(true);
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
    id && latest.isPending ? (
      <LoadingRows />
    ) : id && latest.error ? (
      <ErrorPanel error={latest.error} retry={() => void latest.refetch()} />
    ) : (
      <form
        id='hyl-record-form'
        noValidate
        onSubmit={(e) => {
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
        <FieldGroup className='grid gap-6 sm:grid-cols-2'>
          {fields.map((spec) => (
            <Fragment key={spec.key}>
              {kind === 'contracts' &&
              ['number', 'method', 'includeActivity'].includes(spec.key) ? (
                <h2 className='text-base font-semibold sm:col-span-2'>
                  {t(`hyl.copy.group${spec.key}`)}
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
                        disabled={pending}
                        value={scalar(field.value)}
                        onChange={(v) => field.onChange(v === 'true')}
                        options={[
                          { value: 'true', label: t('hyl.copy.yes') },
                          { value: 'false', label: t('hyl.copy.no') },
                        ]}
                      />
                    ) : spec.type === 'select' ? (
                      <Choice
                        id={inputId}
                        disabled={pending}
                        value={scalar(field.value ?? '')}
                        onChange={field.onChange}
                        options={(spec.options ?? []).map((v) => ({
                          value: v,
                          label: t(`hyl.enums.${v}`),
                        }))}
                      />
                    ) : spec.type === 'date' || spec.type === 'month' ? (
                      <DateField
                        id={inputId}
                        disabled={pending}
                        month={spec.type === 'month'}
                        value={scalar(field.value ?? '')}
                        onChange={field.onChange}
                      />
                    ) : spec.type === 'merchant' || spec.type === 'contract' ? (
                      <RecordPicker
                        id={inputId}
                        disabled={
                          pending || (!!id && spec.key === 'merchantId')
                        }
                        kind={
                          spec.type === 'merchant' ? 'merchants' : 'contracts'
                        }
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
                        disabled={pending}
                      />
                    ) : (
                      <Input
                        id={inputId}
                        {...field}
                        value={scalar(field.value ?? '')}
                        aria-invalid={fieldState.invalid}
                        aria-required={!spec.optional}
                        disabled={pending}
                        inputMode={
                          spec.type === 'money' ? 'decimal' : undefined
                        }
                      />
                    );
                  return (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={inputId}>
                        {t(`hyl.fields.${spec.key}`)}
                        {!spec.optional && spec.type !== 'boolean' ? (
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
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  );
                }}
              />
            </Fragment>
          ))}
        </FieldGroup>
      </form>
    );

  return (
    <>
      {kind === 'settlements' ? (
        <RouteDialog
          title={title}
          beforeClose={() => {
            if (pending) return false;
            if (form.formState.isDirty || restored) {
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
              disabled={pending}
              onClick={() => {
                if (form.formState.isDirty || restored) setDiscard(true);
                else close();
              }}
            >
              {t('hyl.actions.back')}
            </Button>
            <PageHeader title={title} />
            <div className='flex max-w-4xl flex-col gap-6'>
              {content}
              <div className='flex justify-end gap-2'>{footer}</div>
            </div>
          </PageContainer>
        </RouteChildPage>
      )}
      <DiscardDialog
        open={discard}
        onOpenChange={setDiscard}
        onConfirm={() => {
          drafts.delete(draftKey);
          close();
        }}
      />
    </>
  );
}
