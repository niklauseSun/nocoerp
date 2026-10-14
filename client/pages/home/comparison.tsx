import { useTranslation } from '@nocobase/i18n/client';
import { dashboardAmount, dashboardDecimal } from './format.js';

export interface RevenueComparison {
  previousAmount: string;
  changeAmount: string;
  changePercent: string | null;
  previousReportCount: number;
}
export function Comparison({
  value,
  previousMonth,
  compact = false,
}: {
  value: RevenueComparison;
  previousMonth: string;
  compact?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const direction =
    value.changeAmount === '0.00'
      ? 'unchanged'
      : value.changeAmount.startsWith('-')
        ? 'decrease'
        : 'increase';
  const percentage =
    value.changePercent === null
      ? null
      : `${value.changePercent === '0.00' || value.changePercent.startsWith('-') ? '' : '+'}${dashboardDecimal(value.changePercent, i18n.language)}%`;
  return (
    <div className='flex flex-col gap-1 text-sm whitespace-normal'>
      <p className='text-muted-foreground'>
        {t('dashboard.comparison.previous', {
          month: previousMonth,
          amount: dashboardAmount(value.previousAmount, i18n.language),
        })}
      </p>
      <p className='tabular-nums'>
        {t(`dashboard.comparison.${direction}`, {
          amount: dashboardAmount(
            value.changeAmount.replace(/^-/, ''),
            i18n.language,
          ),
        })}
      </p>
      <p className='text-muted-foreground'>
        {percentage === null
          ? t(
              value.previousReportCount === 0
                ? 'dashboard.comparison.noBaseline'
                : 'dashboard.comparison.zeroBaseline',
            )
          : t('dashboard.comparison.rate', { value: percentage })}
      </p>
      {!compact && value.previousReportCount === 0 ? (
        <p className='text-xs text-muted-foreground'>
          {t('dashboard.comparison.noBaselineNote')}
        </p>
      ) : null}
    </div>
  );
}
