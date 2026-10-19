import { useScopedQuery as useQuery } from '#hooks/use-scoped-query';
import { Related } from '../inspections/related.js';
import { RepairRelated } from '../repairs/related.js';
import { EnergyRelated } from '../energy/related.js';
import { LongText } from '#components/long-text';
import { useAssetPermission } from './hooks.js';
import { useState } from 'react';
import {
  Link,
  Outlet,
  useParams,
  useSearchParams,
  useLocation,
} from 'react-router';
import { useApiClient, ApiClientError } from '@nocobase/app-client';
import {
  useQueryClient,
  useIsFetching,
  keepPreviousData,
} from '@tanstack/react-query';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { RouteChildPage } from '#components/route-child-page';
import { Button } from '#components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import {
  FileList,
  FilePreviewDialog,
  type FileRecord,
} from '#extensions/nocobase-file-component-ui/index';
import { LoadingRows, Refresh } from '../hyl/common.js';
import { AssetError, Pager, AssetEmpty } from './shared.js';
import { fields, type Asset, type List } from './model.js';
interface History {
  id: string;
  actor: string;
  action: string;
  reason: string;
  createdAt: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
}
interface Associations {
  merchants: {
    id: string;
    start: string;
    end: string;
    merchant: { id: string; name: string; number: string };
  }[];
  restricted: boolean;
  contracts: { id: string; number: string; start: string; end: string }[];
}
export default function AssetDetail() {
  const { id } = useParams(),
    api = useApiClient(),
    client = useQueryClient(),
    { t, i18n } = useTranslation(),
    can = useAssetPermission('write'),
    location = useLocation();
  const [params, setParams] = useSearchParams(),
    [preview, setPreview] = useState<FileRecord>();
  const [fileError, setFileError] = useState<unknown>();
  const page = Math.max(1, Number(params.get('historyPage')) || 1),
    filePage = Math.max(1, Number(params.get('filePage')) || 1);
  const row = useQuery({
    queryKey: ['hyl', 'asset', id],
    queryFn: () => api.request<{ data: Asset }>({ path: `assets/${id}` }),
    retry: false,
  });
  const parentId = row.data?.data.parentId;
  const parent = useQuery({
    queryKey: ['hyl', 'asset', parentId],
    queryFn: () => api.request<{ data: Asset }>({ path: `assets/${parentId}` }),
    enabled: !!parentId,
    retry: false,
  });
  const history = useQuery({
    queryKey: ['hyl', 'asset-history', id, page],
    queryFn: () =>
      api.request<List<History>>({
        path: `assets/${id}/history`,
        query: { page, pageSize: 20 },
      }),
    retry: false,
    enabled: !!row.data,
    placeholderData: keepPreviousData,
  });
  const files = useQuery({
    queryKey: ['hyl', 'asset-files', id, filePage],
    queryFn: () =>
      api.request<List<FileRecord & { title: string; category: string }>>({
        path: `assets/${id}/files`,
        query: { page: filePage, pageSize: 20 },
      }),
    retry: false,
    enabled: !!row.data,
    placeholderData: keepPreviousData,
  });
  const related = useQuery({
    queryKey: ['hyl', 'asset-related', id],
    queryFn: () =>
      api.request<{ data: Associations }>({
        path: `assets/${id}/associations`,
      }),
    retry: false,
    enabled: !!row.data,
  });
  const terminal = (error: unknown) =>
    error instanceof ApiClientError && [401, 403, 404].includes(error.status);
  const busy = useIsFetching({ queryKey: ['hyl'] }) > 0;
  const show = (key: string, value: unknown) =>
    key === 'type'
      ? t(`assets.types.${String(typeof value === 'string' ? value : '')}`)
      : key === 'state'
        ? t(`assets.states.${String(typeof value === 'string' ? value : '')}`)
        : value == null || value === ''
          ? '—'
          : typeof value === 'string'
            ? value
            : JSON.stringify(value);
  const setPage = (key: string, value: number) =>
    setParams((old) => {
      const next = new URLSearchParams(old);
      next.set(key, String(value));
      return next;
    });
  return (
    <>
      <RouteChildPage>
        <PageContainer>
          <BackButton />
          <PageHeader
            title={row.data?.data.name ?? t('assets.card')}
            description={row.data?.data.number}
            actions={
              <div className='flex gap-2'>
                {can.can ? (
                  <Button
                    variant='outline'
                    nativeButton={false}
                    render={
                      <Link
                        to={{ pathname: 'edit', search: location.search }}
                      />
                    }
                  >
                    {t('assets.edit')}
                  </Button>
                ) : null}
                <Refresh
                  busy={busy}
                  onClick={() =>
                    void client.invalidateQueries({ queryKey: ['hyl'] })
                  }
                />
              </div>
            }
          />
          {row.error && row.data && !terminal(row.error) ? (
            <AssetError error={row.error} retry={() => void row.refetch()} />
          ) : null}
          {row.isPending ? (
            <LoadingRows />
          ) : row.error && (!row.data || terminal(row.error)) ? (
            <AssetError error={row.error} retry={() => void row.refetch()} />
          ) : row.data ? (
            <div className='flex flex-col gap-6'>
              <Card>
                <CardHeader>
                  <CardTitle>{t('assets.card')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className='grid gap-4 sm:grid-cols-2'>
                    {fields.map((key) => (
                      <div key={key} className='min-w-0'>
                        <dt className='text-sm text-muted-foreground'>
                          {t(`assets.fields.${key}`)}
                        </dt>
                        <dd className='whitespace-pre-wrap break-words'>
                          <LongText>
                            {key === 'parentId' && parentId
                              ? parent.data
                                ? `${parent.data.data.name} · ${parent.data.data.number}`
                                : '—'
                              : show(key, row.data.data[key])}
                          </LongText>
                        </dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>
              <Related kind='tasks' scope='asset' id={id!} />
              <Related kind='issues' scope='asset' id={id!} />
              <RepairRelated kind='asset' id={row.data.data.id} />
              <EnergyRelated kind='asset' id={row.data.data.id} />
              <Card>
                <CardHeader className='flex flex-row items-center justify-between gap-3'>
                  <CardTitle>{t('assets.files')}</CardTitle>
                  {can.can ? (
                    <Button
                      variant='outline'
                      nativeButton={false}
                      render={
                        <Link
                          to={{
                            pathname: 'files/new',
                            search: location.search,
                          }}
                        />
                      }
                    >
                      {t('assets.addFile')}
                    </Button>
                  ) : null}
                </CardHeader>
                <CardContent className='flex flex-col gap-4'>
                  {fileError ? <AssetError error={fileError} /> : null}
                  {files.error && files.data && !terminal(files.error) ? (
                    <AssetError
                      error={files.error}
                      retry={() => void files.refetch()}
                    />
                  ) : null}
                  {files.isPending ? (
                    <LoadingRows />
                  ) : files.error && (!files.data || terminal(files.error)) ? (
                    <AssetError
                      error={files.error}
                      retry={() => void files.refetch()}
                    />
                  ) : files.data?.data.length ? (
                    <>
                      {files.data.data.map((file) => (
                        <div key={file.id}>
                          <p>
                            {file.title} ·{' '}
                            {t(`assets.categories.${file.category}`)}
                          </p>
                          <FileList
                            files={[file]}
                            onPreview={setPreview}
                            onError={setFileError}
                          />
                        </div>
                      ))}
                      <Pager
                        page={filePage}
                        total={files.data.meta.total}
                        busy={files.isFetching}
                        onChange={(p) => setPage('filePage', p)}
                      />
                    </>
                  ) : (
                    <AssetEmpty title={t('assets.noFiles')} />
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>{t('assets.related')}</CardTitle>
                </CardHeader>
                <CardContent className='flex flex-col gap-3'>
                  {related.error && related.data && !terminal(related.error) ? (
                    <AssetError
                      error={related.error}
                      retry={() => void related.refetch()}
                    />
                  ) : null}
                  {related.isPending ? (
                    <LoadingRows />
                  ) : related.error &&
                    (!related.data || terminal(related.error)) ? (
                    <AssetError
                      error={related.error}
                      retry={() => void related.refetch()}
                    />
                  ) : (
                    <>
                      {related.data?.data.merchants.map((b) => (
                        <p key={b.id}>
                          <span>
                            {b.merchant.name} · {b.merchant.number}
                          </span>{' '}
                          · {b.start} — {b.end || '—'}
                        </p>
                      ))}
                      {related.data?.data.contracts.map((c) => (
                        <p key={c.id}>
                          <span>{c.number}</span> · {c.start} — {c.end}
                        </p>
                      ))}
                      {related.data?.data.restricted ? (
                        <p className='text-sm text-muted-foreground'>
                          {t('assets.relatedRestricted')}
                        </p>
                      ) : null}
                      {!related.data?.data.restricted &&
                      !related.data?.data.merchants.length &&
                      !related.data?.data.contracts.length ? (
                        <p className='text-sm text-muted-foreground'>
                          {t('assets.noRelated')}
                        </p>
                      ) : null}
                    </>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>{t('assets.history')}</CardTitle>
                </CardHeader>
                <CardContent className='flex flex-col gap-4'>
                  {history.error && history.data && !terminal(history.error) ? (
                    <AssetError
                      error={history.error}
                      retry={() => void history.refetch()}
                    />
                  ) : null}
                  {history.isPending ? (
                    <LoadingRows />
                  ) : history.error &&
                    (!history.data || terminal(history.error)) ? (
                    <AssetError
                      error={history.error}
                      retry={() => void history.refetch()}
                    />
                  ) : (
                    <>
                      {history.data?.data.length === 0 ? (
                        <AssetEmpty title={t('assets.noHistory')} />
                      ) : null}
                      {history.data?.data.map((h) => (
                        <article
                          className='flex flex-col gap-2 border-b pb-4'
                          key={h.id}
                        >
                          <p>
                            {t(`assets.actions.${h.action}`)} · {h.actor} ·{' '}
                            {new Intl.DateTimeFormat(i18n.language, {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            }).format(new Date(h.createdAt))}
                          </p>
                          {h.reason ? (
                            <LongText className='text-sm'>{h.reason}</LongText>
                          ) : null}
                          {Object.keys(h.after)
                            .filter(
                              (k) =>
                                !['version', 'updatedAt', 'createdAt'].includes(
                                  k,
                                ) &&
                                JSON.stringify(h.before?.[k]) !==
                                  JSON.stringify(h.after[k]),
                            )
                            .map((k) => (
                              <p
                                key={k}
                                className='break-words text-sm text-muted-foreground'
                              >
                                {i18n.exists(`assets.fields.${k}`)
                                  ? t(`assets.fields.${k}`)
                                  : i18n.exists(`hyl.fields.${k}`)
                                    ? t(`hyl.fields.${k}`)
                                    : k}
                                :{' '}
                                <LongText>
                                  {show(k, h.before?.[k])} →{' '}
                                  {show(k, h.after[k])}
                                </LongText>
                              </p>
                            ))}
                        </article>
                      ))}
                      {history.data ? (
                        <Pager
                          page={page}
                          total={history.data.meta.total}
                          busy={history.isFetching}
                          onChange={(p) => setPage('historyPage', p)}
                        />
                      ) : null}
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : null}
        </PageContainer>
      </RouteChildPage>
      <Outlet />
      {preview ? (
        <FilePreviewDialog
          files={[preview]}
          open
          onOpenChange={(v) => {
            if (!v) setPreview(undefined);
          }}
          onError={(error) => {
            setFileError(error);
            setPreview(undefined);
          }}
        />
      ) : null}
    </>
  );
}
