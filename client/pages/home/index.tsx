import { Comparison } from './comparison.js';
import { useState } from 'react';
import { RevenuePanels, type RevenueAnalytics } from './revenue.js';
import { DatePicker } from '#components/date-picker';
import { Field, FieldLabel } from '#components/ui/field';
import { dashboardAmount } from './format.js';
import { ApiClientError } from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  Store,
  TrendingUp,
  ClipboardCheck,
  Calculator,
  Wallet,
  ArrowRight,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '#components/ui/card';
import { Button } from '#components/ui/button';
import { Skeleton } from '#components/ui/skeleton';
import { Alert, AlertDescription } from '#components/ui/alert';
import { ErrorPanel, Refresh } from '../hyl/common.js';
import { useBusinessQuery } from '../hyl/hooks.js';

export interface DashboardData {
  month: string;
  analytics: RevenueAnalytics | null;
  updatedAt: string;
  merchants: number | null;
  revenue: string | null;
  pendingReports: number | null;
  unsettled: string | null;
  unpaid: string | null;
}
const metrics = [
  { key: 'merchants', kind: 'merchants', icon: Store },
  { key: 'revenue', kind: 'revenueReports', icon: TrendingUp },
  { key: 'pendingReports', kind: 'revenueReports', icon: ClipboardCheck },
  { key: 'unsettled', kind: 'revenueReports', icon: Calculator },
  { key: 'unpaid', kind: 'settlements', icon: Wallet },
] as const;
type Metric = (typeof metrics)[number];
function destination(key: Metric['key'], month: string) {
  switch (key) {
    case 'merchants':
      return '/merchants';
    case 'revenue':
      return `/revenueReports?view=monthRevenue&month=${month}`;
    case 'pendingReports':
      return '/revenueReports?status=pending';
    case 'unsettled':
      return '/revenueReports?view=unsettled';
    case 'unpaid':
      return '/settlements?view=unpaid';
  }
}
function MetricCard({ metric, data }: { metric: Metric; data: DashboardData }) {
  const { t, i18n } = useTranslation();
  const can = useCan({
    resource: { type: 'page', id: `hyl-${metric.kind}` },
    action: 'access',
  });
  const value = data[metric.key],
    Icon = metric.icon;
  return (
    <Card className='min-w-0'>
      <CardHeader>
        <CardTitle className='flex items-center justify-between gap-2'>
          {t(`dashboard.metrics.${metric.key}.title`)}
          <Icon className='size-4 shrink-0 text-muted-foreground' aria-hidden />
        </CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-2'>
        <p className='text-2xl font-semibold break-words tabular-nums'>
          {value === null
            ? '—'
            : typeof value === 'number'
              ? new Intl.NumberFormat(i18n.language).format(value)
              : dashboardAmount(value, i18n.language)}
        </p>
        <p className='text-sm text-muted-foreground'>
          {value === null
            ? t('dashboard.denied')
            : t(`dashboard.metrics.${metric.key}.note`)}
        </p>
        {metric.key === 'revenue' && value !== null && data.analytics ? (
          <Comparison
            value={data.analytics.comparison}
            previousMonth={data.analytics.previousMonth}
          />
        ) : null}
      </CardContent>
      {value !== null && can.can ? (
        <CardFooter className='mt-auto'>
          <Button
            variant='outline'
            nativeButton={false}
            role='link'
            render={<Link to={destination(metric.key, data.month)} />}
          >
            {t(`dashboard.metrics.${metric.key}.action`)}
            <ArrowRight data-icon='inline-end' />
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}
export default function HomePage() {
  const { t, i18n } = useTranslation();
  const { refresh: refreshSession } = useAuthentication();
  const [params, setParams] = useSearchParams();
  const [currentMonth] = useState(() => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(new Date());
    return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}`;
  });
  const rawMonth = params.get('month');
  const month =
    rawMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth)
      ? rawMonth
      : currentMonth;
  const result = useBusinessQuery<{ data: DashboardData }>('hylDashboard', {
    month,
  });
  const setMonth = (value: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set('month', value);
      else next.delete('month');
      return next;
    });
  const canSettle = useCan({
    resource: { type: 'page', id: 'hyl-settlements' },
    action: 'access',
  });
  const status =
    result.error instanceof ApiClientError ? result.error.status : 0;
  // A session/permission failure must never leave cached financial data on screen.
  const data =
    [401, 403].includes(status) || result.isPlaceholderData
      ? undefined
      : result.data?.data;
  return (
    <PageContainer>
      <PageHeader
        title={t('dashboard.title')}
        description={t('dashboard.description')}
        actions={
          <Refresh
            busy={result.isFetching}
            onClick={() => void result.refetch()}
          />
        }
      />
      <div className='flex flex-wrap items-end gap-3'>
        <Field className='w-full sm:w-56'>
          <FieldLabel htmlFor='dashboard-month'>
            {t('dashboard.monthLabel')}
          </FieldLabel>
          <DatePicker
            id='dashboard-month'
            month
            value={month}
            onChange={setMonth}
            placeholder={t('dashboard.monthLabel')}
          />
        </Field>
        {params.has('month') ? (
          <Button
            variant='outline'
            onClick={() => {
              setMonth('');
              document.getElementById('dashboard-month')?.focus();
            }}
          >
            {t('dashboard.resetMonth')}
          </Button>
        ) : null}
      </div>
      <p className='text-sm text-muted-foreground'>
        {t('dashboard.monthScope')}
      </p>
      <p className='text-sm text-muted-foreground'>
        {t(
          month === currentMonth
            ? 'dashboard.comparison.currentPeriod'
            : 'dashboard.comparison.fullPeriod',
        )}
      </p>
      {result.error ? (
        status === 401 ? (
          <Alert variant='destructive'>
            <AlertDescription>
              {t('dashboard.sessionExpired')}
              <Button variant='outline' onClick={() => void refreshSession()}>
                {t('dashboard.signIn')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <ErrorPanel
            error={result.error}
            retry={() => void result.refetch()}
          />
        )
      ) : null}
      {result.error && data ? (
        <p className='text-sm text-muted-foreground' role='status'>
          {t('dashboard.stale')}
        </p>
      ) : null}
      {result.isPending || result.isPlaceholderData ? (
        <div
          aria-label={t('hyl.copy.load')}
          className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'
        >
          {metrics.map(({ key }) => (
            <Card key={key}>
              <CardHeader>
                <Skeleton className='h-5 w-1/2' />
              </CardHeader>
              <CardContent className='flex flex-col gap-3'>
                <Skeleton className='h-8 w-2/3' />
                <Skeleton className='h-4 w-full' />
              </CardContent>
            </Card>
          ))}
          {[0, 1].map((key) => (
            <Card key={`chart-${key}`}>
              <CardHeader>
                <Skeleton className='h-5 w-1/2' />
              </CardHeader>
              <CardContent>
                <Skeleton className='h-64 w-full' />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
      {data ? (
        <>
          <div className='flex flex-col gap-1 text-sm text-muted-foreground'>
            <p>{t('dashboard.period', { month: data.month })}</p>
            <p>
              {t('dashboard.updated', {
                time: new Intl.DateTimeFormat(i18n.language, {
                  dateStyle: 'short',
                  timeStyle: 'short',
                  timeZone: 'Asia/Shanghai',
                }).format(new Date(data.updatedAt)),
              })}
            </p>
            <p>{t('dashboard.scope')}</p>
          </div>
          <div
            className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'
            aria-busy={result.isFetching}
          >
            {metrics.map((metric) => (
              <MetricCard key={metric.key} metric={metric} data={data} />
            ))}
          </div>
          <RevenuePanels analytics={data.analytics} month={data.month} />
          <Card>
            <CardHeader>
              <CardTitle>{t('dashboard.rulesTitle')}</CardTitle>
              <CardDescription>{t('dashboard.next')}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className='text-sm text-muted-foreground'>
                {t('dashboard.rules')}
              </p>
            </CardContent>
            {canSettle.can ? (
              <CardFooter>
                <Button
                  variant='outline'
                  nativeButton={false}
                  role='link'
                  render={<Link to='/settlements' />}
                >
                  {t('dashboard.settle')}
                </Button>
              </CardFooter>
            ) : null}
          </Card>
        </>
      ) : null}
    </PageContainer>
  );
}
