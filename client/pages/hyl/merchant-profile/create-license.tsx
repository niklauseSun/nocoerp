import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApiClient, useService } from '@nocobase/app-client';
import {
  clientFileRepositoryManagerToken,
  type ClientFileRepository,
  type UploadOneResult,
} from '@nocobase/app-plugin-file/client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  FileUploadField,
  type FileRecord,
  type FileUploadStatus,
} from '#extensions/nocobase-file-component-ui/index';
import { Field, FieldLabel, FieldDescription } from '#components/ui/field';
import { Button } from '#components/ui/button';
import { ErrorPanel } from '../common.js';
import { useBusinessQuery } from '../hooks.js';
type Values = Record<string, string | boolean>;
type Draft = {
  creationId: string;
  files: readonly FileRecord[];
  uploaded: Set<string>;
  submission?: Values;
  uncertain?: boolean;
};
// Keep bank details and license references in this session's memory only.
const drafts = new Map<string, Draft>();
export function useCreateLicense(
  enabled: boolean,
  draftKey: string,
  onError: (error: unknown) => void,
  submitting = false,
) {
  const api = useApiClient(),
    manager = useService(clientFileRepositoryManagerToken),
    { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>(
    () =>
      drafts.get(draftKey) ?? {
        creationId: crypto.randomUUID(),
        files: [],
        uploaded: new Set(),
      },
  );
  const [status, setStatus] = useState<FileUploadStatus>('idle');
  const [cleaning, setCleaning] = useState(false);
  const mountedRef = useRef(true),
    completedRef = useRef(false),
    identitiesRef = useRef(new WeakMap<File, string>());
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const write = useCallback(
    (value: Draft) => {
      if (!completedRef.current) drafts.set(draftKey, value);
      if (mountedRef.current) setDraft(value);
    },
    [draftKey],
  );
  const recovery = useBusinessQuery<{
    data: { files: FileRecord[]; cleanupIds: string[] };
  }>(`merchants/${draft.creationId}/licenseUploads`, undefined, enabled);
  const repository = useMemo<ClientFileRepository>(
    () => ({
      ...manager.repository('merchantLicenseFiles'),
      uploadOne: async ({ file }) => {
        const uploadId = identitiesRef.current.get(file) ?? crypto.randomUUID();
        identitiesRef.current.set(file, uploadId);
        write(drafts.get(draftKey) ?? draft);
        const body = new FormData();
        body.append('file', file);
        // Do not abort possibly committed uploads on navigation; preserve their late result.
        const result = await api.request<{ data: UploadOneResult }>({
          path: 'merchantLicenseFiles/uploadOne',
          method: 'POST',
          query: { merchantId: draft.creationId, uploadId },
          body,
        });
        const current = drafts.get(draftKey) ?? draft;
        write({
          ...current,
          files: [result.data.record],
          uploaded: new Set([...current.uploaded, result.data.record.id]),
        });
        return result.data;
      },
    }),
    [manager, api, draft, draftKey, write],
  );
  const cleanupUnused = async (except?: string) => {
    setCleaning(true);
    try {
      const current = await api.request<{
        data: { files: FileRecord[]; cleanupIds: string[] };
      }>({ path: `merchants/${draft.creationId}/licenseUploads` });
      const ids = new Set([
        ...draft.uploaded,
        ...current.data.files.map((file) => file.id),
        ...current.data.cleanupIds,
      ]);
      for (const id of ids)
        if (id !== except) {
          await api.request({
            path: 'merchantLicenseFiles/deleteOne',
            method: 'POST',
            query: { merchantId: draft.creationId },
            json: { filter: { id } },
          });
          const latest = drafts.get(draftKey) ?? draft;
          const uploaded = new Set(latest.uploaded);
          uploaded.delete(id);
          write({ ...latest, uploaded });
        }
    } finally {
      setCleaning(false);
    }
  };
  const cleanup = async () => {
    await cleanupUnused();
    completedRef.current = true;
    drafts.delete(draftKey);
    write({ ...draft, files: [], uploaded: new Set() });
  };
  const busy =
    enabled &&
    (submitting || status === 'uploading' || cleaning || recovery.isFetching);
  const dirty = enabled && (draft.files.length > 0 || draft.uploaded.size > 0);
  const element = enabled ? (
    <Field>
      <FieldLabel>{t('hyl.profile.businessLicense')}</FieldLabel>
      <FieldDescription>{t('hyl.profile.createLicenseHelp')}</FieldDescription>
      <FileUploadField
        repository={repository}
        value={draft.files}
        onChange={(files) =>
          write({ ...(drafts.get(draftKey) ?? draft), files })
        }
        onError={onError}
        onStatusChange={setStatus}
        disabled={busy || !!draft.uncertain}
        accept={['application/pdf', 'image/jpeg', 'image/png']}
        maxSize={10 * 1024 * 1024}
        maxFiles={1}
      />
      {recovery.error ? (
        <ErrorPanel
          error={recovery.error}
          retry={() => void recovery.refetch()}
        />
      ) : null}
      {(recovery.data?.data.files ?? [])
        .filter(
          (file) => !draft.files.some((selected) => selected.id === file.id),
        )
        .map((file) => (
          <Button
            key={file.id}
            type='button'
            variant='outline'
            disabled={busy || !!draft.uncertain || draft.files.length > 0}
            onClick={() =>
              write({
                ...draft,
                files: [file],
                uploaded: new Set([...draft.uploaded, file.id]),
              })
            }
          >
            {t('hyl.profile.recoverFile')} · {file.filename}
          </Button>
        ))}
    </Field>
  ) : null;
  return {
    element,
    busy,
    dirty,
    uncertain: !!draft.uncertain,
    creationId: draft.creationId,
    fileId: draft.files[0]?.id,
    submission: draft.submission,
    freeze: (values: Values) =>
      write({ ...(drafts.get(draftKey) ?? draft), submission: { ...values } }),
    failed: (unknown: boolean) => {
      const current = drafts.get(draftKey) ?? draft;
      write({
        ...current,
        uncertain: unknown,
        submission: unknown ? current.submission : undefined,
      });
    },
    cleanup,
    cleanupUnused,
    clear: () => {
      completedRef.current = true;
      drafts.delete(draftKey);
    },
  };
}
