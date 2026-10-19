import { useScopedQuery as useQuery } from '#hooks/use-scoped-query';
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
import { Spinner } from '#components/ui/spinner';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { assetDrafts } from './drafts.js';
import { useAssetPermission, useAssetTree } from './hooks.js';
import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router';
import { useApiClient, ApiClientError, useToaster } from '@nocobase/app-client';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { Field, FieldLabel } from '#components/ui/field';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { DiscardDialog } from '../hyl/discard-dialog.js';
import { useForm, Controller, useWatch } from 'react-hook-form';
import { Choice, LoadingRows } from '../hyl/common.js';
import { AssetError } from './shared.js';
import {
  defaults,
  fields,
  types,
  parentTypes,
  type Asset,
  type AssetValues,
} from './model.js';
export default function AssetForm() {
  const { id } = useParams(),
    api = useApiClient(),
    toaster = useToaster(),
    client = useQueryClient(),
    { t } = useTranslation(),
    navigate = useNavigate(),
    location = useLocation(),
    permission = useAssetPermission('write');
  const tree = useAssetTree(permission.can),
    latest = useQuery({
      queryKey: ['hyl', 'asset', id],
      enabled: !!id,
      queryFn: () => api.request<{ data: Asset }>({ path: `assets/${id}` }),
      retry: false,
      refetchOnMount: 'always',
    });
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [discard, setDiscard] = useState(false);
  const { session } = useAuthentication();
  const draftKey = `${session?.user.id}/${id ?? 'new'}`;
  const [restored] = useState(() => assetDrafts.get(draftKey));
  const errorFocusRef = useRef<(typeof fields)[number] | undefined>(undefined);
  const versionRef = useRef<number | undefined>(restored?.version);
  const [inactiveValues, setInactiveValues] = useState<
    (AssetValues & { reason: string }) | undefined
  >();
  const form = useForm<AssetValues & { reason: string }>({
    defaultValues: restored?.values ?? { ...defaults, reason: '' },
    reValidateMode: 'onChange',
  });
  const dirty = form.formState.isDirty || !!restored;
  useEffect(() => {
    if (!busy && errorFocusRef.current) {
      form.setFocus(errorFocusRef.current);
      errorFocusRef.current = undefined;
    }
  }, [busy, form]);
  const type = useWatch({ control: form.control, name: 'type' }),
    parentId = useWatch({ control: form.control, name: 'parentId' });
  useEffect(() => {
    if (
      latest.data &&
      latest.isFetchedAfterMount &&
      !latest.isFetching &&
      versionRef.current === undefined
    ) {
      form.reset({
        ...(Object.fromEntries(
          fields.map((k) => [k, latest.data.data[k]]),
        ) as AssetValues),
        reason: '',
      });
      versionRef.current = latest.data.data.version;
    }
  }, [latest.data, latest.isFetchedAfterMount, latest.isFetching, form]);
  useEffect(() => {
    const block = (e: BeforeUnloadEvent) => {
      if (dirty || busy) e.preventDefault();
    };
    window.addEventListener('beforeunload', block);
    return () => window.removeEventListener('beforeunload', block);
  }, [dirty, busy]);
  const draftValues = useWatch({ control: form.control });
  useEffect(() => {
    if (form.formState.isDirty)
      assetDrafts.set(draftKey, {
        values: draftValues as AssetValues & { reason: string },
        version: versionRef.current,
      });
  }, [draftValues, form.formState.isDirty, draftKey]);
  const close = () =>
    void navigate(
      { pathname: '..', search: location.search },
      { replace: true },
    );
  const save = async (values: AssetValues & { reason: string }) => {
    setBusy(true);
    setError(undefined);
    try {
      const { reason, ...body } = values;
      const result = await api.request<{ data: Asset }>({
        path: id ? `assets/${id}` : 'assets',
        method: id ? 'PATCH' : 'POST',
        json: id
          ? { values: body, expectedVersion: versionRef.current, reason }
          : body,
      });
      await client.invalidateQueries({ queryKey: ['hyl'] });
      toaster.show({
        title: t('assets.saved', { name: result.data.name }),
        type: 'success',
      });
      assetDrafts.delete(draftKey);
      form.reset(values);
      void navigate(
        {
          pathname: id ? '..' : `../${result.data.id}`,
          search: location.search,
        },
        { replace: true },
      );
    } catch (e) {
      setError(e);
      if (e instanceof ApiClientError) {
        if (e.reason === 'ASSET_AREA') {
          errorFocusRef.current = 'lettableArea';
          form.setError(
            'lettableArea',
            { message: t('assets.errors.ASSET_AREA') },
            { shouldFocus: false },
          );
        }
        const payload = e.payload as
          { error?: { fieldViolations?: { field: string }[] } } | undefined;
        for (const issue of payload?.error?.fieldViolations ?? []) {
          const key = issue.field.replace(
            /^values\./,
            '',
          ) as (typeof fields)[number];
          if (fields.includes(key)) {
            errorFocusRef.current ??= key;
            form.setError(
              key,
              { message: t('hyl.errors.invalidField') },
              { shouldFocus: false },
            );
          }
        }
      }
    } finally {
      setBusy(false);
    }
  };
  const groups = [
    ['general', ['name', 'type', 'parentId', 'state']],
    ['position', ['area', 'lettableArea', 'address', 'floor', 'location']],
    [
      'ownership',
      ['ownershipType', 'ownerName', 'ownershipNumber', 'manager', 'notes'],
    ],
  ] as const;
  return (
    <RouteChildPage>
      <PageContainer>
        <Button
          className='w-fit'
          variant='ghost'
          disabled={busy}
          onClick={() => (dirty ? setDiscard(true) : close())}
        >
          {t('hyl.actions.back')}
        </Button>
        <PageHeader
          title={t(id ? 'assets.edit' : 'assets.create')}
          description={t('assets.generated')}
        />
        {id &&
        (latest.isPending || (!restored && !latest.isFetchedAfterMount)) ? (
          <LoadingRows />
        ) : latest.error ? (
          <AssetError
            error={latest.error}
            retry={() => void latest.refetch()}
          />
        ) : !permission.can ? (
          <p>{t('hyl.profile.readOnlyHelp')}</p>
        ) : (
          <form
            className='flex max-w-4xl flex-col gap-6'
            onSubmit={(e) =>
              void form.handleSubmit((values) => {
                if (
                  id &&
                  values.state === 'inactive' &&
                  latest.data?.data.state !== 'inactive'
                )
                  setInactiveValues(values);
                else void save(values);
              })(e)
            }
          >
            {error ? <AssetError error={error} /> : null}
            {error instanceof ApiClientError &&
            error.reason === 'VERSION_CONFLICT' ? (
              <Button
                type='button'
                variant='outline'
                onClick={() => {
                  void latest.refetch().then((fresh) => {
                    if (fresh.data) {
                      versionRef.current = fresh.data.data.version;
                      setError(undefined);
                    }
                  });
                }}
              >
                {t('assets.reloadVersion')}
              </Button>
            ) : null}
            {groups.map(([title, keys]) => (
              <Card key={title}>
                <CardHeader>
                  <CardTitle>{t(`assets.${title}`)}</CardTitle>
                </CardHeader>
                <CardContent className='grid gap-5 sm:grid-cols-2'>
                  {keys
                    .filter((k) => k !== 'parentId' || type !== 'project')
                    .map((key) => (
                      <Controller
                        key={key}
                        name={key}
                        control={form.control}
                        rules={{
                          required: [
                            'name',
                            'type',
                            'state',
                            'parentId',
                            'area',
                            'lettableArea',
                          ].includes(key)
                            ? t('hyl.errors.required')
                            : false,
                          validate: (v) =>
                            key === 'name' && !String(v).trim()
                              ? t('hyl.errors.required')
                              : ['area', 'lettableArea'].includes(key) &&
                                  !/^\d{1,10}(\.\d{1,2})?$/.test(String(v))
                                ? t('hyl.errors.invalidField')
                                : ['area', 'lettableArea'].includes(key) &&
                                    Number(form.getValues('lettableArea')) >
                                      Number(form.getValues('area'))
                                  ? t('assets.errors.ASSET_AREA')
                                  : true,
                        }}
                        render={({ field, fieldState }) => (
                          <Field data-invalid={fieldState.invalid}>
                            <FieldLabel htmlFor={`asset-${key}`}>
                              {t(`assets.fields.${key}`)}
                              {[
                                'name',
                                'type',
                                'state',
                                'parentId',
                                'area',
                                'lettableArea',
                              ].includes(key)
                                ? ' *'
                                : ''}
                            </FieldLabel>
                            {['type', 'state', 'parentId'].includes(key) ? (
                              <div
                                ref={(element) =>
                                  field.ref({
                                    focus: () =>
                                      element?.querySelector('button')?.focus(),
                                  })
                                }
                                onBlur={field.onBlur}
                              >
                                <Choice
                                  id={`asset-${key}`}
                                  disabled={busy || (key === 'type' && !!id)}
                                  value={String(field.value || '')}
                                  onChange={(v) => {
                                    field.onChange(v);
                                    if (key === 'type')
                                      form.setValue('parentId', null, {
                                        shouldDirty: true,
                                      });
                                  }}
                                  options={
                                    key === 'type'
                                      ? types.map((value) => ({
                                          value,
                                          label: t(`assets.types.${value}`),
                                        }))
                                      : key === 'state'
                                        ? [
                                            'normal',
                                            'maintenance',
                                            'inactive',
                                          ].map((value) => ({
                                            value,
                                            label: t(`assets.states.${value}`),
                                          }))
                                        : tree.rows
                                            .filter(
                                              (a) =>
                                                a.id !== id &&
                                                (parentTypes[type].includes(
                                                  a.type,
                                                ) ||
                                                  a.id === parentId),
                                            )
                                            .map((a) => ({
                                              value: a.id,
                                              label: `${a.name} · ${a.number}`,
                                            }))
                                  }
                                />
                              </div>
                            ) : key === 'notes' ? (
                              <Textarea
                                {...field}
                                value={String(field.value ?? '')}
                                id={`asset-${key}`}
                                disabled={busy}
                                maxLength={2000}
                              />
                            ) : (
                              <Input
                                {...field}
                                value={String(field.value ?? '')}
                                id={`asset-${key}`}
                                disabled={busy}
                                maxLength={
                                  key === 'address' || key === 'location'
                                    ? 300
                                    : 100
                                }
                                inputMode={
                                  ['area', 'lettableArea'].includes(key)
                                    ? 'decimal'
                                    : undefined
                                }
                              />
                            )}{' '}
                            {fieldState.error ? (
                              <p className='text-sm text-destructive'>
                                {fieldState.error.message}
                              </p>
                            ) : null}
                          </Field>
                        )}
                      />
                    ))}
                </CardContent>
              </Card>
            ))}
            {tree.error ? (
              <AssetError
                error={tree.error}
                retry={() => void tree.refetch()}
              />
            ) : null}
            {tree.hasNextPage ? (
              <Button
                type='button'
                variant='outline'
                onClick={() => void tree.fetchNextPage()}
                disabled={tree.isFetchingNextPage}
              >
                {t('assets.more')}
              </Button>
            ) : null}
            {id ? (
              <Field>
                <FieldLabel htmlFor='asset-reason'>
                  {t('assets.fields.reason')} *
                </FieldLabel>
                <Textarea
                  id='asset-reason'
                  {...form.register('reason', {
                    required: t('hyl.errors.required'),
                    validate: (value) =>
                      value.trim() ? true : t('hyl.errors.required'),
                  })}
                  disabled={busy}
                  required
                  maxLength={1000}
                />
                <p className='text-sm text-muted-foreground'>
                  {form.formState.errors.reason ? (
                    <span className='text-destructive'>
                      {form.formState.errors.reason.message}
                    </span>
                  ) : (
                    t('assets.reasonHelp')
                  )}
                </p>
              </Field>
            ) : null}
            <div className='flex justify-end gap-2'>
              <Button
                type='button'
                variant='outline'
                disabled={busy}
                onClick={() => (dirty ? setDiscard(true) : close())}
              >
                {t('hyl.actions.back')}
              </Button>
              <Button
                type='submit'
                disabled={busy || !permission.can || !!tree.error}
              >
                {busy ? <Spinner /> : null}
                {t('hyl.actions.save')}
              </Button>
            </div>
          </form>
        )}
        <AlertDialog
          open={!!inactiveValues}
          onOpenChange={(open) => {
            if (!open) setInactiveValues(undefined);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('assets.inactiveConfirm', {
                  name: inactiveValues?.name ?? '',
                })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t('assets.inactiveHelp')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('hyl.actions.back')}</AlertDialogCancel>
              <AlertDialogAction
                variant='destructive'
                onClick={() => {
                  if (inactiveValues) {
                    void save(inactiveValues);
                    setInactiveValues(undefined);
                  }
                }}
              >
                {t('assets.states.inactive')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <DiscardDialog
          open={discard}
          onOpenChange={setDiscard}
          onConfirm={() => {
            assetDrafts.delete(draftKey);
            close();
          }}
        />
      </PageContainer>
    </RouteChildPage>
  );
}
