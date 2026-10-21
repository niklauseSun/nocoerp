import { useCoverFocus } from '../profit-sharing/focus.js';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { RouteChildPage } from '#components/route-child-page';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { StatusBadge } from '#components/status-badge';
export function Cover({
  title,
  description,
  actions,
  children,
  parent = '/tenantOperations',
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  parent?: string;
}) {
  useCoverFocus();
  const l = useLocation();
  return (
    <RouteChildPage>
      <PageContainer>
        <BackButton to={{ pathname: parent, search: l.search }} />
        <PageHeader title={title} description={description} actions={actions} />
        {children}
      </PageContainer>
    </RouteChildPage>
  );
}
export function DeliveryStatus({ status }: { status: string }) {
  const { t, i18n } = useTranslation(),
    key = 'operations.deliveryStatuses.' + status;
  return (
    <StatusBadge
      tone={
        ['completed', 'closed', 'published', 'succeeded'].includes(status)
          ? 'success'
          : ['failed', 'withdrawn'].includes(status)
            ? 'warning'
            : 'info'
      }
    >
      {t(i18n.exists(key) ? key : 'operations.blocked')}
    </StatusBadge>
  );
}
export function Reason({ reason }: { reason: string }) {
  const { t, i18n } = useTranslation(),
    key = 'operations.reasons.' + reason;
  return (
    <>
      {reason
        ? t(i18n.exists(key) ? key : 'operations.reasons.INVALID_ARGUMENT')
        : '—'}
    </>
  );
}
