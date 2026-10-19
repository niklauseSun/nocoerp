import { ResponsiveTable, MobileSort } from '#components/responsive-table';
import { Spinner } from '#components/ui/spinner';
import { Badge } from '#components/ui/badge';
import { useBusinessQuery, useCheck } from './hooks.js';
import { Bell, ArrowDown, ArrowUp } from 'lucide-react';
import { Link, Outlet, useSearchParams, useLocation } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { Button } from '#components/ui/button';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '#components/ui/table';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
  EmptyContent,
} from '#components/ui/empty';
import { useCoverFocus } from '../profit-sharing/focus.js';
import {
  Nav,
  State,
  Choice,
  Search,
  Paged,
  BillingError,
  LoadingRows,
  Refresh,
  Truncated,
  Day,
  RecordedAt,
  type Todo,
} from './common.js';
export default function List() {
  useCoverFocus();
  const { t } = useTranslation(),
    [q, setQ] = useSearchParams(),
    l = useLocation(),
    check = useCheck();
  const query = {
    q: q.get('q') || '',
    kind: q.get('kind') || '',
    status: q.get('status') || 'active',
    order: q.get('order') || '-updatedAt',
    page: Number(q.get('page')) || 1,
    pageSize: 20,
  };
  const r = useBusinessQuery<{
      data: Todo[];
      meta: { page: number; pageSize: number; total: number };
    }>('messageTodos', query),
    p = useBusinessQuery<{ data: { enabled: boolean } }>('messagePreferences'),
    rows = r.data?.data,
    filtered = !!(query.q || query.kind || query.status !== 'active');
  const change = (k: string, v: string) => {
      const n = new URLSearchParams(q);
      n.delete('page');
      if (v) n.set(k, v);
      else n.delete(k);
      setQ(n, { replace: true });
    },
    sort = (field: string) =>
      change('order', query.order === field ? '-' + field : field),
    refresh = () => {
      void r.refetch();
      void p.refetch();
    },
    primary = (
      <Button
        aria-busy={check.busy}
        disabled={check.busy || r.isFetching || !p.data?.data.enabled}
        onClick={() => void check.check()}
      >
        {check.busy ? <Spinner /> : null}
        {t('messages.check')}
      </Button>
    );
  return (
    <>
      <RouteChildPage>
        <PageContainer>
          <PageHeader
            title={t('messages.todos')}
            description={t('messages.todoDescription')}
            actions={
              <>
                {rows?.length || filtered ? primary : null}
                <Refresh
                  busy={r.isFetching || p.isFetching}
                  onClick={refresh}
                />
              </>
            }
          />
          <Nav />
          {p.data && !p.data.data.enabled ? (
            <p className='text-sm text-muted-foreground'>
              {t('messages.disabledHint')}
            </p>
          ) : null}
          {p.error ? <BillingError error={p.error} retry={refresh} /> : null}
          {check.error ? (
            <BillingError
              error={check.error}
              retry={() => void check.check()}
            />
          ) : null}
          <div className='flex flex-wrap items-end gap-3'>
            <Search
              value={query.q}
              onChange={(v) => change('q', v)}
              placeholder={t('messages.search')}
            />
            <div className='w-full sm:w-48'>
              <Choice
                showMobileLabel
                value={query.kind}
                onChange={(v) => change('kind', v)}
                ariaLabel={t('messages.allKinds')}
                options={[
                  { value: '', label: t('messages.allKinds') },
                  ...['contracts', 'bills', 'repairs', 'purchases'].map(
                    (v) => ({
                      value: v,
                      label: t('messages.kinds.' + v),
                    }),
                  ),
                ]}
              />
            </div>
            <div className='w-full sm:w-48'>
              <Choice
                showMobileLabel
                value={query.status}
                onChange={(v) => change('status', v)}
                ariaLabel={t('messages.allStates')}
                options={['active', 'resolved', 'all'].map((v) => ({
                  value: v,
                  label: t('messages.states.' + v),
                }))}
              />
            </div>
            {filtered ? (
              <Button variant='outline' onClick={() => setQ({})}>
                {t('messages.clear')}
              </Button>
            ) : null}
          </div>
          {r.error ? <BillingError error={r.error} retry={refresh} /> : null}
          {r.isPending ? (
            <LoadingRows />
          ) : rows?.length ? (
            <>
              <ResponsiveTable
                labels={[
                  'source',
                  'kind',
                  'reason',
                  'status',
                  'dueOn',
                  'updatedAt',
                  'action',
                ].map((k) => t('messages.' + k))}
                sort={
                  <MobileSort
                    value={query.order}
                    onChange={(v) => change('order', v)}
                    fields={['dueOn', 'updatedAt'].map((k) => ({
                      value: k,
                      label: t('messages.' + k),
                    }))}
                  />
                }
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('messages.source')}</TableHead>
                      <TableHead>{t('messages.kind')}</TableHead>
                      <TableHead>{t('messages.reason')}</TableHead>
                      <TableHead>{t('messages.status')}</TableHead>
                      {['dueOn', 'updatedAt'].map((k) => (
                        <TableHead
                          key={k}
                          aria-sort={
                            query.order.replace('-', '') === k
                              ? query.order.startsWith('-')
                                ? 'descending'
                                : 'ascending'
                              : 'none'
                          }
                        >
                          <Button variant='ghost' onClick={() => sort(k)}>
                            {t('messages.' + k)}
                            {query.order.replace('-', '') === k ? (
                              query.order.startsWith('-') ? (
                                <ArrowDown />
                              ) : (
                                <ArrowUp />
                              )
                            ) : null}
                          </Button>
                        </TableHead>
                      ))}
                      <TableHead>{t('messages.action')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <Link
                            className='font-medium underline underline-offset-4'
                            aria-disabled={r.isFetching}
                            onClick={(e) => {
                              if (r.isFetching) e.preventDefault();
                            }}
                            to={{
                              pathname: '/messageTodos/' + row.id,
                              search: l.search,
                            }}
                          >
                            <Truncated>
                              {row.number === row.title
                                ? row.number
                                : row.number + ' ' + row.title}
                            </Truncated>
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge variant='outline'>
                            {t('messages.kinds.' + row.kind)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Truncated>
                            {t('messages.reasons.' + row.reason)}
                          </Truncated>
                        </TableCell>
                        <TableCell>
                          <State value={row.status} />
                        </TableCell>
                        <TableCell>
                          <Day value={row.dueOn} />
                        </TableCell>
                        <TableCell>
                          <RecordedAt value={row.updatedAt} />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant='ghost'
                            disabled={r.isFetching}
                            nativeButton={false}
                            render={
                              <Link
                                to={{
                                  pathname: '/messageTodos/' + row.id,
                                  search: l.search,
                                }}
                              />
                            }
                          >
                            {t('messages.view')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ResponsiveTable>
              <Paged
                meta={r.data!.meta}
                busy={r.isFetching}
                onChange={(v) => {
                  const n = new URLSearchParams(q);
                  n.set('page', String(v));
                  setQ(n);
                }}
              />
            </>
          ) : !r.error ? (
            <Empty className='min-h-48 border border-dashed'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <Bell />
                </EmptyMedia>
                <EmptyTitle>
                  {t(filtered ? 'messages.noResults' : 'messages.empty')}
                </EmptyTitle>
                <EmptyDescription>
                  {t(
                    filtered ? 'messages.noResultsHelp' : 'messages.emptyHelp',
                  )}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>{!filtered ? primary : null}</EmptyContent>
            </Empty>
          ) : null}
        </PageContainer>
      </RouteChildPage>
      <Outlet />
    </>
  );
}
