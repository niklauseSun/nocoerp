import { useTranslation } from '@nocobase/i18n/client';
import { StatusBadge } from '#components/status-badge';

// One semantic mapping for all five modules and their list/detail views.
const tones = {
  active: 'success',
  inactive: 'neutral',
  draft: 'neutral',
  pending: 'info',
  approved: 'success',
  returned: 'warning',
  review: 'info',
  confirmation: 'info',
  disputed: 'warning',
  payable: 'info',
  partial: 'warning',
  paid: 'success',
  settled: 'success',
  due: 'warning',
  cancelled: 'neutral',
} as const;

export function BusinessStatus({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <StatusBadge
      size='sm'
      tone={tones[status as keyof typeof tones] ?? 'neutral'}
    >
      {t(`hyl.states.${status}`)}
    </StatusBadge>
  );
}
