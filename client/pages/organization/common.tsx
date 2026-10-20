import { Network } from 'lucide-react';
import { Spinner } from '#components/ui/spinner';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '#components/ui/empty';
import type { ReactNode } from 'react';
import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '#components/ui/card';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Link } from 'react-router';
import { Button } from '#components/ui/button';
export {
  Choice,
  Search,
  Paged,
  LoadingRows,
  BillingError,
  Truncated,
} from '../approvals/common.js';
import { Confirm as SharedConfirm } from '../cashier/common.js';
export function Confirm({
  open,
  title,
  description,
  busy,
  onCancel,
  onConfirm,
  error,
  label,
}: {
  open: boolean;
  title: string;
  description: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  error?: unknown;
  label: string;
}) {
  return (
    <SharedConfirm
      open={open}
      onOpenChange={(v) => {
        if (!v && !busy) onCancel();
      }}
      title={title}
      busy={busy}
      destructive
      rich
      label={label}
      onConfirm={onConfirm}
    >
      <>
        <p>{description}</p>
        <ErrorBox error={error} />
      </>
    </SharedConfirm>
  );
}
export function Group({
  title,
  description,
  children,
  busy = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Card aria-busy={busy}>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          {title}
          {busy ? <Spinner aria-label={t('hyl.copy.load')} /> : null}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>{children}</CardContent>
    </Card>
  );
}
export function Denied() {
  const { t } = useTranslation();
  return (
    <p role='status' className='text-sm text-muted-foreground'>
      {t('organization.denied')}
    </p>
  );
}
export function ErrorBox({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const { t, i18n } = useTranslation();
  if (!error) return null;
  const code = error instanceof ApiClientError ? error.reason : '',
    status = error instanceof ApiClientError ? error.status : 0,
    key = 'organization.errors.' + code;
  return (
    <Alert variant='destructive'>
      <AlertDescription>
        {i18n.exists(key)
          ? t(key)
          : t(
              'hyl.errors.' +
                ([401, 403, 404, 409].includes(status) ? status : 'generic'),
            )}
        {status === 401 ? (
          <Button
            variant='outline'
            nativeButton={false}
            render={<Link to='/login' />}
          >
            {t('hyl.actions.login')}
          </Button>
        ) : null}
        {![401, 403, 404].includes(status) && retry ? (
          <Button variant='outline' onClick={retry}>
            {t('hyl.actions.retry')}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
export interface Department {
  id: string;
  title: string;
  parentId: string | null;
  active: boolean;
  version: number;
}
export interface Member {
  id: string;
  departmentId: string;
  userId: string;
  active: boolean;
  primary: boolean;
}
export interface Assignment {
  id: string;
  projectId: string;
  subjectType: string;
  subjectId: string;
  active: boolean;
  version: number;
}
export interface Snapshot {
  memberProfiles?: Record<string, { email: string; disabledAt: string | null }>;
  names: Record<string, string>;
  departments: Department[];
  members: Member[];
  projects: Assignment[];
}
export interface Options {
  users: {
    id: string;
    name: string;
    email: string;
    disabledAt: string | null;
  }[];
  userTotal: number;
  projects: { id: string; name: string }[];
  projectTotal: number;
}

export function OrgEmpty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Empty className='min-h-32 rounded-lg border border-dashed'>
      <EmptyHeader>
        <EmptyMedia variant='icon'>
          <Network />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}
