import { Comparison, type RevenueComparison } from './comparison.js';
import { useTranslation } from '@nocobase/i18n/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { Link } from 'react-router';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '#components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '#components/ui/chart';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableCaption,
} from '#components/ui/table';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '#components/ui/empty';
import { Button } from '#components/ui/button';
import { dashboardAmount } from './format.js';

export interface RevenueAnalytics {
  previousMonth: string;
  comparison: RevenueComparison;
  daily: { date: string; amount: string }[];
  reportCount: number;
  rankedMerchantCount: number;
  ranking: {
    merchantId: string;
    name: string | null;
    amount: string;
    reportCount: number;
    comparison: RevenueComparison;
  }[];
}
export function RevenuePanels({
  analytics,
  month,
}: {
  analytics: RevenueAnalytics | null;
  month: string;
}) {
  const { t, i18n } = useTranslation();
  const can = useCan({
    resource: { type: 'page', id: 'hyl-revenueReports' },
    action: 'access',
  });
  const dateLabel = (date: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      month: 'short',
      day: 'numeric',
      timeZone: 'Asia/Shanghai',
    }).format(new Date(`${date}T00:00:00+08:00`));
  const amount = (value: string) => dashboardAmount(value, i18n.language);
  const reportUrl = `/revenueReports?view=monthRevenue&month=${month}`;
  const empty = (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>
          {t(analytics ? 'dashboard.noRevenue' : 'dashboard.denied')}
        </EmptyTitle>
        {analytics ? (
          <EmptyDescription>{t('dashboard.noRevenueNote')}</EmptyDescription>
        ) : null}
      </EmptyHeader>
    </Empty>
  );
  return (
    <div className='grid min-w-0 gap-4 xl:grid-cols-2'>
      <Card className='min-w-0'>
        <CardHeader>
          <CardTitle>{t('dashboard.trendTitle')}</CardTitle>
          <CardDescription>
            {t('dashboard.trendNote', { month })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!analytics || analytics.reportCount === 0 ? (
            empty
          ) : (
            <>
              {/* Coordinates may be approximate; tooltips/table always use exact server decimal strings. */}
              {/* Fixed chart height keeps day labels readable; the 64px axis reserves room for localized compact amounts. */}
              <ChartContainer
                className='h-64 w-full'
                config={{
                  value: {
                    label: t('dashboard.netTurnover'),
                    color: 'var(--chart-2)',
                  },
                }}
                aria-label={t('dashboard.trendTitle')}
              >
                <LineChart
                  accessibilityLayer
                  data={analytics.daily.map((day) => ({
                    ...day,
                    value: Number(day.amount),
                  }))}
                  margin={{ top: 12, right: 12, bottom: 4, left: 0 }}
                >
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey='date'
                    tick={{ fill: 'var(--muted-foreground)' }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={32}
                    tickFormatter={dateLabel}
                  />
                  <YAxis
                    width={64}
                    tick={{ fill: 'var(--muted-foreground)' }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) =>
                      new Intl.NumberFormat(i18n.language, {
                        notation: 'compact',
                        maximumFractionDigits: 1,
                      }).format(v)
                    }
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(_label, payload) =>
                          dateLabel(
                            String(
                              (
                                payload[0]?.payload as
                                  { date: string } | undefined
                              )?.date,
                            ),
                          )
                        }
                        formatter={(_value, _name, item) => (
                          <span>
                            {t('dashboard.netTurnover')} ·{' '}
                            {amount(
                              String(
                                (item.payload as { amount: string }).amount,
                              ),
                            )}
                          </span>
                        )}
                      />
                    }
                  />
                  <Line
                    type='linear'
                    dataKey='value'
                    stroke='var(--color-value)'
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ChartContainer>
              <details className='mt-4'>
                <summary className='cursor-pointer text-sm font-medium'>
                  {t('dashboard.dailyDetails')}
                </summary>
                <Table>
                  <TableCaption>{t('dashboard.dailyCaption')}</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('dashboard.date')}</TableHead>
                      <TableHead className='text-right'>
                        {t('dashboard.netTurnover')}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analytics.daily.map((day) => (
                      <TableRow key={day.date}>
                        <TableCell>{dateLabel(day.date)}</TableCell>
                        <TableCell className='text-right tabular-nums'>
                          {amount(day.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </details>
            </>
          )}
        </CardContent>
      </Card>
      <Card className='min-w-0'>
        <CardHeader>
          <CardTitle>{t('dashboard.rankingTitle')}</CardTitle>
          <CardDescription>
            {t('dashboard.rankingNote', {
              month,
              count: analytics?.rankedMerchantCount ?? 0,
            })}
            {analytics
              ? ` ${t('dashboard.comparison.rankingNote', { month: analytics.previousMonth })}`
              : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!analytics || analytics.reportCount === 0 ? (
            empty
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('dashboard.merchant')}</TableHead>
                  <TableHead className='text-right'>
                    {t('dashboard.netTurnover')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analytics.ranking.map((row, index) => (
                  <TableRow key={row.merchantId}>
                    <TableCell className='whitespace-normal'>
                      <div className='flex items-start gap-2'>
                        <span className='text-muted-foreground tabular-nums'>
                          {index + 1}
                        </span>
                        {can.can ? (
                          <Link
                            className='break-words text-primary underline-offset-4 hover:underline'
                            to={`${reportUrl}&merchantId=${encodeURIComponent(row.merchantId)}`}
                          >
                            {row.name ?? t('dashboard.hiddenMerchant')}
                          </Link>
                        ) : (
                          <span className='break-words'>
                            {row.name ?? t('dashboard.hiddenMerchant')}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      <p className='mb-2 font-medium'>{amount(row.amount)}</p>
                      <Comparison
                        value={row.comparison}
                        previousMonth={analytics.previousMonth}
                        compact
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {analytics && can.can ? (
          <CardFooter className='mt-auto'>
            <Button
              variant='outline'
              nativeButton={false}
              role='link'
              render={<Link to={reportUrl} />}
            >
              {t('dashboard.allReports')}
            </Button>
          </CardFooter>
        ) : null}
      </Card>
    </div>
  );
}
