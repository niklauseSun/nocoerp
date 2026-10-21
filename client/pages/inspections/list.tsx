import { ResponsiveTable, MobileSort } from '#components/responsive-table';
import { ClipboardCheck } from 'lucide-react';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '#components/ui/empty';
import { Badge } from '#components/ui/badge';
import { str, endpoint, useInspectionCan } from './helpers.js';
import {
  Link,
  Outlet,
  useSearchParams,
  useResolvedPath,
  useLocation,
  useParams,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import { BackButton } from '#components/back-button';
import { RouteChildPage } from '#components/route-child-page';
import {
  Table,
  TableBody,
  TableHeader,
  TableRow,
  TableHead,
  TableCell,
} from '#components/ui/table';
import { useBusinessQuery } from '../hyl/hooks.js';
import { useCoverFocus } from '../profit-sharing/focus.js';
import {
  Choice,
  Search,
  Paged,
  BillingError,
  LoadingRows,
  Refresh,
  Truncated,
  RecordedAt,
  Day,
  State,
  type Page,
  type Row,
  type Kind,
} from './common.js';
export default function List({
  kind,
  scope,
}: {
  kind: Kind;
  scope?: 'asset' | 'plan' | 'task' | 'repair';
}) {
  useCoverFocus();
  const { t } = useTranslation(),
    [q, setQ] = useSearchParams(),
    path = useResolvedPath('.').pathname,
    l = useLocation(),
    p = useParams(),
    read = useInspectionCan('read'),
    manage = useInspectionCan('manage');
  const key = 'inspection' + kind,
    get = (k: string) => q.get(key + k) || '',
    change = (k: string, v: string) => {
      const n = new URLSearchParams(q);
      n.delete(key + 'page');
      if (v) n.set(key + k, v);
      else n.delete(key + k);
      setQ(n, { replace: true });
    };
  const scopeId =
    scope === 'asset'
      ? p.id
      : scope === 'repair'
        ? p.repairId
        : scope === 'plan'
          ? p.inspectionPlanId
          : p.inspectionTaskId;
  const query = {
    q: get('q'),
    status: get('status'),
    type: get('type'),
    mine: get('mine'),
    order: get('order') || '-updatedAt',
    page: Number(get('page')) || 1,
    pageSize: 20,
    ...(scope ? { [scope + 'Id']: scopeId ?? '' } : {}),
  };
  const result = useBusinessQuery<Page<Row>>(endpoint(kind), query, read.can),
    rows = result.data?.data;
  const filtered = !!(query.q || query.status || query.type || query.mine),
    clear = () => {
      const n = new URLSearchParams(q);
      for (const k of [...n.keys()]) if (k.startsWith(key)) n.delete(k);
      setQ(n, { replace: true });
    };
  const create = (
    <Button
      nativeButton={false}
      render={<Link to={{ pathname: path + '/new', search: l.search }} />}
    >
      {t('inspection.new')}
    </Button>
  );
  const states =
    kind === 'plans'
      ? ['draft', 'active', 'paused', 'archived']
      : kind === 'tasks'
        ? ['assigned', 'running', 'pendingReview', 'completed', 'cancelled']
        : ['open', 'returned', 'pendingReview', 'closed'];
  const sort = (k: string) => (
    <TableHead
      aria-sort={
        query.order === k
          ? 'ascending'
          : query.order === '-' + k
            ? 'descending'
            : 'none'
      }
    >
      <Button
        variant='ghost'
        onClick={() => change('order', query.order === k ? '-' + k : k)}
      >
        {t('inspection.fields.' + k)}
        {query.order === k ? ' ↑' : query.order === '-' + k ? ' ↓' : ''}
      </Button>
    </TableHead>
  );
  const content = (
    <PageContainer>
      {scope ? (
        <BackButton
          to={{
            pathname: path.slice(0, path.lastIndexOf('/')),
            search: l.search,
          }}
        />
      ) : null}
      <PageHeader
        title={t('inspection.' + kind)}
        description={t('inspection.description')}
        actions={
          <>
            {kind === 'plans' && manage.can && rows && (rows.length || filtered)
              ? create
              : null}
            <Refresh
              busy={result.isFetching}
              onClick={() => void result.refetch()}
            />
          </>
        }
      />
      {!scope ? (
        <nav
          className='flex flex-wrap gap-2'
          aria-label={t('inspection.title')}
        >
          {['plans', 'tasks', 'issues', 'scheduling'].map((k) => (
            <Button
              key={k}
              variant={k === kind ? 'secondary' : 'outline'}
              nativeButton={false}
              render={
                <Link
                  to={{
                    pathname: path.slice(0, path.lastIndexOf('/')) + '/' + k,
                    search: l.search,
                  }}
                />
              }
            >
              {t('inspection.' + k)}
            </Button>
          ))}
        </nav>
      ) : null}
      <div className='flex flex-wrap items-center gap-2'>
        <Search
          value={query.q}
          onChange={(v) => change('q', v)}
          placeholder={t('inspection.search')}
        />
        {[
          ['type', ['inspection', 'security', 'cleaning'], 'types'],
          ['status', states, 'states'],
        ].map(([k, vs, g]) => (
          <div key={str(k)} className='w-full min-w-0 sm:w-40 sm:shrink-0'>
            <Choice
              showMobileLabel
              ariaLabel={t('inspection.fields.' + str(k))}
              value={get(str(k))}
              onChange={(v) => change(str(k), v)}
              options={[
                { value: '', label: t('inspection.all') },
                ...(vs as string[]).map((v) => ({
                  value: v,
                  label: t('inspection.' + str(g) + '.' + v),
                })),
              ]}
            />
          </div>
        ))}
        <Button
          variant={query.mine ? 'secondary' : 'outline'}
          aria-pressed={!!query.mine}
          onClick={() => change('mine', query.mine ? '' : 'true')}
        >
          {t('inspection.mine')}
        </Button>
        {filtered ? (
          <Button variant='outline' onClick={clear}>
            {t('inspection.clear')}
          </Button>
        ) : null}
      </div>
      {!read.can ? (
        <p>{t('inspection.restricted')}</p>
      ) : result.error ? (
        <BillingError
          error={result.error}
          retry={() => void result.refetch()}
        />
      ) : !rows ? (
        <LoadingRows />
      ) : !rows.length ? (
        <Empty className='min-h-48 border border-dashed'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <ClipboardCheck />
            </EmptyMedia>
            <EmptyTitle>
              {t(filtered ? 'inspection.noResults' : 'inspection.empty')}
            </EmptyTitle>
            <EmptyDescription>
              {t(
                filtered
                  ? 'inspection.noResultsHelp'
                  : !manage.can
                    ? 'inspection.emptyReadOnly'
                    : kind === 'plans'
                      ? 'inspection.emptyHelp'
                      : kind === 'tasks'
                        ? 'inspection.emptyTasks'
                        : 'inspection.emptyIssues',
              )}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {filtered ? (
              <Button variant='outline' onClick={clear}>
                {t('inspection.clear')}
              </Button>
            ) : kind === 'plans' && manage.can ? (
              create
            ) : null}
          </EmptyContent>
        </Empty>
      ) : (
        <>
          {result.isFetching ? (
            <p role='status' className='text-sm text-muted-foreground'>
              {t('inspection.refreshing')}
            </p>
          ) : null}
          <ResponsiveTable
            labels={[
              'number',
              'title',
              'type',
              'assetName',
              'status',
              'assigneeName',
              'day',
              'dueOn',
              'updatedAt',
            ]
              .map((k) => t('inspection.fields.' + k))
              .concat(t('mobile.actions'))}
            sort={
              <MobileSort
                value={query.order}
                onChange={(v) => change('order', v)}
                fields={['number', 'day', 'dueOn', 'updatedAt'].map((k) => ({
                  value: k,
                  label: t('inspection.fields.' + k),
                }))}
              />
            }
          >
            <Table>
              <TableHeader>
                <TableRow>
                  {sort('number')}
                  <TableHead>{t('inspection.fields.title')}</TableHead>
                  <TableHead>{t('inspection.fields.type')}</TableHead>
                  <TableHead>{t('inspection.fields.assetName')}</TableHead>
                  <TableHead>{t('inspection.fields.status')}</TableHead>
                  <TableHead>{t('inspection.fields.assigneeName')}</TableHead>
                  {sort('day')}
                  {sort('dueOn')}
                  {sort('updatedAt')}
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        className='underline'
                        aria-disabled={result.isPlaceholderData}
                        onClick={(e) => {
                          if (result.isPlaceholderData) e.preventDefault();
                        }}
                        to={{ pathname: path + '/' + r.id, search: l.search }}
                      >
                        {r.number}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Truncated>{r.title}</Truncated>
                    </TableCell>
                    <TableCell>
                      <Badge variant='secondary'>
                        {t('inspection.types.' + r.type)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Truncated>
                        {str(r.payload.assetName) ||
                          ((r.payload.assets ?? []) as { name: string }[])
                            .map((a) => a.name)
                            .join('、')}
                      </Truncated>
                    </TableCell>
                    <TableCell>
                      <State value={r.status} />
                      {r.overdue ? <p>{t('inspection.overdue')}</p> : null}
                    </TableCell>
                    <TableCell>{str(r.payload.assigneeName) || '—'}</TableCell>
                    <TableCell>
                      <Day value={r.day} />
                    </TableCell>
                    <TableCell>
                      <Day value={r.dueOn} />
                    </TableCell>
                    <TableCell>
                      <RecordedAt value={r.updatedAt} />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant='ghost'
                        disabled={result.isPlaceholderData}
                        nativeButton={false}
                        render={
                          <Link
                            to={{
                              pathname: path + '/' + r.id,
                              search: l.search,
                            }}
                          />
                        }
                      >
                        {t('inspection.view')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ResponsiveTable>
          <Paged
            meta={result.data!.meta}
            busy={result.isFetching}
            onChange={(v) => change('page', String(v))}
          />
        </>
      )}
      <Outlet />
    </PageContainer>
  );
  return scope ? <RouteChildPage>{content}</RouteChildPage> : content;
}
