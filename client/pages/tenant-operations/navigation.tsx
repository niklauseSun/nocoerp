import { useSearchParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { Button } from '#components/ui/button';
import { views } from '../../../server/tenant-operations/model.js';
const operationViews = [...views, 'batches', 'tenantService', 'integrations'];
export function OperationsNav({ view }: { view: string }) {
  const { t } = useTranslation(),
    [params, setParams] = useSearchParams();
  return (
    <nav
      className='flex min-w-0 flex-wrap gap-2 max-md:flex-nowrap max-md:overflow-x-auto'
      aria-label={t('operations.title')}
    >
      {operationViews.map((v) => (
        <Button
          key={v}
          variant='outline'
          className='shrink-0'
          aria-current={view === v ? 'page' : undefined}
          onClick={() => {
            const q = new URLSearchParams(params);
            q.set('view', v);
            for (const k of [
              'q',
              'status',
              'type',
              'order',
              'page',
              'group',
              'projectId',
            ])
              q.delete(k);
            setParams(q);
          }}
        >
          {t('operations.' + v)}
        </Button>
      ))}
    </nav>
  );
}
