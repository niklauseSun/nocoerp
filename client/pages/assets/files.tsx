import { useScopedQuery as useQuery } from '#hooks/use-scoped-query';
import { Spinner } from '#components/ui/spinner';
import { fileDrafts } from './drafts.js';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useAssetPermission, useDraftWarning } from './hooks.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router';
import { useApiClient, useService, useToaster } from '@nocobase/app-client';
import {
  clientFileRepositoryManagerToken,
  type ClientFileRepository,
  type UploadOneResult,
} from '@nocobase/app-plugin-file/client';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from '@nocobase/i18n/client';
import { RouteDialog } from '#components/route-dialog';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Field, FieldLabel } from '#components/ui/field';
import {
  FileUploadField,
  type FileRecord,
  type FileUploadStatus,
} from '#extensions/nocobase-file-component-ui/index';
import { Choice } from '../hyl/common.js';
import { DiscardDialog } from '../hyl/discard-dialog.js';
import { AssetError } from './shared.js';
export default function AssetFileForm() {
  const { id = '' } = useParams(),
    api = useApiClient(),
    toaster = useToaster(),
    manager = useService(clientFileRepositoryManagerToken),
    client = useQueryClient(),
    { t } = useTranslation(),
    navigate = useNavigate(),
    location = useLocation(),
    can = useAssetPermission('write');
  const { session } = useAuthentication();
  const draftKey = `${session?.user.id}/${id}`;
  const [restored] = useState(() => fileDrafts.get(draftKey));
  const [titleError, setTitleError] = useState('');
  const [files, setFiles] = useState<readonly FileRecord[]>([]),
    [title, setTitle] = useState(restored?.title ?? ''),
    [category, setCategory] = useState(restored?.category ?? 'drawing'),
    [status, setStatus] = useState<FileUploadStatus>('idle'),
    [saving, setSaving] = useState(false),
    [error, setError] = useState<unknown>(),
    [discard, setDiscard] = useState(false);
  const identitiesRef = useRef(new WeakMap<File, string>()),
    uploadedRef = useRef(new Set<string>(restored?.uploadedIds ?? []));
  const uploadIdsRef = useRef(new Set<string>(restored?.uploadIds ?? []));
  useEffect(() => {
    if (title || category !== 'drawing')
      fileDrafts.set(draftKey, {
        title,
        category,
        uploadedIds: [...uploadedRef.current],
        uploadIds: [...uploadIdsRef.current],
      });
  }, [title, category, draftKey]);
  const busy = saving || status === 'uploading';
  useDraftWarning(busy || !!title || !!files.length || !!restored || !!error);
  const recovery = useQuery({
    queryKey: ['hyl', 'asset-pending', id],
    queryFn: () =>
      api.request<{
        data: {
          files: (FileRecord & { uploadId?: string | null })[];
          cleanupIds: string[];
        };
      }>({
        path: `assets/${id}/fileUploads`,
      }),
    retry: false,
    enabled: can.can,
  });
  const repository = useMemo<ClientFileRepository>(
    () => ({
      ...manager.repository('assetFiles'),
      uploadOne: async ({ file }) => {
        const uploadId = identitiesRef.current.get(file) ?? crypto.randomUUID();
        identitiesRef.current.set(file, uploadId);
        uploadIdsRef.current.add(uploadId);
        fileDrafts.set(draftKey, {
          title,
          category,
          uploadedIds: [...uploadedRef.current],
          uploadIds: [...uploadIdsRef.current],
        });
        const body = new FormData();
        body.append('file', file);
        const result = await api.request<{ data: UploadOneResult }>({
          path: 'assetFiles/uploadOne',
          method: 'POST',
          query: { assetId: id, uploadId },
          body,
        });
        uploadedRef.current.add(result.data.record.id);
        const previous = fileDrafts.get(draftKey);
        fileDrafts.set(draftKey, {
          title: previous?.title ?? title,
          category: previous?.category ?? category,
          uploadedIds: [...uploadedRef.current],
          uploadIds: [...uploadIdsRef.current],
        });
        void client.invalidateQueries({
          queryKey: ['hyl', 'asset-pending', id],
        });
        return result.data;
      },
    }),
    [manager, api, id, client, draftKey, title, category],
  );
  const close = () =>
    void navigate(
      { pathname: '../..', search: location.search },
      { relative: 'path', replace: true },
    );
  const cleanup = async (ids: string[]) => {
    for (const fileId of ids) {
      await api.request({
        path: 'assetFiles/deleteOne',
        method: 'POST',
        query: { assetId: id },
        json: { filter: { id: fileId } },
      });
      uploadedRef.current.delete(fileId);
    }
    await recovery.refetch();
  };
  const abandon = async () => {
    setSaving(true);
    setDiscard(false);
    try {
      const pending = await recovery.refetch();
      if (pending.error) throw pending.error;
      await cleanup([
        ...new Set([
          ...uploadedRef.current,
          ...(pending.data?.data.files
            .filter(
              (f) =>
                uploadedRef.current.has(f.id) ||
                (f.uploadId && uploadIdsRef.current.has(f.uploadId)),
            )
            .map((f) => f.id) ?? []),
          ...(pending.data?.data.cleanupIds.filter((fileId) =>
            uploadedRef.current.has(fileId),
          ) ?? []),
        ]),
      ]);
      fileDrafts.delete(draftKey);
      close();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!files[0]) return;
    if (!title.trim()) {
      setTitleError(t('hyl.errors.required'));
      document.getElementById('file-title')?.focus();
      return;
    }
    setTitleError('');
    setSaving(true);
    setError(undefined);
    try {
      await api.request({
        path: `assets/${id}/files`,
        method: 'POST',
        json: { fileId: files[0].id, title, category },
      });
      uploadedRef.current.delete(files[0].id);
      fileDrafts.delete(draftKey);
      toaster.show({
        title: t('assets.fileSaved', { name: title }),
        type: 'success',
      });
      await client.invalidateQueries({ queryKey: ['hyl'] });
      const pending = await recovery.refetch();
      await cleanup(
        [
          ...new Set([
            ...uploadedRef.current,
            ...(pending.data?.data.files
              .filter(
                (f) =>
                  uploadedRef.current.has(f.id) ||
                  (f.uploadId && uploadIdsRef.current.has(f.uploadId)),
              )
              .map((f) => f.id) ?? []),
            ...(pending.data?.data.cleanupIds.filter((fileId) =>
              uploadedRef.current.has(fileId),
            ) ?? []),
          ]),
        ].filter((fileId) => fileId !== files[0]?.id),
      ).catch(() =>
        toaster.show({ title: t('assets.cleanupFailed'), type: 'error' }),
      );
      close();
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <RouteDialog
        title={t('assets.addFile')}
        beforeClose={() => {
          if (busy) return false;
          if (
            title ||
            files.length ||
            uploadedRef.current.size ||
            uploadIdsRef.current.size
          ) {
            setDiscard(true);
            return false;
          }
          return true;
        }}
        footer={
          <>
            <Button
              variant='outline'
              disabled={busy}
              onClick={() =>
                title ||
                files.length ||
                uploadedRef.current.size ||
                uploadIdsRef.current.size
                  ? setDiscard(true)
                  : close()
              }
            >
              {t('hyl.actions.back')}
            </Button>
            <Button
              form='asset-file-form'
              type='submit'
              disabled={busy || !files.length || !can.can}
            >
              {busy ? <Spinner /> : null}
              {t('hyl.actions.save')}
            </Button>
          </>
        }
      >
        <form
          id='asset-file-form'
          onSubmit={(e) => void save(e)}
          className='flex flex-col gap-5'
        >
          {error ? <AssetError error={error} /> : null}
          <Field>
            <FieldLabel htmlFor='file-title'>
              {t('assets.fileTitle')} *
            </FieldLabel>
            <Input
              id='file-title'
              required
              maxLength={100}
              value={title}
              disabled={busy}
              onChange={(e) => {
                setTitle(e.target.value);
                setTitleError('');
              }}
            />
            {titleError ? (
              <p className='text-sm text-destructive'>{titleError}</p>
            ) : null}
          </Field>
          <Field>
            <FieldLabel htmlFor='file-category'>
              {t('assets.category')}
            </FieldLabel>
            <Choice
              id='file-category'
              value={category}
              onChange={setCategory}
              disabled={busy}
              options={['drawing', 'photo', 'ownership'].map((value) => ({
                value,
                label: t(`assets.categories.${value}`),
              }))}
            />
          </Field>
          <p className='text-sm text-muted-foreground'>
            {t('assets.fileHelp')}
          </p>
          <FileUploadField
            repository={repository}
            value={files}
            onChange={setFiles}
            onError={setError}
            onStatusChange={setStatus}
            disabled={busy || !can.can}
            accept={['application/pdf', 'image/jpeg', 'image/png']}
            maxSize={10 * 1024 * 1024}
            maxFiles={1}
          />
          {(recovery.data?.data.files.length ?? 0) >= 100 ||
          (recovery.data?.data.cleanupIds.length ?? 0) >= 100 ? (
            <p className='text-sm text-muted-foreground'>
              {t('assets.pendingLimit')}
            </p>
          ) : null}
          {recovery.error ? (
            <AssetError
              error={recovery.error}
              retry={() => void recovery.refetch()}
            />
          ) : null}
          {recovery.data?.data.files
            .filter((f) => !files.some((s) => s.id === f.id))
            .map((file) => (
              <div key={file.id} className='flex flex-wrap gap-2'>
                <span className='min-w-0 break-words'>{file.filename}</span>
                <Button
                  type='button'
                  variant='outline'
                  disabled={busy}
                  onClick={() => {
                    setFiles([file]);
                    uploadedRef.current.add(file.id);
                  }}
                >
                  {t('assets.recovery')}
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  disabled={busy}
                  onClick={() => {
                    setSaving(true);
                    void cleanup([file.id])
                      .catch(setError)
                      .finally(() => setSaving(false));
                  }}
                >
                  {t('assets.delete')}
                </Button>
              </div>
            ))}
          {recovery.data?.data.cleanupIds.length ? (
            <Button
              type='button'
              variant='outline'
              disabled={busy}
              onClick={() => {
                setSaving(true);
                void cleanup(recovery.data.data.cleanupIds)
                  .catch(setError)
                  .finally(() => setSaving(false));
              }}
            >
              {t('assets.cleanup')}
            </Button>
          ) : null}
        </form>
      </RouteDialog>
      <DiscardDialog
        open={discard}
        onOpenChange={setDiscard}
        onConfirm={() => void abandon()}
      />
    </>
  );
}
