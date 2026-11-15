import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Button } from '#components/ui/button';
import { Link } from 'react-router';
import { Confirm as SharedConfirm } from '../cashier/common.js';
export {
  LoadingRows,
  Choice,
  Search,
  Paged,
  Truncated,
  Group,
} from '../organization/common.js';
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
      title={title}
      busy={busy}
      destructive
      rich
      label={label}
      onOpenChange={(v) => {
        if (!v && !busy) onCancel();
      }}
      onConfirm={onConfirm}
    >
      <>
        <p>{description}</p>
        <ErrorBox error={error} />
      </>
    </SharedConfirm>
  );
}
export interface Snapshot {
  name: string;
  parent?: string;
  email?: string;
  departments?: string[];
  primary?: string;
  enabled: boolean;
}
export interface Mapping {
  id: string;
  kind: 'user' | 'department';
  localId: string;
  remoteId: string;
  localExists: boolean;
  remoteExists: boolean;
  baseline: Snapshot | null;
  intent?: Snapshot | null;
  state: string;
  error: string;
  updatedAt: string;
}
export interface Preview {
  mapping: Mapping;
  local: Snapshot | null;
  remote: Snapshot | null;
  suggested: string;
  fingerprint: string;
  history: {
    id: string;
    actor: string;
    direction: string;
    result: string;
    error: string;
    at: string;
  }[];
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
  const status = error instanceof ApiClientError ? error.status : 0,
    key =
      'wecom.errors.' + (error instanceof ApiClientError ? error.reason : '');
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
        {retry && ![401, 403, 404].includes(status) ? (
          <Button variant='outline' onClick={retry}>
            {t('hyl.actions.retry')}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
