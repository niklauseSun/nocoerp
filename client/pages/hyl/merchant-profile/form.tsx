import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm, Controller, useWatch } from 'react-hook-form';
import {
  useLocation,
  useNavigate,
  useParams,
  useOutletContext,
} from 'react-router';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  useApiClient,
  useService,
  useToaster,
  ApiClientError,
} from '@nocobase/app-client';
import {
  clientFileRepositoryManagerToken,
  type ClientFileRepository,
  type UploadOneResult,
} from '@nocobase/app-plugin-file/client';
import { useQueryClient } from '@tanstack/react-query';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { RouteDialog } from '#components/route-dialog';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import { Spinner } from '#components/ui/spinner';
import {
  FileUploadField,
  type FileRecord,
  type FileUploadStatus,
} from '#extensions/nocobase-file-component-ui/index';
import { DateField, Choice, ErrorPanel, LoadingRows } from '../common.js';
import { DiscardDialog } from '../discard-dialog.js';
import { useBusinessQuery, useBusinessPermission } from '../hooks.js';
import {
  recordPath,
  recordFields,
  pageKeys,
  type ProfileType,
  type ProfileRecord,
  type ProfileList,
} from './model.js';
import type { BusinessRow } from '../model.js';

type Values = Record<string, string | boolean>;
// BrowserRouter has no data-router blocker. Keep private drafts in memory across Back/navigation.
const recordDrafts = new Map<
  string,
  {
    values: Values;
    files: readonly FileRecord[];
    requestId: string;
    uploadedIds: string[];
  }
