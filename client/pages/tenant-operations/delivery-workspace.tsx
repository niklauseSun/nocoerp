import { ResponsiveTable, MobileSort } from '#components/responsive-table';
import { Link, Outlet, useSearchParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { ClipboardList } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { StatusBadge } from '#components/status-badge';
import { Button } from '#components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '#components/ui/empty';
import { useBusinessQuery } from '../hyl/hooks.js';
import {
  Search,
  Choice,
  DateField,
  LoadingRows,
  BillingError,
  Refresh,
  Day,
  Money,
  Paged,
  Truncated,
} from '../billing/common.js';
import { RecordedAt } from '../cashier/common.js';
import { today } from '../financial-reports/hooks.js';
import { OperationsNav } from './navigation.js';
import { DeliveryStatus } from './delivery-common.js';

import Integrations from './integrations.js';
interface ListResult {
  data: {
    items: {
      id: string;
      name: string;
      date: string;
      status: string;
      amountCents: string;
      detail: string;
      path: string;
      type?: string;
      updatedAt: string;
    }[];
  };
  meta: { total: number; page: number; pageSize: number };
}
export default function DeliveryWorkspace() {
  const { t } = useTranslation(),
    [params, setParams] = useSearchParams(),
    view = params.get('view') ?? 'batches',
    isService = view === 'tenantService',
    isIntegrations = view === 'integrations';
  const query = Object.fromEntries(
      [...params].filter(([k]) =>
        [
          'q',
          'status',
          'month',
          'order',
          'page',
          'pageSize',
          'type',
          'projectId',
        ].includes(k),
      ),
    ),
    month = query.month || today().slice(0, 7);
  const r = useBusinessQuery<ListResult>(
    isService ? 'tenantOperations/serviceRecords' : 'tenantOperations/batches',
    isService ? query : { ...query, month },
    !isIntegrations,
  );
  const projects = useBusinessQuery<{ data: { id: string; name: string }[] }>(
    'tenantOperations/batches/projects',
    undefined,
    !isService && !isIntegrations,
  );
  const options = useBusinessQuery<{
    data: { manage: boolean; merchants: { id: string; name: string }[] };
  }>('tenantOperations/serviceRecords/options', undefined, isService);
  const grant = useCan({
      resource: { type: 'composite', id: 'hyl.settlements' },
      action: 'write',
    }),
    canCreate = isService ? !!options.data?.data.merchants.length : grant.can;
  const d = r.error ? undefined : r.data,
    filtered = !!(query.q || query.status || query.type || query.projectId);
  const change = (values: Record<string, string>) => {
    const q = new URLSearchParams(params);
    q.delete('page');
    for (const [k, v] of Object.entries(values))
      if (v) q.set(k, v);
      else q.delete(k);
    setParams(q, { replace: true });
  };
  const create = (
    <Button
      nativeButton={false}
      render={
        <Link
          to={{
            pathname: isService ? 'service/new' : 'batch/new',
            search: params.toString(),
          }}
        />
      }
    >
      {t(isService ? 'operations.serviceCreate' : 'operations.createBatch')}
    </Button>
  );
  if (isIntegrations) return <Integrations />;
  return (
    <>
      <PageContainer>
        <PageHeader
          title={t('operations.title')}
          description={t(
            isService ? 'operations.serviceHelp' : 'operations.batchHelp',
          )}
          actions={
            <>
              {d && (d.meta.total > 0 || filtered) && canCreate ? create : null}
              <Refresh
                busy={r.isFetching}
                onClick={() => {
                  void r.refetch();
                  if (isService) void options.refetch();
                }}
              />
            </>
          }
        />
        <OperationsNav view={view} />
        <div className='flex flex-wrap items-center gap-3'>
          <Search
            value={query.q || ''}
            placeholder={t('operations.searchDelivery')}
            onChange={(v) => change({ q: v })}
          />
          {!isService ? (
            <div className='w-full sm:w-40'>
              <DateField
                id='batch-list-month'
                month
                value={month}
                onChange={(v) => change({ month: v })}
              />
            </div>
          ) : (
            <Choice
              showMobileLabel
              ariaLabel={t('operations.recordType')}
              value={query.type || ''}
              onChange={(v) => change({ type: v })}
              options={[
                { value: '', label: t('operations.allTypes') },
                ...['notice', 'policy', 'complaint', 'suggestion'].map((v) => ({
                  value: v,
                  label: t('operations.serviceTypes.' + v),
                })),
              ]}
            />
          )}
          {!isService ? (
            <Choice
              ariaLabel={t('operations.project')}
              value={query.projectId || ''}
              onChange={(v) => change({ projectId: v })}
              options={[
                { value: '', label: t('operations.allProjects') },
                ...(projects.data?.data ?? []).map((p) => ({
                  value: p.id,
                  label: p.name,
                })),
              ]}
            />
          ) : null}
          <Choice
            showMobileLabel
            ariaLabel={t('operations.status')}
            value={query.status || ''}
            onChange={(v) => change({ status: v })}
            options={[
              { value: '', label: t('operations.allStatuses') },
              ...(isService
                ? [
                    'draft',
                    'published',
                    'withdrawn',
                    'submitted',
                    'processing',
                    'closed',
                  ]
                : ['ready', 'partial', 'completed', 'failed']
              ).map((v) => ({
                value: v,
                label: t('operations.deliveryStatuses.' + v),
              })),
            ]}
          />
          {filtered ? (
            <Button
              variant='ghost'
              onClick={() =>
                change({ q: '', status: '', type: '', projectId: '' })
              }
            >
              {t('operations.clear')}
            </Button>
          ) : null}
        </div>
        {r.error ? (
          <BillingError error={r.error} retry={() => void r.refetch()} />
        ) : r.isPending ? (
          <LoadingRows />
        ) : d?.data.items.length ? (
          <>
            <ResponsiveTable
              enabled={isService}
              labels={[
                'name',
                'date',
                'status',
                'recordType',
                'detail',
                'updatedAt',
                'source',
              ].map((k) => t('operations.' + k))}
              sort={
                <MobileSort
                  value={query.order || '-updatedAt'}
                  onChange={(v) => change({ order: v })}
                  fields={['name', 'date', 'updatedAt'].map((k) => ({
                    value: k,
                    label: t('operations.' + k),
                  }))}
                />
              }
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    {[
                      'name',
                      'date',
                      'status',
                      isService ? 'recordType' : 'amountCents',
                      isService ? 'detail' : 'count',
                      'updatedAt',
                      'source',
                    ].map((k) => (
                      <TableHead
                        key={k}
                        className={
                          k === 'amountCents' ? 'text-right' : undefined
                        }
                      >
                        {[
                          'name',
                          'date',
                          'amountCents',
                          'count',
                          'updatedAt',
                        ].includes(k) ? (
                          <Button
                            size='sm'
                            variant='ghost'
                            onClick={() =>
                              change({ order: query.order === k ? '-' + k : k })
                            }
                          >
                            {t(
                              'operations.' +
                                (k === 'amountCents' ? 'amount' : k),
                            )}
                            {query.order === k
                              ? ' ↑'
                              : query.order === '-' + k
                                ? ' ↓'
                                : ''}
                          </Button>
                        ) : (
                          t('operations.' + k)
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.data.items.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Link
                          className='font-medium underline-offset-4 hover:underline'
                          to={{ pathname: row.path, search: params.toString() }}
                        >
                          <Truncated>{row.name}</Truncated>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Day value={row.date} />
                      </TableCell>
                      <TableCell>
                        <DeliveryStatus status={row.status} />
                      </TableCell>
                      <TableCell
                        className={!isService ? 'text-right' : undefined}
                      >
                        {isService ? (
                          <StatusBadge tone='neutral'>
                            {t('operations.serviceTypes.' + row.type)}
                          </StatusBadge>
                        ) : (
                          <Money cents={row.amountCents} />
                        )}
                      </TableCell>
                      <TableCell>
                        <Truncated>{row.detail}</Truncated>
                      </TableCell>
                      <TableCell>
                        <RecordedAt value={row.updatedAt} />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant='ghost'
                          nativeButton={false}
                          render={
                            <Link
                              to={{
                                pathname: row.path,
                                search: params.toString(),
                              }}
                            />
                          }
                        >
                          {t('operations.open')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ResponsiveTable>
            <Paged
              meta={d.meta}
              onChange={(page) => {
                const q = new URLSearchParams(params);
                q.set('page', String(page));
                setParams(q);
              }}
            />
          </>
        ) : (
          <Empty className='min-h-48 border border-dashed'>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <ClipboardList />
              </EmptyMedia>
              <EmptyTitle>
                {t(
                  filtered
                    ? 'operations.noResults'
                    : isService
                      ? 'operations.serviceEmpty'
                      : 'operations.batchEmpty',
                )}
              </EmptyTitle>
              <EmptyDescription>
                {t(
                  filtered
                    ? 'operations.noResultsHint'
                    : isService
                      ? 'operations.serviceEmptyHint'
                      : 'operations.batchEmptyHint',
                )}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              {filtered ? (
                <Button
                  variant='outline'
                  onClick={() =>
                    change({ q: '', status: '', type: '', projectId: '' })
                  }
                >
                  {t('operations.clear')}
                </Button>
              ) : canCreate ? (
                create
              ) : null}
            </EmptyContent>
          </Empty>
        )}
      </PageContainer>
      <Outlet />
    </>
  );
}
