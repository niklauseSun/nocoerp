import { Link, useLocation } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { Button } from '#components/ui/button';
import { StatusBadge } from '#components/status-badge';
export {
  Group,
  FormField,
  Confirm,
  Choice,
  Search,
  Paged,
  BillingError,
  LoadingRows,
  Refresh,
  RecordedAt,
  Truncated,
} from '../cashier/common.js';
export { DetailsSkeleton } from '../messages/common.js';
export interface Stage {
  name: string;
  candidates: { id: string; name: string }[];
}
export interface Approval {
  id: string;
  kind: string;
  sourceId: string;
  projectId: string;
  status: string;
  version: number;
  round: number;
  level: number;
  sourceVersion: number;
  applicantName: string;
  sourcePath: string;
  canDecide: boolean;
  canCancel: boolean;
  canResubmit: boolean;
  createdAt: string;
  updatedAt: string;
  payload: {
    number: string;
    title: string;
    comment: string;
    configRevision: number;
    stages: Stage[];
    source: Record<string, unknown>;
  };
  events: {
    data: {
      id: string;
      round: number;
      level: number;
      action: string;
      comment: string;
      createdAt: string;
      payload: { actorName: string; levelName: string };
    }[];
    meta: { page: number; pageSize: number; total: number };
  };
}
export function State({ value }: { value: string }) {
  const { t } = useTranslation();
  return (
    <StatusBadge
      tone={
        value === 'approved'
          ? 'success'
          : value === 'rejected'
            ? 'warning'
            : 'info'
      }
    >
      {t('approval.states.' + value)}
    </StatusBadge>
  );
}
export function Nav() {
  const { t } = useTranslation(),
    l = useLocation();
  return (
    <nav aria-label={t('approval.title')} className='flex flex-wrap gap-2'>
      {[
        ['/approvals', 'requests'],
        ['/approvals/configs', 'configs'],
      ].map(([path, key]) => (
        <Button
          key={key}
          variant='outline'
          nativeButton={false}
          render={<Link to={{ pathname: path, search: l.search }} />}
        >
          {t('approval.' + key)}
        </Button>
      ))}
    </nav>
  );
}

export function KindBadge({ value }: { value: string }) {
  const { t } = useTranslation();
  return (
    <StatusBadge tone='neutral'>{t('approval.kinds.' + value)}</StatusBadge>
  );
}
