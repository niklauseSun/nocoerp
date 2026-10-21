import { ApiClientError } from '@nocobase/app-client';
import { useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { Button } from '#components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
} from '#components/ui/empty';
import { LongText } from '#components/long-text';
import {
  FileList,
  FilePreviewDialog,
  type FileRecord,
} from '#extensions/nocobase-file-component-ui/index';
import { FileText } from 'lucide-react';
import { useBusinessPermission, useBusinessQuery } from '../hooks.js';
import { ErrorPanel, LoadingRows } from '../common.js';
import {
  recordPath,
  recordFields,
  pageKeys,
  routeSegments,
  type ProfileType,
  type ProfileList,
} from './model.js';
export function MerchantRecords({
  id,
  type,
}: {
  id: string;
  type: ProfileType;
}) {
  const { t, i18n } = useTranslation(),
    location = useLocation();
  const [params, setParams] = useSearchParams();
  const [preview, setPreview] = useState<FileRecord>();
  const [error, setError] = useState<unknown>();
  const can = useBusinessPermission('merchants', 'write');
  const page = Math.max(1, Number(params.get(pageKeys[type])) || 1);
  const result = useBusinessQuery<ProfileList>(recordPath(id, type), {
    page,
    pageSize: 20,
    ...(type === 'license' ? {} : { type }),
  });
  const inaccessible =
    result.error instanceof ApiClientError &&
    [401, 403, 404].includes(result.error.status);
  const add =
    can.can && !inaccessible ? (
      <Button
        variant='outline'
        nativeButton={false}
        render={
          <Link
            to={{ pathname: routeSegments[type], search: location.search }}
          />
        }
      >
        {t(`hyl.profile.add${type}`)}
      </Button>
    ) : null;
  const formatDate = (s: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
      new Date(s.length === 10 ? `${s}T00:00:00` : s),
    );
  return (
    <Card>
      <CardHeader className='flex flex-row items-center justify-between gap-2'>
        <CardTitle>{t(`hyl.profile.${type}`)}</CardTitle>
        {result.data?.data.length ? add : null}
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        {error ? <ErrorPanel error={error} /> : null}
        {result.error && result.data && !inaccessible ? (
          <ErrorPanel
            error={result.error}
            retry={() => void result.refetch()}
          />
        ) : null}
        {result.isPending ? (
          <LoadingRows />
        ) : result.error && (!result.data || inaccessible) ? (
          <ErrorPanel
            error={result.error}
            retry={() => void result.refetch()}
          />
        ) : !result.data?.data.length ? (
          <Empty className='min-h-40 border border-dashed p-6 md:p-6'>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <FileText />
              </EmptyMedia>
              <EmptyTitle>{t(`hyl.profile.empty${type}`)}</EmptyTitle>
              <EmptyDescription>
                {t(
                  can.can
                    ? 'hyl.profile.emptyHelp'
                    : 'hyl.profile.readOnlyHelp',
                )}
              </EmptyDescription>
            </EmptyHeader>
            {add ? <EmptyContent>{add}</EmptyContent> : null}
          </Empty>
        ) : (
          <>
            {result.data.data.map((row) => (
              <article
                key={row.id}
                className='flex min-w-0 flex-col gap-3 border-b pb-4'
              >
                <p className='text-sm text-muted-foreground'>
                  {formatDate(row.date)} · {t('hyl.profile.recordedBy')}{' '}
                  {row.actor} · {formatDate(row.createdAt)}
                </p>
                <dl className='grid grid-cols-[8rem_1fr] gap-3'>
                  {recordFields[type]
                    .filter((key) => !['permanent', 'date'].includes(key))
                    .map((key) => (
                      <div key={key} className='contents'>
                        <dt className='text-sm text-muted-foreground'>
                          {t(`hyl.profile.fields.${key}`)}
                        </dt>
                        <dd className='min-w-0 whitespace-pre-wrap break-words'>
                          {['content', 'outcome', 'notes'].includes(key) ? (
                            <LongText>
                              {String(row.payload[key] || '—')}
                            </LongText>
                          ) : key === 'end' && row.payload.permanent ? (
                            t('hyl.profile.permanent')
                          ) : ['start', 'end', 'nextDate'].includes(key) ? (
                            row.payload[key] ? (
                              formatDate(String(row.payload[key]))
                            ) : key === 'end' ? (
                              t('hyl.profile.unknownExpiry')
                            ) : (
                              '—'
                            )
                          ) : (
                            String(row.payload[key] || '—')
                          )}
                        </dd>
                      </div>
                    ))}
                </dl>
                {row.file ? (
                  <FileList
                    files={[row.file]}
                    onPreview={setPreview}
                    onError={setError}
                  />
                ) : null}
              </article>
            ))}
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <p className='text-sm text-muted-foreground'>
                {t('hyl.copy.count', { total: result.data.meta.total, page })}
              </p>
              <div className='flex gap-2'>
                {[-1, 1].map((step) => (
                  <Button
                    key={step}
                    variant='outline'
                    disabled={
                      result.isFetching ||
                      (step === -1
                        ? page === 1
                        : page * 20 >= result.data.meta.total)
                    }
                    onClick={() => {
                      const next = new URLSearchParams(params);
                      next.set(pageKeys[type], String(page + step));
                      setParams(next, { replace: true });
                    }}
                  >
                    {t(
                      step === -1 ? 'hyl.actions.previous' : 'hyl.actions.next',
                    )}
                  </Button>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
      {preview ? (
        <FilePreviewDialog
          files={[preview]}
          open
          onOpenChange={(open) => {
            if (!open) setPreview(undefined);
          }}
          onError={setError}
        />
      ) : null}
    </Card>
  );
}
