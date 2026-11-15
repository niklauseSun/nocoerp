import { useWrite, useWecom, useAction } from './hooks.js';
import { Link, Outlet, useLocation, useSearchParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { RefreshCw, MessagesSquare } from 'lucide-react';
import { ApiClientError } from '@nocobase/app-client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import { Badge } from '#components/ui/badge';
import { Spinner } from '#components/ui/spinner';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '#components/ui/empty';
import { DataTable } from '#components/data-table';
import {
  ErrorBox,
  LoadingRows,
  Truncated,
  Choice,
  Search,
  Paged,
  Group,
  type Mapping,
} from './common.js';
export default function Wecom() {
  const { t, i18n } = useTranslation(),
    [q, setQ] = useSearchParams(),
    l = useLocation(),
    write = useWrite(),
    a = useAction();
  const page = Math.max(1, Number(q.get('page')) || 1),
    kind = q.get('kind') || '',
    search = q.get('q') || '',
    order = q.get('order') === 'asc' ? 'asc' : 'desc';
  const r = useWecom<{
    data: {
      configuration: {
        enabled: boolean;
        corpId: string;
        agentId: string;
        directoryRead: boolean;
        directoryWrite: boolean;
        messages: boolean;
        autoSync: boolean;
      };
      items: Mapping[];
      total: number;
    };
  }>('wecom', { page, kind, q: search, order });
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(q);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setQ(next, { replace: true });
  };
  const forbidden =
      r.error instanceof ApiClientError && [401, 403].includes(r.error.status),
    data = forbidden ? undefined : r.data?.data;
  const add =
    write && data?.configuration.enabled ? (
      <Button
        nativeButton={false}
        render={<Link to={{ pathname: 'new', search: l.search }} />}
      >
        {t('wecom.new')}
      </Button>
    ) : null;
  return (
    <>
      <PageContainer>
        <PageHeader
          title={t('wecom.title')}
          description={t('wecom.description')}
          actions={
            <>
              {data?.items.length || search || kind ? add : null}
              {write ? (
                <Button
                  variant='outline'
                  disabled={a.busy || !data?.configuration.enabled}
                  onClick={() => void a.run('wecom/check', {})}
                >
                  {a.busy ? <Spinner /> : null}
                  {t('wecom.check')}
                </Button>
              ) : null}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant='outline'
                      size='icon'
                      aria-label={t('hyl.actions.refresh')}
                      disabled={r.isFetching}
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
        <ErrorBox error={a.error} />
        {!data ? (
          !r.error ? (
            <LoadingRows />
          ) : null
        ) : (
          <>
            <Group
              title={t('wecom.connection')}
              description={t('wecom.configHelp')}
            >
              <dl className='grid gap-3 sm:grid-cols-2'>
                {Object.entries(data.configuration).map(([key, value]) => (
                  <div key={key}>
                    <dt className='text-sm text-muted-foreground'>
                      {t('wecom.config.' + key)}
                    </dt>
                    <dd className='break-all text-sm'>
                      {typeof value === 'boolean'
                        ? t(value ? 'wecom.on' : 'wecom.off')
                        : value || '—'}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className='text-sm text-muted-foreground'>
                {t('wecom.scopeHelp')}
              </p>
              <p className='text-sm text-muted-foreground'>
                {t('wecom.configKeys')}
              </p>
            </Group>
            <div className='flex flex-wrap gap-2'>
              <Search
                value={search}
                placeholder={t('wecom.search')}
                onChange={(v) => set('q', v)}
              />
              <Choice
                value={kind}
                onChange={(v) => set('kind', v)}
                ariaLabel={t('wecom.kind')}
                options={['', 'department', 'user'].map((value) => ({
                  value,
                  label: t('wecom.' + (value || 'all')),
                }))}
              />
              {search || kind ? (
                <Button
                  variant='outline'
                  onClick={() => {
                    const next = new URLSearchParams(q);
                    next.delete('q');
                    next.delete('kind');
                    next.delete('page');
                    setQ(next);
                  }}
                >
                  {t('wecom.clear')}
                </Button>
              ) : null}
            </div>
            {data.items.length ? (
              <DataTable
                pagination={false}
                data={data.items}
                getRowId={(m) => m.id}
                label={t('wecom.title')}
                emptyMessage={t('wecom.empty')}
                columns={[
                  {
                    id: 'identity',
                    header: t('wecom.identity'),
                    cell: ({ row: { original: m } }) => (
                      <Link
                        className='underline underline-offset-4'
                        to={{ pathname: m.id, search: l.search }}
                      >
                        <Truncated>{m.baseline?.name || m.remoteId}</Truncated>
                        <span className='block text-xs text-muted-foreground'>
                          <Truncated>
                            {m.localId + ' / ' + m.remoteId}
                          </Truncated>
                        </span>
                      </Link>
                    ),
                  },
                  {
                    accessorKey: 'kind',
                    header: t('wecom.kind'),
                    cell: ({ row }) => (
                      <Badge variant='secondary'>
                        {t('wecom.' + row.original.kind)}
                      </Badge>
                    ),
                  },
                  {
                    accessorKey: 'state',
                    header: t('wecom.state'),
                    cell: ({ row }) => (
                      <Badge variant='outline'>
                        {t('wecom.states.' + row.original.state)}
                      </Badge>
                    ),
                  },
                  {
                    id: 'updatedAt',
                    header: () => (
                      <Button
                        variant='ghost'
                        onClick={() =>
                          set('order', order === 'asc' ? 'desc' : 'asc')
                        }
                      >
                        {t('wecom.updatedAt')} {order === 'asc' ? '↑' : '↓'}
                      </Button>
                    ),
                    cell: ({ row }) =>
                      new Intl.DateTimeFormat(i18n.language, {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      }).format(new Date(row.original.updatedAt)),
                  },
                ]}
              />
            ) : (
              <Empty className='min-h-48 border border-dashed'>
                <EmptyHeader>
                  <EmptyMedia variant='icon'>
                    <MessagesSquare />
                  </EmptyMedia>
                  <EmptyTitle>
                    {t(search || kind ? 'wecom.noResults' : 'wecom.empty')}
                  </EmptyTitle>
                  <EmptyDescription>{t('wecom.emptyHelp')}</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>{!search && !kind ? add : null}</EmptyContent>
              </Empty>
            )}
            <Paged
              meta={{ page, pageSize: 20, total: data.total }}
              busy={r.isFetching}
              onChange={(p) => set('page', String(p))}
            />
          </>
        )}
      </PageContainer>
      <Outlet />
    </>
  );
}
