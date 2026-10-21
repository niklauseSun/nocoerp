import { useQueryClient } from '@tanstack/react-query';
import { useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useWork } from '../cashier/work.js';
export { useBusinessQuery } from '../hyl/hooks.js';
export function useCheck() {
  const api = useApiClient(),
    cache = useQueryClient(),
    toast = useToaster(),
    { t } = useTranslation(),
    w = useWork();
  return {
    ...w,
    check: async () => {
      if (w.busy) return;
      w.setBusy(true);
      w.setError(undefined);
      try {
        const r = await api.request<{
          data: {
            created: number;
            sent: number;
            resolved: number;
            failed: number;
            busy: boolean;
          };
        }>({ path: 'messageChecks', method: 'POST', json: {} });
        await cache.invalidateQueries({ queryKey: ['hyl'] });
        toast.show({
          title: t(
            r.data.busy ? 'messages.checkBusy' : 'messages.checked',
            r.data,
          ),
        });
      } catch (e) {
        w.fail(e);
      } finally {
        w.setBusy(false);
      }
    },
  };
}
