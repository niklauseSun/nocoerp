import { useBusinessQuery } from './hooks.js';
import { Link, useLocation, useResolvedPath } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { ApiClientError } from '@nocobase/app-client';
import { Button } from '#components/ui/button';
import { Group, State, BillingError, LoadingRows } from './common.js';
export interface SourceView {
  kind: string;
  id: string;
  number: string;
  title: string;
  version: number;
  status: string;
  required: boolean;
  canSubmit: boolean;
  path: string;
  snapshot: Record<string, unknown>;
  request: null | { id: string; status: string; level: number; round: number };
  levels: { name: string; count: number }[];
}
export function ApprovalPanel({ kind, id }: { kind: string; id: string }) {
  const { t } = useTranslation(),
    l = useLocation(),
    base = useResolvedPath('.').pathname,
    r = useBusinessQuery<{ data: SourceView }>(
      'approvalSources/' + kind + '/' + id,
    ),
    d = r.error ? undefined : r.data?.data;
  if (r.error instanceof ApiClientError && r.error.status === 403) return null;
  return (
    <Group title={t('approval.title')}>
      {r.error ? (
        <BillingError error={r.error} retry={() => void r.refetch()} />
      ) : r.isPending ? (
        <LoadingRows />
      ) : d ? (
        <>
          <p className='text-sm text-muted-foreground'>
            {t(
              d.required ? 'approval.effects.' + kind : 'approval.notRequired',
            )}
          </p>
          {d.request ? (
            <div className='flex flex-wrap items-center gap-3'>
              <State value={d.request.status} />
              <span className='text-sm'>
                {t('approval.level')} · {d.levels[d.request.level]?.name ?? '—'}
              </span>
              <Button
                variant='outline'
                nativeButton={false}
                render={
                  <Link
                    to={{
                      pathname: base + '/approvalRequests/' + d.request.id,
                      search: l.search,
                    }}
                  />
                }
              >
                {t('approval.detail')}
              </Button>
            </div>
          ) : null}
          {d.canSubmit ? (
            <Button
              className='self-start'
              nativeButton={false}
              render={
                <Link
                  to={{
                    pathname: base + '/approvalSubmit',
                    search: new URLSearchParams({
                      ...Object.fromEntries(new URLSearchParams(l.search)),
                      approvalKind: kind,
                      approvalSourceId: id,
                    }).toString(),
                  }}
                />
              }
            >
              {t('approval.submit')}
            </Button>
          ) : null}
        </>
      ) : null}
    </Group>
  );
}
