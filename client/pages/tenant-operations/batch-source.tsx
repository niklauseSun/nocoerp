import {
  Link,
  Outlet,
  useLocation,
  useParams,
  useResolvedPath,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { Button } from '#components/ui/button';
import { LongText } from '#components/long-text';
import { useBusinessQuery, useBusinessPermission } from '../hyl/hooks.js';
import {
  amountText,
  availableActions,
  permissionFor,
  specs,
  scalar,
  type Kind,
  type BusinessRow,
} from '../hyl/model.js';
import { BusinessStatus } from '../hyl/status.js';
import {
  LoadingRows,
  BillingError,
  Money,
  Refresh,
} from '../billing/common.js';
import { Cover } from './delivery-common.js';
import { useRefreshMissing } from './delivery-hooks.js';
function Action({ action }: { action: string }) {
  const { can } = useBusinessPermission('settlements', permissionFor(action)),
    l = useLocation(),
    { t } = useTranslation();
  return can ? (
    <Button
      variant='outline'
      nativeButton={false}
      render={<Link to={{ pathname: action, search: l.search }} />}
    >
      {t('hyl.actions.' + action)}
    </Button>
  ) : null;
}
export default function BatchSource() {
  const { id, batchId } = useParams(),
    path = useResolvedPath('.').pathname,
    { t, i18n } = useTranslation(),
    kind: Kind =
      path.split('/').at(-2) === 'contract' ? 'contracts' : 'settlements',
    r = useBusinessQuery<{ data: BusinessRow }>(kind + '/' + id),
    row = r.error ? undefined : r.data?.data,
    fields =
      kind === 'settlements'
        ? ((row?.payload.contract ?? {}) as Record<string, unknown>)
        : (row?.payload ?? {});
  useRefreshMissing(r.error);
  return (
    <>
      <Cover
        parent={'/tenantOperations/batch/' + batchId}
        title={row?.number || t('hyl.nav.' + kind)}
        actions={
          <>
            {row && kind === 'settlements'
              ? availableActions(kind, row)
                  .filter(
                    (a) =>
                      a !== 'edit' &&
                      (a !== 'confirm' || !!row.confirmationModes?.length) &&
                      (a !== 'dispute' ||
                        row.confirmationModes?.includes('online')),
                  )
                  .map((a) => <Action key={a} action={a} />)
              : null}
            <Refresh busy={r.isFetching} onClick={() => void r.refetch()} />
          </>
        }
      >
        {r.error ? (
          <BillingError error={r.error} retry={() => void r.refetch()} />
        ) : !row ? (
          <LoadingRows />
        ) : (
          <>
            <BusinessStatus status={row.status} />
            <dl className='grid gap-3 text-sm sm:grid-cols-[10rem_1fr]'>
              <dt>{t('operations.amount')}</dt>
              <dd>
                <Money cents={row.amountCents} />
              </dd>
              {kind === 'settlements'
                ? Object.entries(
                    (row.payload.amounts ?? {}) as Record<string, string>,
                  ).map(([key, value]) => (
                    <div key={key} className='contents'>
                      <dt>{t('hyl.fields.' + key)}</dt>
                      <dd>{amountText(value, i18n.language)}</dd>
                    </div>
                  ))
                : null}
              {specs[kind === 'settlements' ? 'contracts' : kind]
                .filter((f) => f.key !== 'merchantId' && f.key !== 'contractId')
                .map((f) => (
                  <div key={f.key} className='contents'>
                    <dt>{t('hyl.fields.' + f.key)}</dt>
                    <dd className='break-words'>
                      <LongText>
                        {typeof fields[f.key] === 'boolean'
                          ? t('hyl.copy.' + (fields[f.key] ? 'yes' : 'no'))
                          : i18n.exists('hyl.enums.' + scalar(fields[f.key]))
                            ? t('hyl.enums.' + scalar(fields[f.key]))
                            : f.type === 'money'
                              ? amountText(fields[f.key], i18n.language)
                              : scalar(fields[f.key]) || '—'}
                      </LongText>
                    </dd>
                  </div>
                ))}
            </dl>
          </>
        )}
      </Cover>
      <Outlet context={{ kind, row, reload: () => r.refetch() }} />
    </>
  );
}
