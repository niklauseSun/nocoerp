import { type ReactNode } from 'react';
import {
  Bell,
  ListTodo,
  ClipboardCheck,
  Wrench,
  ShieldCheck,
  Gauge,
  ArrowUpRight,
} from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '#components/ui/card';
import { Button } from '#components/ui/button';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '#components/ui/empty';
import { Skeleton } from '#components/ui/skeleton';
import { useBusinessQuery } from '../hyl/hooks.js';
import { Refresh, BillingError } from '../cashier/common.js';
import { type Todo } from '../messages/common.js';
import { type Approval } from '../approvals/common.js';
import { useEntryAccess } from './access.js';
type Page<T> = { data: T[]; meta: { total: number } };
function Attention({
  title,
  total,
  to,
  loading,
  error,
  retry,
  children,
  empty,
}: {
  title: string;
  total?: number;
  to: string;
  loading: boolean;
  error: unknown;
  retry: () => void;
  children: ReactNode;
  empty: boolean;
}) {
  const { t, i18n } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle
          role='heading'
          aria-level={2}
          className='flex flex-wrap items-center justify-between gap-2'
        >
          <span>{title}</span>
          <Button
            variant='ghost'
            nativeButton={false}
            render={<Link to={to} />}
          >
            {t('mobile.viewAll')}
            <ArrowUpRight />
          </Button>
        </CardTitle>
        {total !== undefined && !error ? (
          <CardDescription>
            {t('mobile.total', {
              count: total,
              formatted: new Intl.NumberFormat(i18n.language).format(total),
            })}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>
        {error ? (
          <BillingError error={error} retry={retry} />
        ) : loading ? (
          <div
            role='status'
            aria-label={t('mobile.loading')}
            className='flex flex-col gap-3'
          >
            <Skeleton className='h-12' />
            <Skeleton className='h-12' />
          </div>
        ) : empty ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <ListTodo />
              </EmptyMedia>
              <EmptyTitle>{t('mobile.empty')}</EmptyTitle>
              <EmptyDescription>{t('mobile.emptyHelp')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className='flex flex-col divide-y'>{children}</ul>
        )}
      </CardContent>
    </Card>
  );
}
export default function Workbench() {
  const { t } = useTranslation(),
    location = useLocation(),
    approval = useEntryAccess('hyl-approvals', 'hyl.approvals'),
    repair = useEntryAccess('hyl-repairs', 'hyl.repairs'),
    inspection = useEntryAccess('hyl-inspections', 'hyl.inspections'),
    energy = useEntryAccess('hyl-energy', 'hyl.energy', 'readingRead'),
    todos = useBusinessQuery<Page<Todo>>('messageTodos', {
      status: 'active',
      order: '-updatedAt',
      page: 1,
      pageSize: 5,
    }),
    approvals = useBusinessQuery<Page<Approval>>(
      'approvalRequests',
      { view: 'pending', order: '-updatedAt', page: 1, pageSize: 5 },
      approval.can,
    );
  const entries = [
    { key: 'inbox', to: '/inbox', icon: Bell, can: true },
    { key: 'todos', to: '/messageTodos', icon: ListTodo, can: true },
    {
      key: 'approvals',
      to: '/approvals',
      icon: ClipboardCheck,
      can: approval.can,
    },
    { key: 'repairs', to: '/repairs', icon: Wrench, can: repair.can },
    {
      key: 'inspections',
      to: '/inspections/tasks',
      icon: ShieldCheck,
      can: inspection.can,
    },
    { key: 'readings', to: '/energy/readings', icon: Gauge, can: energy.can },
  ];
  return (
    <>
      <PageContainer>
        <PageHeader
          title={t('mobile.title')}
          description={t('mobile.description')}
          actions={
            <Refresh
              busy={todos.isFetching || approvals.isFetching}
              onClick={() => {
                void todos.refetch();
                if (approval.can) void approvals.refetch();
              }}
            />
          }
        />
        <nav
          aria-label={t('mobile.entries')}
          className='grid grid-cols-2 gap-3 sm:grid-cols-3'
        >
          {entries
            .filter((x) => x.can)
            .map(({ key, to, icon: Icon }) => (
              <Button
                key={key}
                variant='outline'
                className='h-auto min-h-20 flex-col gap-2 whitespace-normal p-3'
                nativeButton={false}
                render={<Link to={to} />}
              >
                <Icon />
                {t('mobile.' + key)}
              </Button>
            ))}
        </nav>
        <Attention
          title={t('mobile.attention')}
          total={todos.data?.meta.total}
          to='/messageTodos'
          loading={!todos.data}
          error={todos.error}
          retry={() => void todos.refetch()}
          empty={!todos.data?.data.length}
        >
          {todos.data?.data.map((d) => (
            <li key={d.id} className='min-w-0 py-3'>
              <Link
                className='block break-words font-medium underline underline-offset-4'
                to={{
                  pathname: '/workbench/todos/' + d.id,
                  search: location.search,
                }}
              >
                {d.number} · {d.title}
              </Link>
              <p className='mt-1 text-sm text-muted-foreground'>
                {t('messages.reasons.' + d.reason)}
              </p>
            </li>
          ))}
        </Attention>
        {approval.pending ? (
          <div role='status' aria-label={t('mobile.loading')}>
            <Skeleton className='h-32' />
          </div>
        ) : approval.can ? (
          <Attention
            title={t('mobile.approvalAttention')}
            total={approvals.data?.meta.total}
            to='/approvals'
            loading={!approvals.data}
            error={approvals.error}
            retry={() => void approvals.refetch()}
            empty={!approvals.data?.data.length}
          >
            {approvals.data?.data.map((d) => (
              <li key={d.id} className='min-w-0 py-3'>
                <Link
                  className='block break-words font-medium underline underline-offset-4'
                  to={{
                    pathname: '/workbench/approvalRequests/' + d.id,
                    search: location.search,
                  }}
                >
                  {d.payload.number} · {d.payload.title}
                </Link>
                <p className='mt-1 text-sm text-muted-foreground'>
                  {d.payload.stages[d.level]?.name} · {d.applicantName}
                </p>
              </li>
            ))}
          </Attention>
        ) : (
          <p className='text-sm text-muted-foreground'>
            {t('mobile.restricted')}
          </p>
        )}
      </PageContainer>
      <Outlet />
    </>
  );
}
