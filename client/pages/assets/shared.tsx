import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
} from '#components/ui/empty';
import { Building2 } from 'lucide-react';
import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { Alert, AlertDescription } from '#components/ui/alert';
import { ErrorPanel } from '../hyl/common.js';
import { Button } from '#components/ui/button';
export function AssetError({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const key =
    error instanceof ApiClientError ? `assets.errors.${error.reason}` : '';
  return key && i18n.exists(key) ? (
    <Alert variant='destructive'>
      <AlertDescription>{t(key)}</AlertDescription>
    </Alert>
  ) : (
    <ErrorPanel error={error} retry={retry} />
  );
}
export function Pager({
  page,
  total,
  pageSize = 20,
  busy,
  onChange,
}: {
  page: number;
  total: number;
  pageSize?: number;
  busy: boolean;
  onChange: (page: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className='flex flex-wrap items-center gap-2'>
      <Button
        type='button'
        variant='outline'
        disabled={busy || page <= 1}
        onClick={() => onChange(page - 1)}
      >
        {t('hyl.actions.previous')}
      </Button>
      <span className='text-sm text-muted-foreground'>
        {t('hyl.copy.count', { total, page })}
      </span>
      <Button
        type='button'
        variant='outline'
        disabled={busy || page * pageSize >= total}
        onClick={() => onChange(page + 1)}
      >
        {t('hyl.actions.next')}
      </Button>
    </div>
  );
}

export function AssetEmpty({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <Empty className='min-h-40 border border-dashed'>
      <EmptyHeader>
        <EmptyMedia variant='icon'>
          <Building2 />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? (
          <EmptyDescription>{description}</EmptyDescription>
        ) : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}
