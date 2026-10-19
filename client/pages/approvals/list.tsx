import { ClipboardCheck } from 'lucide-react';
import { useBusinessQuery, kinds } from './hooks.js';
import {
  Link,
  Outlet,
  useLocation,
  useSearchParams,
  useResolvedPath,
} from 'react-router';
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
  KindBadge,
  Nav,
  Choice,
  Search,
  Paged,
  BillingError,
  LoadingRows,
  Refresh,
  RecordedAt,
  State,
  Truncated,
  type Approval,
} from './common.js';
export default function List() {
  useCoverFocus();
  const { t } = useTranslation(),
    [q, setQ] = useSearchParams(),
    l = useLocation(),
    base = useResolvedPath('.').pathname,
    query = {
      q: q.get('q') || '',
      kind: q.get('kind') || '',
      status: q.get('status') || '',
      view: q.get('view') || 'pending',
      order: q.get('order') || '-updatedAt',
      page: Number(q.get('page')) || 1,
      pageSize: 20,
    },
    r = useBusinessQuery<{
      data: Approval[];
      meta: { page: number; pageSize: number; total: number };
    }>('approvalRequests', query),
    rows = r.error ? undefined : r.data?.data;
  const filtered = !!(
    query.q ||
    query.kind ||
    query.status ||
    query.view !== 'pending'
  );
  const change = (k: string, v: string) => {
    const n = new URLSearchParams(q);
    n.delete('page');
    if (v) n.set(k, v);
    else n.delete(k);
    setQ(n, { replace: true });
  };
  return (
    <>
      <RouteChildPage>
        <PageContainer>
          <PageHeader
            title={t('approval.title')}
            description={t('approval.description')}
            actions={
              <Refresh busy={r.isFetching} onClick={() => void r.refetch()} />
            }
          />
          <Nav />
          <div className='flex flex-wrap gap-3'>
            <Search
              value={query.q}
              onChange={(v) => change('q', v)}
              placeholder={t('approval.searchRequests')}
            />
            {(
              [
                ['view', ['pending', 'submitted', 'all']],
                ['kind', ['', ...kinds]],
                [
                  'status',
                  ['', 'pending', 'approved', 'rejected', 'cancelled'],
                ],
              ] as [string, string[]][]
            ).map(([key, opts]) => (
              <div key={key} className='w-full sm:w-48'>
                <Choice
                  value={query[key as 'view']}
                  onChange={(v) => change(key, v)}
                  ariaLabel={t('approval.' + key)}
                  options={opts.map((v) => ({
                    value: v,
                    label: t(
                      'approval.' +
                        (key === 'kind'
                          ? 'kinds.'
                          : key === 'view'
                            ? 'views.'
                            : 'states.') +
                        (v || 'all'),
                    ),
                  }))}
                />
              </div>
            ))}
            <Button variant='outline' onClick={() => setQ({})}>
              {t('approval.clear')}
            </Button>
          </div>
          {r.error ? (
            <BillingError error={r.error} retry={() => void r.refetch()} />
          ) : r.isPending ? (
            <LoadingRows />
          ) : rows?.length ? (
            <>
              <div className='overflow-x-auto' aria-busy={r.isFetching}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('approval.source')}</TableHead>
                      <TableHead>{t('approval.kind')}</TableHead>
                      <TableHead>{t('approval.status')}</TableHead>
                      <TableHead>{t('approval.level')}</TableHead>
                      <TableHead>{t('approval.applicant')}</TableHead>
                      {['createdAt', 'updatedAt'].map((k) => (
                        <TableHead
                          key={k}
                          aria-sort={
                            query.order.endsWith(k)
                              ? query.order.startsWith('-')
                                ? 'descending'
                                : 'ascending'
                              : 'none'
                          }
                        >
                          <Button
                            variant='ghost'
                            onClick={() =>
                              change('order', query.order === k ? '-' + k : k)
                            }
                          >
                            {t('approval.' + k)}{' '}
                            {query.order.endsWith(k)
                              ? query.order.startsWith('-')
                                ? '↓'
                                : '↑'
                              : ''}
                          </Button>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell>
                          {r.isFetching ? (
                            <Truncated>
                              {d.payload.number + ' · ' + d.payload.title}
                            </Truncated>
                          ) : (
                            <Link
                              className='font-medium underline underline-offset-4'
                              to={{
                                pathname: base + '/requests/' + d.id,
                                search: l.search,
                              }}
                            >
                              <Truncated>
                                {d.payload.number + ' · ' + d.payload.title}
                              </Truncated>
                            </Link>
                          )}
                        </TableCell>
                        <TableCell>
                          <KindBadge value={d.kind} />
                        </TableCell>
                        <TableCell>
                          <State value={d.status} />
                        </TableCell>
                        <TableCell>{d.payload.stages[d.level]?.name}</TableCell>
                        <TableCell>{d.applicantName}</TableCell>
                        <TableCell>
                          <RecordedAt value={d.createdAt} />
                        </TableCell>
                        <TableCell>
                          <RecordedAt value={d.updatedAt} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Paged
                meta={r.data.meta}
                onChange={(page) => {
                  const n = new URLSearchParams(q);
                  n.set('page', String(page));
                  setQ(n);
                }}
              />
            </>
          ) : (
            <Empty className='min-h-48 border border-dashed'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <ClipboardCheck />
                </EmptyMedia>
                <EmptyTitle>
                  {t(filtered ? 'approval.noResults' : 'approval.empty')}
                </EmptyTitle>
                <EmptyDescription>
                  {t(
                    filtered ? 'approval.noResultsHint' : 'approval.emptyHint',
                  )}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  variant={filtered ? 'outline' : 'default'}
                  onClick={() => (filtered ? setQ({}) : change('view', 'all'))}
                >
                  {t(filtered ? 'approval.clear' : 'approval.allRequests')}
                </Button>
              </EmptyContent>
            </Empty>
          )}
        </PageContainer>
      </RouteChildPage>
      <Outlet />
    </>
  );
}
