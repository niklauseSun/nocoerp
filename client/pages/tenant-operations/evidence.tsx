import { useState, useRef } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient, useToaster } from '@nocobase/app-client';
import { useQueryClient } from '@tanstack/react-query';
import type { FileRecord } from '@nocobase/app-plugin-file/client';
import {
  FileList,
  FilePreviewDialog,
} from '#extensions/nocobase-file-component-ui/index';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { Input } from '#components/ui/input';
import { Field, FieldLabel } from '#components/ui/field';
import { useBusinessQuery, useBusinessPermission } from '../hyl/hooks.js';
import { BillingError, LoadingRows } from '../billing/common.js';
export function ReportingEvidence({
  kind,
  id,
}: {
  kind: 'revenueReports' | 'expenses';
  id: string;
}) {
  const { t } = useTranslation(),
    api = useApiClient(),
    cache = useQueryClient(),
    toast = useToaster(),
    permission = useBusinessPermission(kind, 'write'),
    r = useBusinessQuery<{ data: FileRecord[] }>(
      `reportingEvidence/${kind}/${id}`,
    ),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<FileRecord>(),
    inputRef = useRef<HTMLInputElement>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('operations.attachments')}</CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        <p className='text-sm text-muted-foreground'>
          {t('operations.attachmentHelp')}
        </p>
        {r.error ? (
          <BillingError error={r.error} retry={() => void r.refetch()} />
        ) : r.isPending ? (
          <LoadingRows />
        ) : (
          <FileList
            files={r.data?.data ?? []}
            onPreview={setPreview}
            onError={setError}
          />
        )}
        {permission.can ? (
          <Field>
            <FieldLabel htmlFor={`evidence-${id}`}>
              {t('operations.upload')}
            </FieldLabel>
            <Input
              ref={inputRef}
              id={`evidence-${id}`}
              type='file'
              accept='application/pdf,image/png,image/jpeg'
              disabled={busy}
              aria-busy={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                void (async () => {
                  if (!file) return;
                  setBusy(true);
                  setError(undefined);
                  try {
                    const body = new FormData();
                    body.append('file', file);
                    await api.request({
                      path: 'reportingFiles/uploadOne',
                      method: 'POST',
                      query: { kind, recordId: id },
                      body,
                    });
                    await cache.invalidateQueries({
                      queryKey: ['hyl', `reportingEvidence/${kind}/${id}`],
                    });
                    toast.show({
                      title: t('operations.uploaded'),
                      type: 'success',
                    });
                    if (inputRef.current) inputRef.current.value = '';
                  } catch (e) {
                    setError(e);
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            />
          </Field>
        ) : null}
        {error ? <BillingError error={error} /> : null}
        {preview ? (
          <FilePreviewDialog
            files={[preview]}
            open
            onOpenChange={(open) => {
              if (!open) setPreview(undefined);
            }}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
