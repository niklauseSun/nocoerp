import { useTranslation } from '@nocobase/i18n/client';
import { StatusBadge } from '#components/status-badge';
export function LeaseStatus({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <StatusBadge
      size='sm'
      tone={
        status === 'active'
          ? 'success'
          : status === 'terminated'
            ? 'warning'
            : status === 'future'
              ? 'info'
              : 'neutral'
      }
    >
      {t(`lease.states.${status}`)}
    </StatusBadge>
  );
}
