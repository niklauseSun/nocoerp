import { useState, useRef } from 'react';
import { useApiClient, useToaster } from '@nocobase/app-client';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from '@nocobase/i18n/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useSetting } from '../organization/hooks.js';
export { useOrg as useWecom } from '../organization/hooks.js';
export function useWrite() {
  const settings = useSetting('hyl.wecom', 'update'),
    org = useSetting('hyl.organization', 'update');
  const read = useCan({ resource: { type: 'user', id: '*' }, action: 'read' }),
    create = useCan({ resource: { type: 'user', id: '*' }, action: 'create' }),
    update = useCan({ resource: { type: 'user', id: '*' }, action: 'update' }),
    disable = useCan({
      resource: { type: 'user', id: '*' },
      action: 'disable',
    }),
    enable = useCan({ resource: { type: 'user', id: '*' }, action: 'enable' });
  return (
    settings.can &&
    org.can &&
    read.can &&
    create.can &&
    update.can &&
    disable.can &&
    enable.can
  );
}
export function useAction() {
  const api = useApiClient(),
    cache = useQueryClient(),
    toast = useToaster(),
    { t } = useTranslation(),
    lockRef = useRef(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  return {
    busy,
    error,
    async run<T>(path: string, json: object): Promise<T | undefined> {
      if (lockRef.current) return;
      lockRef.current = true;
      setBusy(true);
      setError(undefined);
      try {
        const result = await api.request<T>({ path, method: 'POST', json });
        await cache.invalidateQueries({ queryKey: ['organization'] });
        toast.show({ title: t('wecom.saved') });
        return result;
      } catch (e) {
        setError(e);
      } finally {
        lockRef.current = false;
        setBusy(false);
      }
    },
  };
}
