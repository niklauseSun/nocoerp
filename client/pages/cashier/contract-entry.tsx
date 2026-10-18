import { useCashierPermission } from './permission.js';
import { Link, useLocation } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { Button } from '#components/ui/button';
export function CashierContractEntry() {
  const { t } = useTranslation(),
    l = useLocation(),
    permission = useCashierPermission('cashierCheckout');
  return permission.can ? (
    <Button
      nativeButton={false}
      variant='outline'
      render={
        <Link to={{ pathname: `${l.pathname}/cashierNew`, search: l.search }} />
      }
    >
      {t('cashier.newOrder')}
    </Button>
  ) : null;
}
