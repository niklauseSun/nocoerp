import { useParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { RouteDrawer } from '#components/route-drawer';
import { ErrorBox, LoadingRows } from '../organization/common.js';
import { useLogs, type Log } from './data.js';
export default function LogDetail() {
  const { id = '' } = useParams(),
    { t, i18n } = useTranslation(),
    r = useLogs<{ data: Log }>('/operationLogs/' + id),
    row = r.data?.data;
  const values = row
    ? {
        id: row.id,
        createdAt: new Intl.DateTimeFormat(i18n.language, {
          dateStyle: 'full',
          timeStyle: 'long',
          timeZone: 'Asia/Shanghai',
        }).format(new Date(row.createdAt)),
        actor: row.actorName || t('operationLogs.unknownActor'),
        actorId: row.actorId || '—',
        module: t('operationLogs.modules.' + row.module),
        action: t('operationLogs.actions.' + row.action, {
          defaultValue: row.action,
        }),
        targetId: row.targetId || '—',
        route: row.method + ' ' + row.pathTemplate,
        result: t('operationLogs.' + row.result),
        httpStatus: String(row.httpStatus),
        errorCode: row.errorCode || '—',
        requestId: row.requestId,
        durationMs: new Intl.NumberFormat(i18n.language).format(row.durationMs),
      }
    : {};
  return (
    <RouteDrawer title={t('operationLogs.detail')} description={id}>
      <ErrorBox error={r.error} retry={() => void r.refetch()} />
      {r.isFetching && !row ? (
        <LoadingRows />
      ) : row && !r.isError ? (
        <dl className='grid gap-4'>
          {Object.entries(values).map(([key, value]) => (
            <div key={key}>
              <dt className='text-sm text-muted-foreground'>
                {t('operationLogs.' + key)}
              </dt>
              <dd className='break-all text-sm'>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </RouteDrawer>
  );
}
