import { useTranslation } from '@nocobase/i18n/client';
import { Skeleton } from '#components/ui/skeleton';
import { Card, CardHeader, CardContent } from '#components/ui/card';
export function ReportSkeleton() {
  const { t } = useTranslation();
  return (
    <div
      role='status'
      aria-label={t('hyl.copy.load')}
      className='flex flex-col gap-6'
    >
      <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
        {Array.from({ length: 8 }, (_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className='h-4 w-2/3' />
            </CardHeader>
            <CardContent>
              <Skeleton className='h-6 w-3/4' />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className='flex flex-wrap gap-2'>
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className='h-8 w-20' />
        ))}
      </div>
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className='h-10 w-full' />
      ))}
    </div>
  );
}
export function SourceSkeleton() {
  const { t } = useTranslation();
  return (
    <div role='status' aria-label={t('hyl.copy.load')}>
      <dl className='grid grid-cols-[8rem_1fr] gap-4'>
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className='contents'>
            <dt>
              <Skeleton className='h-4 w-24' />
            </dt>
            <dd>
              <Skeleton className='h-4 w-full' />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
