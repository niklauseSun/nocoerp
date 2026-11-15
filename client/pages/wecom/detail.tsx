import { useWrite, useWecom, useAction } from './hooks.js';
import { useState } from 'react';
import { ApiClientError } from '@nocobase/app-client';
import { useCoverFocus } from '../profit-sharing/focus.js';
import { useParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { RouteChildPage } from '#components/route-child-page';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { Button } from '#components/ui/button';
import { Badge } from '#components/ui/badge';
import { Spinner } from '#components/ui/spinner';
import { RefreshCw } from 'lucide-react';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import { DataTable } from '#components/data-table';
import {
  ErrorBox,
  LoadingRows,
  Group,
  Confirm,
  type Preview,
} from './common.js';
export default function Detail() {
  useCoverFocus();
  const { id } = useParams(),
    { t, i18n } = useTranslation(),
    r = useWecom<{ data: Preview }>(
      'wecom/mappings/' + id,
      undefined,
      true,
      'always',
    ),
    write = useWrite(),
    a = useAction(),
    [confirm, setConfirm] = useState<'pull' | 'push' | null>(null),
    [fingerprint, setFingerprint] = useState('');
  const denied =
    r.error instanceof ApiClientError &&
    [401, 403, 404].includes(r.error.status);
  const p = denied ? undefined : r.data?.data,
    blocked = p && ['busy', 'unknown'].includes(p.mapping.state);
  return (
    <RouteChildPage>
      <PageContainer>
        <BackButton />
        <PageHeader
          title={p?.local?.name || p?.remote?.name || t('wecom.identity')}
          description={t('wecom.compareHelp')}
          actions={
            <>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant='outline'
                      size='icon'
                      aria-label={t('hyl.actions.refresh')}
                      disabled={r.isFetching || a.busy}
                      onClick={() => void r.refetch()}
                    />
                  }
                >
                  <RefreshCw className={r.isFetching ? 'animate-spin' : ''} />
                </TooltipTrigger>
                <TooltipContent>{t('hyl.actions.refresh')}</TooltipContent>
              </Tooltip>
            </>
          }
        />
        <ErrorBox error={r.error} retry={() => void r.refetch()} />
        {!p ? (
          !r.error ? (
            <LoadingRows />
          ) : null
        ) : (
          <>
            <Group
              title={t('wecom.comparison')}
              description={t(
                blocked ? 'wecom.reconcileHelp' : 'wecom.compareHelp',
              )}
            >
              <div className='flex flex-wrap items-center gap-2'>
                <Badge>{t('wecom.states.' + p.mapping.state)}</Badge>
                <Badge variant='outline'>
                  {t('wecom.directions.' + p.suggested)}
                </Badge>
              </div>
              <p className='break-all text-sm'>
                {t('wecom.local')}: {p.mapping.localId} / {t('wecom.remote')}:{' '}
                {p.mapping.remoteId}
              </p>
              <div className='grid gap-4 md:grid-cols-3'>
                {(
                  [
                    'baseline',
                    'local',
                    'remote',
                    ...(blocked ? ['intent' as const] : []),
                  ] as const
                ).map((key) => {
                  const value =
                    key === 'baseline'
                      ? p.mapping.baseline
                      : key === 'intent'
                        ? p.mapping.intent
                        : p[key];
                  return (
                    <section key={key} className='flex min-w-0 flex-col gap-2'>
                      <h2 className='text-base font-medium'>
                        {t('wecom.' + key)}
                      </h2>
                      {value ? (
                        <dl className='flex flex-col gap-2'>
                          {Object.entries(value).map(([field, v]) => (
                            <div key={field}>
                              <dt className='text-sm text-muted-foreground'>
                                {t('wecom.fields.' + field)}
                              </dt>
                              <dd className='break-all text-sm'>
                                {typeof v === 'boolean'
                                  ? t(v ? 'wecom.on' : 'wecom.off')
                                  : Array.isArray(v)
                                    ? v.join(', ')
                                    : v || '—'}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <p className='text-sm text-muted-foreground'>
                          {t('wecom.absent')}
                        </p>
                      )}
                    </section>
                  );
                })}
              </div>
              {write ? (
                <div className='flex flex-wrap gap-2'>
                  {blocked ? (
                    <Button
                      variant='outline'
                      disabled={a.busy || r.isFetching || !!r.error}
                      onClick={() =>
                        void a.run('wecom/mappings/' + id + '/reconcile', {})
                      }
                    >
                      {a.busy ? <Spinner /> : null}
                      {t('wecom.reconcile')}
                    </Button>
                  ) : (
                    <>
                      {(['pull', 'push'] as const).map((way) => (
                        <Button
                          key={way}
                          variant='outline'
                          disabled={
                            a.busy ||
                            r.isFetching ||
                            !!r.error ||
                            !(way === 'pull' ? p.remote : p.local)
                          }
                          onClick={() => {
                            setFingerprint(p.fingerprint);
                            setConfirm(way);
                          }}
                        >
                          {t('wecom.' + way)}
                        </Button>
                      ))}
                    </>
                  )}
                </div>
              ) : null}
              <ErrorBox error={!confirm ? a.error : undefined} />
            </Group>
            <Group
              title={t('wecom.history')}
              description={t('wecom.historyHelp')}
            >
              <DataTable
                data={p.history}
                pagination={false}
                getRowId={(x) => x.id}
                label={t('wecom.history')}
                emptyMessage={t('wecom.noHistory')}
                columns={[
                  {
                    accessorKey: 'at',
                    header: t('wecom.updatedAt'),
                    cell: ({ row }) =>
                      new Intl.DateTimeFormat(i18n.language, {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      }).format(new Date(row.original.at)),
                  },
                  {
                    accessorKey: 'direction',
                    header: t('wecom.direction'),
                    cell: ({ row }) =>
                      t('wecom.directions.' + row.original.direction),
                  },
                  {
                    accessorKey: 'result',
                    header: t('wecom.state'),
                    cell: ({ row }) => (
                      <Badge variant='outline'>
                        {t('wecom.states.' + row.original.result)}
                      </Badge>
                    ),
                  },
                  { accessorKey: 'actor', header: t('wecom.actor') },
                ]}
              />
            </Group>
            <Confirm
              open={!!confirm}
              title={t('wecom.confirm', {
                name: p.local?.name || p.remote?.name || p.mapping.remoteId,
              })}
              description={t(
                confirm === 'pull' ? 'wecom.pullHelp' : 'wecom.pushHelp',
              )}
              label={t(confirm === 'pull' ? 'wecom.pull' : 'wecom.push')}
              busy={a.busy}
              error={a.error}
              onCancel={() => setConfirm(null)}
              onConfirm={() => {
                if (confirm)
                  void a
                    .run('wecom/mappings/' + id + '/sync', {
                      direction: confirm,
                      fingerprint,
                    })
                    .then((ok) => {
                      if (ok) setConfirm(null);
                    });
              }}
            />
          </>
        )}
      </PageContainer>
    </RouteChildPage>
  );
}
