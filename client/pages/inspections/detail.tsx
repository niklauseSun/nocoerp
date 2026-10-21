import { useQueryClient } from '@tanstack/react-query';
import { useMissingRecord } from './helpers.js';
import { str, endpoint } from './helpers.js';
import {
  Link,
  Outlet,
  useLocation,
  useParams,
  useResolvedPath,
  useSearchParams,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { RouteChildPage } from '#components/route-child-page';
import { Button } from '#components/ui/button';
import { LongText } from '#components/long-text';
import { useBusinessQuery } from '../hyl/hooks.js';
import { useCoverFocus } from '../profit-sharing/focus.js';
import {
  Group,
  State,
  Refresh,
  BillingError,
  LoadingRows,
  Paged,
  RecordedAt,
  Day,
  type Row,
  type Kind,
  type Item,
  type Answer,
} from './common.js';
import { Related } from './related.js';
export default function Detail({
  kind,
  readOnly = false,
}: {
  kind: Kind;
  readOnly?: boolean;
}) {
  useCoverFocus();
  const cache = useQueryClient();
  const p = useParams(),
    { t } = useTranslation(),
    l = useLocation(),
    path = useResolvedPath('.').pathname,
    [q, setQ] = useSearchParams(),
    id = readOnly
      ? p.inspectionLeafId
      : p[
          kind === 'plans'
            ? 'inspectionPlanId'
            : kind === 'tasks'
              ? 'inspectionTaskId'
              : 'inspectionIssueId'
        ];
  const eventKey = 'inspectionHistory' + kind,
    result = useBusinessQuery<{ data: Row }>(endpoint(kind) + '/' + id, {
      eventPage: Number(q.get(eventKey)) || 1,
    }),
    r = result.isPlaceholderData ? undefined : result.data?.data;
  useMissingRecord(result.error, kind);
  const backQ = new URLSearchParams(q);
  backQ.delete(eventKey);
  const back = {
    pathname:
      readOnly && path.includes('/source/')
        ? path.slice(0, path.lastIndexOf('/source/'))
        : path.slice(0, path.lastIndexOf('/')),
    search: backQ.toString(),
  };
  const next = [
    'edit',
    'activate',
    'generate',
    'start',
    'save',
    'submit',
    'rectify',
    'pass',
  ].find((a) => r?.allowedActions.includes(a) && !r.blockedActions[a]);
  const link = (suffix: string, label: string) => (
    <Link
      className='underline'
      to={{ pathname: path + '/' + suffix, search: l.search }}
    >
      {label}
    </Link>
  );
  return (
    <RouteChildPage>
      <PageContainer>
        <BackButton to={back} />
        <PageHeader
          title={r ? r.number + ' · ' + r.title : t('inspection.' + kind)}
          description={t(
            readOnly ? 'inspection.readOnly' : 'inspection.description',
          )}
          actions={
            <>
              {!readOnly
                ? r?.allowedActions.map((a) => (
                    <Button
                      key={a}
                      variant={a === next ? 'default' : 'outline'}
                      disabled={!!r.blockedActions[a]}
                      nativeButton={!!r.blockedActions[a]}
                      render={
                        !r.blockedActions[a] ? (
                          <Link
                            to={{ pathname: path + '/' + a, search: l.search }}
                          />
                        ) : undefined
                      }
                    >
                      {t('inspection.actions.' + a)}
                    </Button>
                  ))
                : null}
              <Refresh
                busy={result.isFetching}
                onClick={() => {
                  void result.refetch();
                  void cache.invalidateQueries({
                    predicate: (q) =>
                      q.queryKey[0] === 'hyl' &&
                      String(q.queryKey[1]).startsWith('inspection'),
                  });
                }}
              />
            </>
          }
        />
        {result.error ? (
          <BillingError
            error={result.error}
            retry={() => void result.refetch()}
          />
        ) : !r ? (
          <LoadingRows />
        ) : (
          <>
            <div className='flex flex-wrap items-center gap-3'>
              <State value={r.status} />
              {r.overdue ? <span>{t('inspection.overdue')}</span> : null}
              {['completed', 'closed', 'cancelled', 'archived'].includes(
                r.status,
              ) ? (
                <p>{t('inspection.terminal')}</p>
              ) : null}
            </div>
            {!readOnly
              ? [...new Set(Object.values(r.blockedActions))].map((reason) => (
                  <p key={reason} className='text-sm text-muted-foreground'>
                    {t(
                      reason === 'ACCESS_DENIED'
                        ? 'inspection.restricted'
                        : 'inspection.errors.' + reason,
                    )}
                  </p>
                ))
              : null}
            <Group title={t('inspection.basic')}>
              <dl className='grid gap-3 sm:grid-cols-[8rem_1fr]'>
                {Object.entries({
                  type: t('inspection.types.' + r.type),
                  ...(kind === 'issues'
                    ? {
                        severity: t(
                          'inspection.severities.' + str(r.payload.severity),
                        ),
                        standard: str(r.payload.standard),
                      }
                    : {}),
                  assetName:
                    str(r.payload.assetName) ||
                    ((r.payload.assets ?? []) as { name: string }[])
                      .map((a) => a.name)
                      .join('、'),
                  assigneeName: str(r.payload.assigneeName),
                  day: <Day value={r.day} />,
                  dueOn: <Day value={r.dueOn} />,
                  ...(kind === 'plans'
                    ? {
                        frequency: t(
                          'inspection.frequencies.' + str(r.payload.frequency),
                        ),
                      }
                    : {}),
                  createdAt: <RecordedAt value={r.createdAt} />,
                  updatedAt: <RecordedAt value={r.updatedAt} />,
                }).map(([k, v]) => (
                  <div key={k} className='contents'>
                    <dt className='text-muted-foreground'>
                      {t('inspection.fields.' + k)}
                    </dt>
                    <dd className='min-w-0 break-words'>
                      {k === 'standard' ? (
                        <LongText>{str(v) || '—'}</LongText>
                      ) : (
                        v || '—'
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              {[
                'notes',
                'description',
                'evidence',
                'rectification',
                'rectificationEvidence',
                'recheck',
              ]
                .filter((k) => str(r.payload[k]))
                .map((k) => (
                  <div key={k}>
                    <h3 className='font-medium'>
                      {t('inspection.fields.' + k)}
                    </h3>
                    <LongText>{str(r.payload[k])}</LongText>
                  </div>
                ))}
            </Group>
            {kind !== 'issues' ? (
              <Group title={t('inspection.checklist')}>
                {((r.payload.items ?? []) as Item[]).map((item) => {
                  const a = ((r.payload.results ?? []) as Answer[]).find(
                    (v) => v.itemId === item.id,
                  );
                  return (
                    <div
                      key={item.id}
                      className='flex flex-col gap-2 border-b pb-3'
                    >
                      <h3 className='font-medium'>{item.name}</h3>
                      <LongText>{item.standard || '—'}</LongText>
                      {kind === 'tasks' ? (
                        <>
                          <span>
                            {t('inspection.fields.result')}：
                            {t(
                              a
                                ? 'inspection.results.' + a.result
                                : 'inspection.unanswered',
                            )}
                          </span>
                          {a?.note ? <LongText>{a.note}</LongText> : null}
                        </>
                      ) : null}
                    </div>
                  );
                })}
              </Group>
            ) : null}
            {!readOnly ? (
              <>
                <Group title={t('inspection.related')}>
                  <div className='flex flex-wrap gap-4'>
                    {link(
                      'source/asset/' + r.assetId,
                      t('inspection.assetSource'),
                    )}
                    {r.planId
                      ? link(
                          'source/plans/' + r.planId,
                          t('inspection.planSource'),
                        )
                      : null}
                    {r.taskId
                      ? link(
                          'source/tasks/' + r.taskId,
                          t('inspection.taskSource'),
                        )
                      : null}
                    {r.repairId
                      ? link(
                          'repair/' + r.repairId,
                          t('inspection.repairSource'),
                        )
                      : null}
                  </div>
                </Group>
                {kind === 'plans' ? (
                  <Related kind='tasks' scope='plan' id={r.id} />
                ) : kind === 'tasks' ? (
                  <Related kind='issues' scope='task' id={r.id} />
                ) : null}
              </>
            ) : null}
            <Group title={t('inspection.history')}>
              {r.events?.data.map((e) => (
                <div key={e.id} className='flex flex-col gap-2 border-b pb-3'>
                  <div className='flex flex-wrap gap-3'>
                    <span className='font-medium'>
                      {t('inspection.actions.' + e.action)}
                    </span>
                    {(e.payload.details as Record<string, unknown> | undefined)
                      ?.automatic ? (
                      <span>{t('inspection.auto')}</span>
                    ) : null}
                    <span>{str(e.payload.actorName) || '—'}</span>
                    <RecordedAt value={e.createdAt} />
                  </div>
                  <div className='flex flex-wrap gap-2'>
                    {e.fromState ? (
                      <>
                        <State value={e.fromState} />
                        <span>→</span>
                      </>
                    ) : null}
                    <State value={e.toState} />
                  </div>
                  {['note', 'evidence', 'description']
                    .filter((k) =>
                      str(
                        (
                          e.payload.details as
                            Record<string, unknown> | undefined
                        )?.[k],
                      ),
                    )
                    .map((k) => (
                      <LongText key={k}>
                        {str(
                          (
                            e.payload.details as
                              Record<string, unknown> | undefined
                          )?.[k],
                        )}
                      </LongText>
                    ))}
                </div>
              ))}
              {r.events ? (
                <Paged
                  meta={r.events.meta}
                  busy={result.isFetching}
                  onChange={(v) => {
                    const n = new URLSearchParams(q);
                    n.set(eventKey, String(v));
                    setQ(n);
                  }}
                />
              ) : null}
            </Group>
          </>
        )}
        <Outlet />
      </PageContainer>
    </RouteChildPage>
  );
}
