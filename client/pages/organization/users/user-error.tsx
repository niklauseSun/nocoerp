import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { Alert, AlertDescription } from '#components/ui/alert';
import { ErrorBox } from '../common.js';
export function UserError({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const key =
    'organization.staffErrors.' +
    (error instanceof ApiClientError ? error.reason : '');
  if (
    error instanceof ApiClientError &&
    ![401, 403, 404].includes(error.status) &&
    i18n.exists(key)
  )
    return (
      <Alert variant='destructive'>
        <AlertDescription>{t(key)}</AlertDescription>
      </Alert>
    );
  return <ErrorBox error={error} retry={retry} />;
}
