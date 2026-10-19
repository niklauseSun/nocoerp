import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { Alert, AlertDescription } from '#components/ui/alert';
import { BillingError } from '../billing/common.js';
export function FinanceError({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const { t } = useTranslation();
  return error instanceof ApiClientError && error.status === 400 ? (
    <Alert variant='destructive'>
      <AlertDescription>{t('finance.invalidFilters')}</AlertDescription>
    </Alert>
  ) : (
    <BillingError error={error} retry={retry} />
  );
}
