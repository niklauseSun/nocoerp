import { useMemo, useState, useRef, useCallback } from 'react';
import { useApiClient, useService } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  clientFileRepositoryManagerToken,
  type ClientFileRepository,
  type UploadOneResult,
} from '@nocobase/app-plugin-file/client';
import {
  FileUploadField,
  FilePreviewField,
  type FileRecord,
  type FileUploadStatus,
} from '#extensions/nocobase-file-component-ui/index';
import { Field, FieldLabel } from '#components/ui/field';
import { BillingError } from './common.js';
export type PhotoGroups = {
  report: FileRecord[];
  processing: FileRecord[];
  acceptance: FileRecord[];
};
export function RepairPhotoPreview({
  files,
}: {
  files: readonly FileRecord[];
}) {
  const { t } = useTranslation(),
    [error, setError] = useState<unknown>();
  return (
    <>
      {error ? <BillingError error={error} /> : null}
      <FilePreviewField
        files={files}
        showFilenames
        labels={{ preview: t('repair.photos.preview') }}
        emptyState={
          <p className='text-sm text-muted-foreground'>
            {t('repair.photos.empty')}
          </p>
        }
        onError={setError}
      />
    </>
  );
}
export function RepairPhotoUpload({
  assetId,
  orderId,
  stage,
  value,
  onChange,
  onStatusChange,
  disabled,
  onStarted,
}: {
  assetId: string;
  orderId?: string;
  stage: keyof PhotoGroups;
  value: readonly FileRecord[];
  onChange: (files: readonly FileRecord[]) => void;
  onStatusChange: (status: FileUploadStatus) => void;
  disabled: boolean;
  onStarted: () => void;
}) {
  const api = useApiClient(),
    manager = useService(clientFileRepositoryManagerToken),
    { t } = useTranslation(),
    [error, setError] = useState<unknown>(),
    uploadRef = useRef<HTMLDivElement>(null);
  const statusChanged = useCallback(
    (status: FileUploadStatus) => {
      onStatusChange(status);
      if (status === 'idle') setError(undefined);
    },
    [onStatusChange],
  );
  const repository = useMemo<ClientFileRepository>(
    () => ({
      ...manager.repository('repairFiles'),
      uploadOne: async ({ file }, options) => {
        onStarted();
        setError(undefined);
        const body = new FormData();
        body.append('file', file);
        try {
          const result = await api.request<{ data: UploadOneResult }>({
            path: 'repairFiles/uploadOne',
            method: 'POST',
            query: { assetId, orderId, stage },
            body,
            signal: options?.signal,
          });
          return result.data;
        } catch (cause) {
          if (options?.signal?.aborted) throw cause;
          // The Registry maps this canonical error to its localized upload message.
          throw new Error('File upload failed.', { cause });
        }
      },
    }),
    [manager, api, assetId, orderId, stage, onStarted],
  );
  return (
    <Field>
      <FieldLabel>{t('repair.photos.' + stage)}</FieldLabel>
      <p className='text-sm text-muted-foreground'>
        {t(assetId ? 'repair.photos.help' : 'repair.photos.chooseAsset')}
      </p>
      {error ? <BillingError error={error} /> : null}
      <div ref={uploadRef}>
        <FileUploadField
          repository={repository}
          value={value}
          onChange={(next) => {
            const removed = next.length < value.length;
            onChange(next);
            if (removed)
              queueMicrotask(() => {
                // Wait for maxFiles to re-enable the chooser after removing the ninth image.
                // The installed upload field keeps it immediately before the file input.
                const chooser =
                  uploadRef.current?.querySelector(
                    'input[type=file]',
                  )?.previousElementSibling;
                if (chooser instanceof HTMLButtonElement) chooser.focus();
              });
          }}
          onStatusChange={statusChanged}
          onError={(error) => setError(error.cause ?? error)}
          multiple
          accept={['image/jpeg', 'image/png']}
          maxFiles={9}
          maxSize={10 * 1024 * 1024}
          disabled={disabled || !assetId}
          labels={{
            choose: t('repair.photos.choose'),
            remove: t('repair.photos.remove'),
            retry: t('repair.photos.retry'),
          }}
        />
      </div>
      {value.length ? <RepairPhotoPreview files={value} /> : null}
    </Field>
  );
}
