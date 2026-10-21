import { endpoint, useInspectionCan } from './helpers.js';
import { Link, useLocation, useResolvedPath } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useBusinessQuery } from '../hyl/hooks.js';
import {
  Group,
  State,
  BillingError,
  LoadingRows,
  Truncated,
  type Kind,
  type Row,
  type Page,
} from './common.js';
export function Related({
  kind,
  scope,
  id,
}: {
  kind: Kind;
  scope: 'plan' | 'task' | 'asset' | 'repair';
  id: string;
}) {
  const { t } = useTranslation(),
    l = useLocation(),
    path = useResolvedPath('.').pathname,
    can = useInspectionCan('read'),
    rows = useBusinessQuery<Page<Row>>(
      endpoint(kind),
      { [scope + 'Id']: id, pageSize: 10 },
      can.can && !!id,
    ),
    base = path + '/inspection' + kind;
  return (
    <Group title={t('inspection.' + kind)}>
      {!can.can ? (
        <p>{t('inspection.restricted')}</p>
      ) : rows.error ? (
        <BillingError error={rows.error} retry={() => void rows.refetch()} />
      ) : !rows.data ? (
        <LoadingRows />
      ) : (
        <>
          <Link className='underline' to={{ pathname: base, search: l.search }}>
            {t('inspection.viewAll')} ({rows.data.meta.total})
          </Link>
          {rows.data.data.length ? (
            <>
              <p className='text-sm text-muted-foreground'>
                {t('inspection.preview')}
              </p>
              {rows.data.data.map((r) => (
                <div
                  key={r.id}
                  className='flex flex-wrap items-center gap-3 border-b py-2'
                >
                  <Link
                    className='underline'
                    to={{ pathname: base + '/' + r.id, search: l.search }}
                  >
                    {r.number}
                  </Link>
                  <Truncated>{r.title}</Truncated>
                  <State value={r.status} />
                </div>
              ))}
            </>
          ) : (
            <p>{t('inspection.empty')}</p>
          )}
        </>
      )}
    </Group>
  );
}
