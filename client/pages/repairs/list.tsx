import { ResponsiveTable, MobileSort } from '#components/responsive-table';
import { str, useRepairCan } from './helpers.js';
import {
  Outlet,
  Link,
  useSearchParams,
  useLocation,
  useResolvedPath,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import { Badge } from '#components/ui/badge';
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
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '#components/ui/empty';
import { Wrench } from 'lucide-react';
import { BackButton } from '#components/back-button';
import { RouteChildPage } from '#components/route-child-page';
import { useBusinessQuery } from '../hyl/hooks.js';
import { useCoverFocus } from '../profit-sharing/focus.js';
import {
  Choice,
  Search,
  Paged,
  BillingError,
  LoadingRows,
  Refresh,
  RepairState,
  Money,
  Day,
  RecordedAt,
  Truncated,
  type Order,
  type Page,
} from './common.js';
const states = [
    'reported',
    'assigned',
    'processing',
    'pendingAcceptance',
    'accepted',
    'closed',
    'cancelled',
  ],
  priorities = ['low', 'normal', 'high', 'urgent'],
  categories = [
    'plumbing',
    'electrical',
    'airConditioning',
    'facility',
    'other',
  ];
export default function RepairList({
  scope,
}: { scope?: { kind: string; id: string } } = {}) {
  useCoverFocus();
  const { t } = useTranslation(),
    [q, setQ] = useSearchParams(),
    l = useLocation(),
    path = useResolvedPath('.').pathname,
    read = useRepairCan('read'),
    report = useRepairCan('report');
  const get = (key: string) => q.get('repair' + key) || '',
    change = (key: string, value: string) => {
      const n = new URLSearchParams(q);
      if (value) n.set('repair' + key, value);
      else n.delete('repair' + key);
      n.delete('repairPage');
      setQ(n, { replace: true });
    };
  const query = {
    q: get('Q'),
    status: get('Status'),
    category: get('Category'),
    priority: get('Priority'),
    mine: get('Mine'),
    order: get('Order') || '-updatedAt',
    page: Number(get('Page')) || 1,
    pageSize: 20,
    ...(scope ? { [scope.kind + 'Id']: scope.id } : {}),
  };
  const result = useBusinessQuery<Page<Order>>('repairOrders', query, read.can),
    rows = result.data?.data,
    filtered = !!(
      query.q ||
      query.status ||
      query.priority ||
      query.category ||
      query.mine
    ),
    empty = !!rows && !rows.length && !filtered,
    clear = () => {
      const n = new URLSearchParams(q);
      for (const key of [...n.keys()])
        if (key.startsWith('repair')) n.delete(key);
      setQ(n, { replace: true });
    };
  const create = (
    <Button
      nativeButton={false}
      render={<Link to={{ pathname: path + '/new', search: l.search }} />}
    >
      {t('repair.new')}
    </Button>
  );
  const sort = (key: string) => {
    const asc = query.order === key,
      desc = query.order === '-' + key;
    return (
      <TableHead aria-sort={asc ? 'ascending' : desc ? 'descending' : 'none'}>
        <Button
          variant='ghost'
          onClick={() => change('Order', asc ? '-' + key : key)}
        >
          {t('repair.fields.' + key)}
          {asc ? ' ↑' : desc ? ' ↓' : ''}
        </Button>
      </TableHead>
    );
  };
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
        title={t('repair.title')}
        description={t('repair.description')}
        actions={
          <>
            {report.can && rows && !empty ? create : null}
            <Refresh
              busy={result.isFetching}
              onClick={() => void result.refetch()}
            />
          </>
        }
      />
      <div className='flex flex-wrap items-center gap-2'>
        <Search
          value={query.q}
          onChange={(v) => change('Q', v)}
          placeholder={t('repair.search')}
        />
        {[
          ['Status', states, 'states'],
          ['Priority', priorities, 'priorities'],
          ['Category', categories, 'categories'],
        ].map(([key, values, group]) => (
          <div key={str(key)} className='w-full min-w-0 sm:w-40 sm:shrink-0'>
            <Choice
              showMobileLabel
              ariaLabel={t('repair.fields.' + str(key).toLowerCase())}
              value={get(str(key))}
              onChange={(v) => change(str(key), v)}
              options={[
                { value: '', label: t('repair.all') },
                ...(values as string[]).map((v) => ({
                  value: v,
                  label: t('repair.' + str(group) + '.' + v),
                })),
              ]}
            />
          </div>
        ))}
        <Button
          variant={query.mine ? 'secondary' : 'outline'}
          aria-pressed={!!query.mine}
          onClick={() => change('Mine', query.mine ? '' : 'true')}
        >
          {t('repair.mine')}
        </Button>
        {filtered ? (
          <Button variant='outline' onClick={clear}>
            {t('repair.clear')}
          </Button>
        ) : null}
      </div>
      {!read.can ? (
        <p>{t('repair.restricted')}</p>
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
              <Wrench />
            </EmptyMedia>
            <EmptyTitle>
              {t(filtered ? 'repair.noResults' : 'repair.empty')}
            </EmptyTitle>
            <EmptyDescription>
              {t(report.can ? 'repair.emptyHelp' : 'repair.emptyReadOnly')}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {filtered ? (
              <Button variant='outline' onClick={clear}>
                {t('repair.clear')}
              </Button>
            ) : report.can ? (
              create
            ) : null}
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <ResponsiveTable
            labels={[
              'number',
              'title',
              'assetName',
              'merchantName',
              'priority',
              'status',
              'assigneeName',
              'dueOn',
              'costCents',
              'updatedAt',
            ]
              .map((k) => t('repair.fields.' + k))
              .concat(t('mobile.actions'))}
            sort={
              <MobileSort
                value={query.order}
                onChange={(v) => change('Order', v)}
                fields={['number', 'dueOn', 'costCents', 'updatedAt'].map(
                  (k) => ({ value: k, label: t('repair.fields.' + k) }),
                )}
              />
            }
          >
            <Table>
              <TableHeader>
                <TableRow>
                  {sort('number')}
                  <TableHead>{t('repair.fields.title')}</TableHead>
                  <TableHead>{t('repair.fields.assetName')}</TableHead>
                  <TableHead>{t('repair.fields.merchantName')}</TableHead>
                  <TableHead>{t('repair.fields.priority')}</TableHead>
                  <TableHead>{t('repair.fields.status')}</TableHead>
                  <TableHead>{t('repair.fields.assigneeName')}</TableHead>
                  {sort('dueOn')}
                  {sort('costCents')}
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
                        to={{ pathname: path + '/' + r.id, search: l.search }}
                      >
                        {r.number}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Truncated>{r.title}</Truncated>
                    </TableCell>
                    <TableCell>
                      <Truncated>{str(r.payload.assetName)}</Truncated>
                    </TableCell>
                    <TableCell>
                      <Truncated>
                        {str(r.payload.merchantName) || '—'}
                      </Truncated>
                      <span className='block text-muted-foreground'>
                        {str(r.payload.contractNumber) || '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant='secondary'>
                        {t('repair.priorities.' + r.priority)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <RepairState value={r.status} />
                      {r.overdue ? (
                        <span className='block text-muted-foreground'>
                          {t('repair.overdue')}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>{str(r.payload.assigneeName) || '—'}</TableCell>
                    <TableCell>
                      <Day value={r.dueOn} />
                    </TableCell>
                    <TableCell className='text-right'>
                      <Money cents={r.costCents} />
                    </TableCell>
                    <TableCell>
                      <RecordedAt value={r.updatedAt} />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant='ghost'
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
                        {t('repair.view')}
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
            onChange={(page) => {
              const n = new URLSearchParams(q);
              n.set('repairPage', String(page));
              setQ(n);
            }}
          />
        </>
      )}
      <Outlet />
    </PageContainer>
  );
  return scope ? <RouteChildPage>{content}</RouteChildPage> : content;
}
