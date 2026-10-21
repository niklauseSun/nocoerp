import { useScopedQuery as useQuery } from '#hooks/use-scoped-query';
import { Badge } from '#components/ui/badge';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useAssetPermission, useAssetTree } from './hooks.js';
import { Link, Outlet, useSearchParams } from 'react-router';
import { useApiClient, ApiClientError } from '@nocobase/app-client';
import { useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '#components/ui/card';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '#components/ui/table';
import { Choice, LoadingRows, Refresh } from '../hyl/common.js';
import { AssetError, Pager, AssetEmpty } from './shared.js';
import { types, type Asset, type List } from './model.js';
export default function Assets() {
  const { t, i18n } = useTranslation(),
    api = useApiClient(),
    client = useQueryClient(),
    can = useAssetPermission('write');
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const query = {
    q: params.get('q') || '',
    type: params.get('type') || '',
    state: params.get('state') || '',
    occupancy: params.get('occupancy') || '',
    orderBy: params.get('orderBy') || 'updatedAt:desc',
    page,
    pageSize: 20,
    ...(params.has('parentId') ? { parentId: params.get('parentId')! } : {}),
  };
  const result = useQuery({
    queryKey: ['hyl', 'assets', query],
    queryFn: () => api.request<List<Asset>>({ path: 'assets', query }),
    retry: false,
    placeholderData: keepPreviousData,
  });
  const [searchDraft, setSearchDraft] = useState({
    base: query.q,
    text: query.q,
  });
  const [composing, setComposing] = useState(false);
  const tree = useAssetTree();
  const update = (key: string, value: string) =>
    setParams((old) => {
      const p = new URLSearchParams(old);
      if (value) p.set(key, value);
      else p.delete(key);
      if (key !== 'page') p.delete('page');
      return p;
    });
  useEffect(() => {
    if (
      composing ||
      searchDraft.base !== query.q ||
      searchDraft.text === query.q
    )
      return;
    const timer = setTimeout(() => {
      setParams((old) => {
        const p = new URLSearchParams(old);
        if (searchDraft.text) p.set('q', searchDraft.text);
        else p.delete('q');
        p.delete('page');
        return p;
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [composing, searchDraft, query.q, setParams]);
  const inaccessible =
    result.error instanceof ApiClientError &&
    [401, 403, 404].includes(result.error.status);
  const renderTree = (parent: string | null, depth = 0): React.ReactNode =>
    tree.rows
      .filter((a) =>
        parent === null
          ? a.parentId === null ||
            !tree.rows.some((node) => node.id === a.parentId)
          : a.parentId === parent,
      )
      .map((a) => (
        <li key={a.id}>
          <div className='flex items-start gap-1'>
            {tree.rows.some((child) => child.parentId === a.id) ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size='icon'
                      variant='ghost'
                      aria-label={t('assets.toggleTree', { name: a.name })}
                      aria-expanded={!collapsed.includes(a.id)}
                      onClick={() =>
                        setCollapsed((old) =>
                          old.includes(a.id)
                            ? old.filter((id) => id !== a.id)
                            : [...old, a.id],
                        )
                      }
                    />
                  }
                >
                  {collapsed.includes(a.id) ? (
                    <ChevronRight />
                  ) : (
                    <ChevronDown />
                  )}
                </TooltipTrigger>
                <TooltipContent>
                  {t('assets.toggleTree', { name: a.name })}
                </TooltipContent>
              </Tooltip>
            ) : null}
            <Button
              variant={params.get('parentId') === a.id ? 'secondary' : 'ghost'}
              className='h-auto w-full justify-start whitespace-normal text-left'
              nativeButton={!['unit', 'stall'].includes(a.type)}
              render={
                ['unit', 'stall'].includes(a.type) ? (
                  <Link to={{ pathname: a.id, search: params.toString() }} />
                ) : undefined
              }
              onClick={() => {
                if (!['unit', 'stall'].includes(a.type))
                  update('parentId', a.id);
              }}
            >
              {t(`assets.types.${a.type}`)} · {a.name}
            </Button>
          </div>
          {depth < 5 && !collapsed.includes(a.id) ? (
            <ul className='ml-3 border-l pl-2'>
              {renderTree(a.id, depth + 1)}
            </ul>
          ) : null}
        </li>
      ));
  return (
    <>
      <PageContainer>
        <PageHeader
          title={t('assets.title')}
          description={t('assets.description')}
          actions={
            <div className='flex gap-2'>
              {can.can &&
              !result.isPending &&
              !(
                result.data?.meta.total === 0 &&
                !query.q &&
                !query.type &&
                !query.state &&
                !query.occupancy &&
                !query.parentId
              ) ? (
                <Button
                  nativeButton={false}
                  render={
                    <Link to={{ pathname: 'new', search: params.toString() }} />
                  }
                >
                  {t('assets.create')}
                </Button>
              ) : null}
              <Refresh
                busy={result.isFetching || tree.isFetching}
                onClick={() =>
                  void client.invalidateQueries({ queryKey: ['hyl'] })
                }
              />
            </div>
          }
        />
        <div className='grid items-start gap-6 lg:grid-cols-[16rem_1fr]'>
          <Card>
            <CardHeader>
              <CardTitle>{t('assets.tree')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Button variant='ghost' onClick={() => update('parentId', '')}>
                {t('assets.all')}
              </Button>
              {tree.isPending ? (
                <LoadingRows />
              ) : tree.error ? (
                <AssetError
                  error={tree.error}
                  retry={() => void tree.refetch()}
                />
              ) : (
                <ul>{renderTree(null)}</ul>
              )}
              {tree.hasNextPage ? (
                <Button
                  variant='outline'
                  disabled={tree.isFetchingNextPage}
                  onClick={() => void tree.fetchNextPage()}
                >
                  {t('assets.more')}
                </Button>
              ) : null}
            </CardContent>
          </Card>
          <div className='flex min-w-0 flex-col gap-4'>
            <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
              <Input
                aria-label={t('assets.search')}
                placeholder={t('assets.search')}
                value={
                  searchDraft.base === query.q ? searchDraft.text : query.q
                }
                onCompositionStart={() => setComposing(true)}
                onCompositionEnd={(e) => {
                  setComposing(false);
                  setSearchDraft({
                    base: query.q,
                    text: e.currentTarget.value,
                  });
                }}
                onChange={(e) =>
                  setSearchDraft({ base: query.q, text: e.target.value })
                }
              />
              <Choice
                ariaLabel={t('assets.fields.type')}
                value={query.type}
                onChange={(v) => update('type', v)}
                options={[
                  { value: '', label: t('assets.allTypes') },
                  ...types.map((value) => ({
                    value,
                    label: t(`assets.types.${value}`),
                  })),
                ]}
              />
              <Choice
                ariaLabel={t('assets.fields.state')}
                value={query.state}
                onChange={(v) => update('state', v)}
                options={[
                  { value: '', label: t('assets.allStates') },
                  ...['normal', 'maintenance', 'inactive'].map((value) => ({
                    value,
                    label: t(`assets.states.${value}`),
                  })),
                ]}
              />
              <Choice
                ariaLabel={t('assets.occupancy')}
                value={query.occupancy}
                onChange={(v) => update('occupancy', v)}
                options={[
                  { value: '', label: t('assets.allOccupancy') },
                  ...['occupied', 'vacant'].map((value) => ({
                    value,
                    label: t(`assets.${value}`),
                  })),
                ]}
              />
            </div>
            <div className='flex flex-wrap items-center gap-2'>
              <div className='w-full min-w-0 sm:w-48 sm:shrink-0'>
                <Choice
                  ariaLabel={t('assets.sort')}
                  value={query.orderBy}
                  onChange={(v) => update('orderBy', v)}
                  options={[
                    'number:asc',
                    'name:asc',
                    'area:asc',
                    'area:desc',
                    'updatedAt:desc',
                  ].map((value) => ({
                    value,
                    label: `${t(`assets.fields.${value.split(':')[0]}`)} ${value.endsWith('asc') ? '↑' : '↓'}`,
                  }))}
                />
              </div>
              <Button
                variant='ghost'
                onClick={() => {
                  setSearchDraft({ base: '', text: '' });
                  setParams({});
                }}
              >
                {t('assets.clear')}
              </Button>
            </div>
            {result.error && result.data && !inaccessible ? (
              <AssetError
                error={result.error}
                retry={() => void result.refetch()}
              />
            ) : null}
            {result.isPending ? (
              <LoadingRows />
            ) : result.error && (!result.data || inaccessible) ? (
              <AssetError
                error={result.error}
                retry={() => void result.refetch()}
              />
            ) : !result.data?.data.length ? (
              <AssetEmpty
                title={t(
                  query.q ||
                    query.type ||
                    query.state ||
                    query.occupancy ||
                    query.parentId
                    ? 'assets.noMatches'
                    : 'assets.noAssets',
                )}
                description={t(
                  query.q ||
                    query.type ||
                    query.state ||
                    query.occupancy ||
                    query.parentId
                    ? 'assets.filterHelp'
                    : can.can
                      ? 'assets.emptyHelp'
                      : 'assets.readerEmptyHelp',
                )}
                action={
                  can.can &&
                  !query.q &&
                  !query.type &&
                  !query.state &&
                  !query.occupancy &&
                  !query.parentId ? (
                    <Button
                      nativeButton={false}
                      render={
                        <Link
                          to={{ pathname: 'new', search: params.toString() }}
                        />
                      }
                    >
                      {t('assets.create')}
                    </Button>
                  ) : query.q ||
                    query.type ||
                    query.state ||
                    query.occupancy ||
                    query.parentId ? (
                    <Button
                      variant='outline'
                      onClick={() => {
                        setSearchDraft({ base: '', text: '' });
                        setParams({});
                      }}
                    >
                      {t('assets.clear')}
                    </Button>
                  ) : null
                }
              />
            ) : (
              <div className='overflow-x-auto rounded-lg border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      {[
                        'number',
                        'name',
                        'type',
                        'area',
                        'state',
                        'updatedAt',
                      ].map((k) => (
                        <TableHead
                          key={k}
                          aria-sort={
                            query.orderBy.startsWith(`${k}:`)
                              ? query.orderBy.endsWith('asc')
                                ? 'ascending'
                                : 'descending'
                              : undefined
                          }
                        >
                          {['number', 'name', 'area', 'updatedAt'].includes(
                            k,
                          ) ? (
                            <Button
                              variant='ghost'
                              onClick={() =>
                                update(
                                  'orderBy',
                                  `${k}:${query.orderBy === `${k}:asc` ? 'desc' : 'asc'}`,
                                )
                              }
                            >
                              {t(`assets.fields.${k}`)}
                              {query.orderBy.startsWith(`${k}:`)
                                ? query.orderBy.endsWith('asc')
                                  ? ' ↑'
                                  : ' ↓'
                                : ''}
                            </Button>
                          ) : (
                            t(`assets.fields.${k}`)
                          )}
                        </TableHead>
                      ))}
                      <TableHead>{t('assets.occupancy')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.data.data.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>
                          <Link
                            className='underline underline-offset-4'
                            to={{ pathname: a.id, search: params.toString() }}
                          >
                            {a.number}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger className='max-w-48 truncate text-left'>
                              {a.name}
                            </TooltipTrigger>
                            <TooltipContent>{a.name}</TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell>
                          <Badge variant='secondary'>
                            {t(`assets.types.${a.type}`)}
                          </Badge>
                        </TableCell>
                        <TableCell className='text-right tabular-nums'>
                          {new Intl.NumberFormat(i18n.language, {
                            maximumFractionDigits: 2,
                          }).format(Number(a.area))}
                        </TableCell>
                        <TableCell>
                          <Badge variant='outline'>
                            {t(`assets.states.${a.state}`)}
                          </Badge>
                        </TableCell>
                        <TableCell className='whitespace-nowrap'>
                          {new Intl.DateTimeFormat(i18n.language, {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          }).format(new Date(a.updatedAt))}
                        </TableCell>
                        <TableCell>
                          {t(a.occupied ? 'assets.occupied' : 'assets.vacant')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {result.data ? (
              <Pager
                page={page}
                total={result.data.meta.total}
                busy={result.isFetching}
                onChange={(v) => update('page', String(v))}
              />
            ) : null}
          </div>
        </div>
      </PageContainer>
      <Outlet />
    </>
  );
}