>();
export default function MerchantRecordForm() {
  const { id = '' } = useParams(),
    location = useLocation(),
    navigate = useNavigate();
  const type: ProfileType = location.pathname.includes('/licenses/')
    ? 'license'
    : location.pathname.includes('/visits/')
      ? 'visit'
      : 'contact';
  const { t } = useTranslation(),
    api = useApiClient(),
    toaster = useToaster(),
    client = useQueryClient();
  const context = useOutletContext<{ row?: BusinessRow }>();
  const merchant = useBusinessQuery<{ data: BusinessRow }>(`merchants/${id}`);
  const permission = useBusinessPermission('merchants', 'write');
  const manager = useService(clientFileRepositoryManagerToken);
  const { session } = useAuthentication();
  const draftKey = `${session?.user.id}/${id}/${type}`;
  const [restored] = useState(() => recordDrafts.get(draftKey));
  const [files, setFiles] = useState<readonly FileRecord[]>(
      restored?.files ?? [],
    ),
    [uploadStatus, setUploadStatus] = useState<FileUploadStatus>('idle');
  const mountedRef = useRef(true);
  const uploadIdentitiesRef = useRef(new WeakMap<File, string>());
  const uploadControlRef = useRef<HTMLDivElement>(null);
  const errorFocusRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const recovery = useBusinessQuery<{
    data: { files: FileRecord[]; cleanupIds: string[] };
  }>(
    `merchants/${id}/licenseUploads`,
    undefined,
    type === 'license' && !!merchant.data && !!permission.can,
  );
  useEffect(() => {
    if (
      merchant.error instanceof ApiClientError &&
      merchant.error.status === 404
    )
      void client.invalidateQueries({ queryKey: ['hyl', 'merchants'] });
  }, [merchant.error, client]);
  const uploadedRef = useRef(new Set<string>(restored?.uploadedIds ?? []));
  const [hasUploads, setHasUploads] = useState(!!restored?.uploadedIds.length);
  const [requestId] = useState(
    () => restored?.requestId ?? crypto.randomUUID(),
  );
  const [error, setError] = useState<unknown>(),
    [discard, setDiscard] = useState(false),
    [cleaning, setCleaning] = useState(false);
  const completedRef = useRef(false);
  const form = useForm<Values>({
    defaultValues:
      restored?.values ??
      Object.fromEntries(
        recordFields[type].map((key) => [
          key,
          key === 'permanent' ? false : '',
        ]),
      ),
  });
  const permanent = useWatch({ control: form.control, name: 'permanent' });
  const busy =
    form.formState.isSubmitting || uploadStatus === 'uploading' || cleaning;
  useEffect(() => {
    if (!busy && errorFocusRef.current) {
      const field = errorFocusRef.current;
      errorFocusRef.current = undefined;
      if (field === 'fileId')
        uploadControlRef.current?.querySelector('button')?.focus();
      else form.setFocus(field);
    }
  }, [busy, form]);
  const dirty = form.formState.isDirty || hasUploads;
  const draftValues = useWatch({ control: form.control });
  useEffect(() => {
    if ((dirty || restored) && !completedRef.current)
      recordDrafts.set(draftKey, {
        values: draftValues as Values,
        files,
        requestId,
        uploadedIds: [...uploadedRef.current],
      });
  }, [dirty, restored, draftKey, draftValues, files, requestId]);
  const repository = useMemo<ClientFileRepository>(() => {
    const base = manager.repository('merchantLicenseFiles');
    return {
      ...base,
      uploadOne: async ({ file }) => {
        const uploadId =
          uploadIdentitiesRef.current.get(file) ?? crypto.randomUUID();
        uploadIdentitiesRef.current.set(file, uploadId);
        // Navigation may unmount the widget. Do not abort a possibly committed upload;
        // preserve its result in the private draft, and server recovery lists any lost responses.
        recordDrafts.set(draftKey, {
          values: form.getValues(),
          files,
          requestId,
          uploadedIds: [...uploadedRef.current],
        });
        const body = new FormData();
        body.append('file', file);
        const result = await api.request<{ data: UploadOneResult }>({
          path: 'merchantLicenseFiles/uploadOne',
          method: 'POST',
          query: { merchantId: id, uploadId },
          body,
        });
        uploadedRef.current.add(result.data.record.id);
        if (mountedRef.current) setHasUploads(true);
        const draft = recordDrafts.get(draftKey);
        if (draft)
          recordDrafts.set(draftKey, {
            ...draft,
            files: [result.data.record],
            uploadedIds: [...uploadedRef.current],
          });
        void client.invalidateQueries({
          queryKey: ['hyl', `merchants/${id}/licenseUploads`],
        });
        return result.data;
      },
    };
  }, [manager, api, id, draftKey, form, files, requestId, client]);
  const cleanupFiles = async (except?: string) => {
    for (const fileId of uploadedRef.current)
      if (fileId !== except) {
        await api.request({
          path: 'merchantLicenseFiles/deleteOne',
          method: 'POST',
          query: { merchantId: id },
          json: { filter: { id: fileId } },
        });
        uploadedRef.current.delete(fileId);
      }
  };
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);
  const close = () => {
    completedRef.current = true;
    void navigate(
      { pathname: '../..', search: location.search },
      { replace: true, relative: 'path' },
    );
  };
  const abandon = async () => {
    setDiscard(false);
    setCleaning(true);
    try {
      await cleanupFiles();
      completedRef.current = true;
      recordDrafts.delete(draftKey);
      close();
    } catch (cause) {
      setError(cause);
    } finally {
      setCleaning(false);
    }
  };
  const statusChange = useCallback(
    (status: FileUploadStatus) => setUploadStatus(status),
    [],
  );
  const cancel = () => {
    if (busy) return;
    if (dirty || restored) setDiscard(true);
    else close();
  };
  const optional = (key: string) =>
    [
      'number',
      'start',
      'end',
      'permanent',
      'notes',
      'outcome',
      'nextDate',
    ].includes(key) ||
    (key === 'channel' && type === 'visit');
  const validate = (key: string, value: string | boolean) => {
    if (key === 'permanent') return true;
    const v = String(value ?? '').trim();
    if (!optional(key) && !v) return t('hyl.errors.required');
    if (['date', 'start', 'end', 'nextDate'].includes(key) && v) {
      const parsed = new Date(`${v}T00:00:00Z`);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
        Number.isNaN(parsed.valueOf()) ||
        parsed.toISOString().slice(0, 10) !== v
      )
        return t('hyl.errors.invalidField');
    }
    const current = form.getValues();
    if (
      key === 'end' &&
      v &&
      (current.permanent || (current.start && v < String(current.start)))
    )
      return t('hyl.errors.INVALID_PERIOD');
    if (key === 'nextDate' && v && current.date && v < String(current.date))
      return t('hyl.errors.INVALID_PERIOD');
    return true;
  };
  const save = async (values: Values) => {
    setError(undefined);
    if (type === 'license' && !files[0]) {
      form.setError('fileId', { message: t('hyl.errors.required') });
      errorFocusRef.current = 'fileId';
      return;
    }
    try {
      const body = {
        ...values,
        requestId,
        ...(type === 'license' ? { fileId: files[0].id } : { type }),
      };
      const response = await api.request<{ data: ProfileRecord }>({
        path: recordPath(id, type),
        method: 'POST',
        json: body,
      });
      const saved = {
        ...response.data,
        ...(type === 'license' ? { file: files[0] } : {}),
      };
      const query = {
        page: 1,
        pageSize: 20,
        ...(type === 'license' ? {} : { type }),
      };
      client.setQueryData<ProfileList>(
        ['hyl', recordPath(id, type), query],
        (old) => {
          const existed = old?.data.some((row) => row.id === saved.id);
          const rows = [
            saved,
            ...(old?.data ?? []).filter((row) => row.id !== saved.id),
          ].sort(
            (a, b) =>
              b.date.localeCompare(a.date) ||
              b.createdAt.localeCompare(a.createdAt) ||
              b.id.localeCompare(a.id),
          );
          return {
            data: rows.slice(0, 20),
            meta: {
              total: (old?.meta.total ?? 0) + (existed ? 0 : 1),
              page: 1,
              pageSize: 20,
            },
          };
        },
      );
      // The saved record is durable; cleanup errors must never offer to resubmit it.
      completedRef.current = true;
      try {
        await cleanupFiles(type === 'license' ? files[0].id : undefined);
      } catch {
        toaster.show({ title: t('hyl.profile.cleanupFailed'), type: 'error' });
      }
      const search = new URLSearchParams(location.search);
      search.set(pageKeys[type], '1');
      await client.invalidateQueries({ queryKey: ['hyl'] });
      toaster.show({
        title: t('hyl.profile.saved', {
          name: merchant.data?.data.name ?? context.row?.name ?? '',
        }),
        type: 'success',
      });
      recordDrafts.delete(draftKey);
      form.reset(values);
      if (mountedRef.current)
        void navigate(
          { pathname: '../..', search: search.toString() },
          { replace: true, relative: 'path' },
        );
    } catch (cause) {
      if (mountedRef.current) setError(cause);
      if (cause instanceof ApiClientError && cause.status === 404)
        void client.invalidateQueries({ queryKey: ['hyl', 'merchants'] });
      if (cause instanceof ApiClientError) {
        const payload = cause.payload as
          { error?: { fieldViolations?: { field: string }[] } } | undefined;
        for (const issue of payload?.error?.fieldViolations ?? [])
          form.setError(
            issue.field,
            { message: t('hyl.errors.invalidField') },
            { shouldFocus: false },
          );
        errorFocusRef.current = payload?.error?.fieldViolations?.[0]?.field;
      }
    }
  };
  const terminal =
    error instanceof ApiClientError && [401, 403, 404].includes(error.status);
  const footer = (
    <>
      <Button variant='outline' disabled={busy} onClick={cancel}>
        {t('hyl.actions.back')}
      </Button>
      <Button
        form='merchant-record-form'
        type='submit'
        disabled={
          busy ||
          terminal ||
          !permission.can ||
          !merchant.data ||
          !!merchant.error
        }
      >
        {busy ? <Spinner /> : null}
        {t('hyl.actions.new')}
      </Button>
    </>
  );
  const content = merchant.isPending ? (
    <LoadingRows />
  ) : merchant.error ? (
    <ErrorPanel error={merchant.error} retry={() => void merchant.refetch()} />
  ) : !permission.can ? (
    <p>{t('hyl.profile.readOnlyHelp')}</p>
  ) : (
    <form
      id='merchant-record-form'
      className='flex flex-col gap-6'
      noValidate
      onSubmit={(e) => {
        form.clearErrors();
        void form.handleSubmit(save)(e);
      }}
    >
      {error ? (
        <>
          <ErrorPanel error={error} />
          {terminal &&
          error instanceof ApiClientError &&
          error.status === 404 ? (
            <Button variant='outline' onClick={cancel}>
              {t('hyl.actions.back')}
            </Button>
          ) : null}
        </>
      ) : null}
      {recordFields[type].map((key) => (
        <Controller
          key={key}
          control={form.control}
          name={key}
          rules={{ validate: (value) => validate(key, value) }}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={`profile-${key}`}>
                {t(`hyl.profile.fields.${key}`)}
                {!optional(key) ? ' *' : ''}
              </FieldLabel>
              {key === 'permanent' ? (
                <Choice
                  id={`profile-${key}`}
                  disabled={busy}
                  value={String(field.value)}
                  options={[
                    { value: 'false', label: t('hyl.copy.no') },
                    { value: 'true', label: t('hyl.copy.yes') },
                  ]}
                  onChange={(v) => {
                    field.onChange(v === 'true');
                    if (v === 'true')
                      form.setValue('end', '', { shouldDirty: true });
                  }}
                />
              ) : ['date', 'start', 'end', 'nextDate'].includes(key) ? (
                <div
                  ref={(element) => {
                    field.ref({
                      focus: () => element?.querySelector('button')?.focus(),
                    });
                  }}
                >
                  <DateField
                    id={`profile-${key}`}
                    value={String(field.value || '')}
                    onChange={field.onChange}
                    disabled={busy || (key === 'end' && permanent === true)}
                  />
                </div>
              ) : ['content', 'outcome', 'notes'].includes(key) ? (
                <Textarea
                  id={`profile-${key}`}
                  {...field}
                  value={String(field.value || '')}
                  disabled={busy}
                  maxLength={key === 'content' ? 2000 : 1000}
                  onChange={(e) => {
                    field.onChange(e);
                  }}
                />
              ) : (
                <Input
                  id={`profile-${key}`}
                  {...field}
                  value={String(field.value || '')}
                  disabled={busy}
                  aria-required={!optional(key)}
                  aria-invalid={fieldState.invalid}
                  maxLength={key === 'category' || key === 'channel' ? 50 : 100}
                  onChange={(e) => {
                    field.onChange(e);
                  }}
                />
              )}
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
      ))}
      {type === 'license' ? (
        <Field>
          <FieldLabel>{t('hyl.profile.attachment')} *</FieldLabel>
          <p className='text-sm text-muted-foreground'>
            {t('hyl.profile.fileHelp')}
          </p>
          <div ref={uploadControlRef}>
            <FileUploadField
              repository={repository}
              value={files}
              onChange={(value) => {
                setFiles(value);
                form.clearErrors('fileId');
              }}
              onError={setError}
              onStatusChange={statusChange}
              disabled={busy}
              accept={['application/pdf', 'image/jpeg', 'image/png']}
              maxSize={10 * 1024 * 1024}
              maxFiles={1}
            />
          </div>
          {recovery.error ? (
            <ErrorPanel
              error={recovery.error}
              retry={() => void recovery.refetch()}
            />
          ) : null}
          {(recovery.data?.data.files ?? [])
            .filter(
              (file) => !files.some((selected) => selected.id === file.id),
            )
            .map((file) => (
              <div
                key={file.id}
                className='flex flex-wrap items-center justify-between gap-2'
              >
                <span className='min-w-0 break-words text-sm'>
                  {file.filename}
                </span>
                <Button
                  variant='outline'
                  disabled={busy}
                  onClick={() => {
                    uploadedRef.current.add(file.id);
                    setHasUploads(true);
                    setFiles([file]);
                  }}
                >
                  {t('hyl.profile.recoverFile')}
                </Button>
              </div>
            ))}
          {recovery.data?.data.cleanupIds.length ? (
            <Button
              variant='outline'
              disabled={busy}
              onClick={() => {
                setCleaning(true);
                void Promise.all(
                  recovery.data.data.cleanupIds.map((fileId) =>
                    api.request({
                      path: 'merchantLicenseFiles/deleteOne',
                      method: 'POST',
                      query: { merchantId: id },
                      json: { filter: { id: fileId } },
                    }),
                  ),
                )
                  .then(() => recovery.refetch())
                  .catch(setError)
                  .finally(() => setCleaning(false));
              }}
            >
              {t('hyl.profile.retryCleanup')}
            </Button>
          ) : null}
          <FieldError errors={[form.formState.errors.fileId]} />
        </Field>
      ) : null}
    </form>
  );
  return (
    <>
      {type === 'license' ? (
        <RouteChildPage>
          <PageContainer>
            <Button
              className='w-fit'
              variant='ghost'
              disabled={busy}
              onClick={cancel}
            >
              {t('hyl.actions.back')}
            </Button>
            <PageHeader
              title={t(`hyl.profile.add${type}`)}
              description={merchant.data?.data.name}
            />
            <div className='flex max-w-4xl flex-col gap-6'>
              {content}
              <div className='flex justify-end gap-2'>{footer}</div>
            </div>
          </PageContainer>
        </RouteChildPage>
      ) : (
        <RouteDialog
          title={t(`hyl.profile.add${type}`)}
          footer={footer}
          beforeClose={() => {
            if (busy) return false;
            if (dirty) {
              setDiscard(true);
              return false;
            }
            return true;
          }}
        >
          {content}
        </RouteDialog>
      )}
      <DiscardDialog
        open={discard}
        onOpenChange={(open) => {
          setDiscard(open);
        }}
        onConfirm={() => void abandon()}
      />
    </>
  );
}
