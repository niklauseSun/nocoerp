import { useTranslation } from '@nocobase/i18n/client';
import { Link, useLocation } from 'react-router';
import { Skeleton } from '#components/ui/skeleton';
import { Button } from '#components/ui/button';
import { StatusBadge } from '#components/status-badge';
export {
  Choice,
  Search,
  Paged,
  BillingError,
  LoadingRows,
  Refresh,
  Truncated,
  Day,
  RecordedAt,
  Group,
  FormField,
  Confirm,
} from '../cashier/common.js';
export interface Todo {
  id: string;
  kind: string;
  reason: string;
  dueOn: string;
  status: string;
  generation: number;
  createdAt: string;
  updatedAt: string;
  number: string;
  title: string;
  path: string;
  notificationId: string;
  deliveryStatus: string;
  canRetry: boolean;
}
export interface Prefs {
  version: number;
  enabled: boolean;
  contracts: boolean;
  bills: boolean;
  repairs: boolean;
  purchases: boolean;
  contractDays: number;
  billDays: number;
  locale: 'zh-CN' | 'en-US';
  createdAt: string;
  updatedAt: string;
  lastCheckedAt: string;
  lastError: string;
}
export function State({ value }: { value: string }) {
  const { t } = useTranslation();
  return (
    <StatusBadge
      tone={
        value === 'resolved' || value === 'completed'
          ? 'success'
          : value === 'failed'
            ? 'warning'
            : 'info'
      }
    >
      {t('messages.states.' + value)}
    </StatusBadge>
  );
}
export function Nav() {
  const { t } = useTranslation();
  const l = useLocation();
  return (
    <nav className='flex flex-wrap gap-2' aria-label={t('messages.title')}>
      {[
        ['/inbox', 'title'],
        ['/messageTodos', 'todos'],
        ['/messagePreferences', 'preferences'],
      ].map(([path, k]) => (
        <Button
          key={path}
          variant='outline'
          nativeButton={false}
          render={
            <Link
              to={{ pathname: path, search: path === '/inbox' ? '' : l.search }}
            />
          }
        >
          {t('messages.' + k)}
        </Button>
      ))}
    </nav>
  );
}

export function DetailsSkeleton({ form = false }: { form?: boolean }) {
  return (
    <div className='grid gap-4' aria-busy='true'>
      {[0, 1].map((i) => (
        <div key={i} className='rounded-lg border bg-card p-6'>
          <Skeleton className='mb-6 h-5 w-40' />
          <div className='grid gap-4 sm:grid-cols-2'>
            {[0, 1, 2, 3].map((j) => (
              <div
                key={j}
                className={
                  form ? 'grid gap-2' : 'grid grid-cols-[8rem_1fr] gap-3'
                }
              >
                <Skeleton className='h-4 w-24' />
                <Skeleton className={form ? 'h-9 w-full' : 'h-4 w-full'} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
