import { useApiClient, ApiClientError } from '@nocobase/app-client';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import type { Kind } from './model.js';
export function useBusinessQuery<T>(
  path: string,
  query?: Record<string, string | number>,
  enabled = true,
) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['hyl', path, query],
    queryFn: () => api.request<T>({ path, query }),
    enabled,
    placeholderData: query ? keepPreviousData : undefined,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
export function useBusinessPermission(kind: Kind, action: string) {
  return useCan({ resource: { type: 'composite', id: `hyl.${kind}` }, action });
}
export function useErrorText() {
  const { t, i18n } = useTranslation();
  return (error: unknown): string => {
    if (error instanceof ApiClientError) {
      const procurementKey = 'procurement.errors.' + error.reason;
      if (i18n.exists(procurementKey)) return t(procurementKey);
      const inspectionKey = `inspection.errors.${error.reason}`;
      if (i18n.exists(inspectionKey)) return t(inspectionKey);
      const key = `hyl.errors.${error.reason}`;
      const repairKey = `repair.errors.${error.reason}`;
      if (i18n.exists(repairKey)) return t(repairKey);
      const energyKey = `energy.errors.${error.reason}`;
      if (i18n.exists(energyKey)) return t(energyKey);
      const invoiceKey = `invoice.errors.${error.reason}`;
      if (i18n.exists(invoiceKey)) return t(invoiceKey);
      const splitKey = `split.errors.${error.reason}`;
      if (i18n.exists(splitKey)) return t(splitKey);
      const cashierKey = `cashier.errors.${error.reason}`;
      if (i18n.exists(cashierKey)) return t(cashierKey);
      const billingKey = `billing.errors.${error.reason}`;
      return i18n.exists(key)
        ? t(key)
        : i18n.exists(billingKey)
          ? t(billingKey)
          : t(
              `hyl.errors.${[401, 403, 404, 409].includes(error.status) ? error.status : 'generic'}`,
            );
    }
    return t('hyl.errors.network');
  };
}
