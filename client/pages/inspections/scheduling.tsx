import { useState } from 'react';
import { Link, useLocation, useResolvedPath } from 'react-router';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import { useBusinessQuery } from '../hyl/hooks.js';
import { useWork } from '../cashier/work.js';
import {
  Group,
  Refresh,
  Paged,
  Confirm,
  BillingError,
  LoadingRows,
  RecordedAt,
  type Page,
} from './common.js';
type Schedule = {
  id: string;
  key: string;
  enabled: boolean;
  scheduleStatus: string;
  targetState: string;
  nextRunAt?: string;
  lastRunAt?: string;
  runCount: number;
  completedCount: number;
};
type Occurrence = {
  id: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  reason?: string;
  resultSummary?: { plans?: number; tasks?: number; failed?: number };
};
export default function Scheduling() {
  const { t } = useTranslation(),
    l = useLocation(),
    path = useResolvedPath('.').pathname,
    api = useApiClient(),
    toast = useToaster(),
    w = useWork(),
    can = useCan({
      resource: { type: 'page', id: 'scheduler.schedules' },
      action: 'access',
    }),
    [page, setPage] = useState(1),
    [tokens, setTokens] = useState<string[]>(['']),
    [index, setIndex] = useState(0),
    [confirm, setConfirm] = useState(false);
  const schedules = useBusinessQuery<Page<Schedule>>(
      'scheduler/schedules',
      { page, pageSize: 20 },
      can.can,
    ),
    schedule = schedules.data?.data.find(
      (s) => s.key === 'inspections.dispatch',
    ),
    runs = useBusinessQuery<{
      data: Occurrence[];
      meta: { nextPageToken?: string };
    }>(
      'scheduler/schedules/' + schedule?.id + '/occurrences',
      { pageSize: 20, ...(tokens[index] ? { pageToken: tokens[index] } : {}) },
      !!schedule && can.can,
    );
  const toggle = async () => {
    if (!schedule || w.busy || schedules.isPlaceholderData) return;
    const wasEnabled = schedule.enabled;
    w.setBusy(true);
    try {
      await api.request({
        path:
          'scheduler/schedules/' +
          schedule.id +
          '/' +
          (wasEnabled ? 'disable' : 'enable'),
        method: 'POST',
      });
      await schedules.refetch();
      setConfirm(false);
      toast.show({
        title: t('inspection.success', {
          name: t('inspection.scheduling'),
          action: t(
            wasEnabled
              ? 'inspection.actions.pause'
              : 'inspection.actions.activate',
          ),
        }),
      });
    } catch (e) {
      w.fail(e);
    }
    w.setBusy(false);
  };
  return (
    <PageContainer>
      <PageHeader
        title={t('inspection.scheduling')}
        description={t('inspection.schedulerHelp')}
        actions={
          <Refresh
            busy={schedules.isFetching || runs.isFetching}
            onClick={() => {
              void schedules.refetch();
              if (schedule) void runs.refetch();
            }}
          />
        }
      />
      <nav className='flex flex-wrap gap-2'>
        {['plans', 'tasks', 'issues', 'scheduling'].map((k) => (
          <Button
            key={k}
            variant={k === 'scheduling' ? 'secondary' : 'outline'}
            nativeButton={false}
            render={
              <Link
                to={{
                  pathname: path.slice(0, path.lastIndexOf('/')) + '/' + k,
                  search: l.search,
                }}
              />
            }
          >
            {t('inspection.' + k)}
          </Button>
        ))}
      </nav>
      {!can.can ? (
        <p>{t('inspection.schedulerRestricted')}</p>
      ) : schedules.error ? (
        <BillingError
          error={schedules.error}
          retry={() => void schedules.refetch()}
        />
      ) : !schedules.data ? (
        <LoadingRows />
      ) : (
        <>
          <Paged
            meta={schedules.data.meta}
            busy={schedules.isFetching}
            onChange={setPage}
          />
          {!schedule ? (
            <p>{t('inspection.empty')}</p>
          ) : (
            <>
              <Group title={t('inspection.plans')}>
                <dl className='grid gap-3 sm:grid-cols-[8rem_1fr]'>
                  {[
                    [
                      'status',
                      t(
                        schedule.enabled
                          ? 'inspection.enabled'
                          : 'inspection.disabled',
                      ),
                    ],
                    [
                      'scheduleStatus',
                      t('inspection.scheduleStates.' + schedule.scheduleStatus),
                    ],
                    [
                      'targetState',
                      t('inspection.targetStates.' + schedule.targetState),
                    ],
                    ['nextRunAt', schedule.nextRunAt],
                    ['lastRunAt', schedule.lastRunAt],
                    ['runCount', schedule.runCount],
                    ['completedCount', schedule.completedCount],
                  ].map(([k, v]) => (
                    <div key={String(k)} className='contents'>
                      <dt className='text-muted-foreground'>
                        {t('inspection.schedulerFields.' + k)}
                      </dt>
                      <dd>
                        {typeof v === 'string' && String(k).endsWith('At') ? (
                          <RecordedAt value={v} />
                        ) : (
                          (v ?? '—')
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
                <Button
                  variant='outline'
                  disabled={schedules.isFetching}
                  onClick={() => setConfirm(true)}
                >
                  {t(
                    schedule.enabled
                      ? 'inspection.actions.pause'
                      : 'inspection.actions.activate',
                  )}
                </Button>
              </Group>
              <Group title={t('inspection.occurrences')}>
                {runs.isFetching && runs.data ? (
                  <p role='status'>{t('inspection.refreshing')}</p>
                ) : null}
                {runs.error ? (
                  <BillingError
                    error={runs.error}
                    retry={() => void runs.refetch()}
                  />
                ) : !runs.data ? (
                  <LoadingRows />
                ) : (
                  <>
                    {!runs.data.data.length ? (
                      <p>{t('inspection.empty')}</p>
                    ) : (
                      runs.data.data.map((r) => (
                        <div
                          key={r.id}
                          className='flex flex-col gap-2 border-b pb-3'
                        >
                          <span>{t('inspection.runStates.' + r.status)}</span>
                          <RecordedAt value={r.startedAt} />
                          {r.reason ? (
                            <p>
                              {r.reason === 'INSPECTION_DISPATCH_FAILED'
                                ? t('inspection.schedulerFailed')
                                : t('inspection.schedulerOtherFailure')}
                            </p>
                          ) : null}
                          {r.resultSummary ? (
                            <p>
                              {t('inspection.schedulerResult', {
                                plans: r.resultSummary.plans ?? 0,
                                tasks: r.resultSummary.tasks ?? 0,
                                failed: r.resultSummary.failed ?? 0,
                              })}
                            </p>
                          ) : null}
                        </div>
                      ))
                    )}
                    <div className='flex gap-2'>
                      <Button
                        variant='outline'
                        disabled={index === 0 || runs.isFetching}
                        onClick={() => setIndex((v) => v - 1)}
                      >
                        {t('inspection.previous')}
                      </Button>
                      <Button
                        variant='outline'
                        disabled={
                          !runs.data.meta.nextPageToken || runs.isFetching
                        }
                        onClick={() => {
                          setTokens((v) => [
                            ...v.slice(0, index + 1),
                            runs.data.meta.nextPageToken!,
                          ]);
                          setIndex((v) => v + 1);
                        }}
                      >
                        {t('inspection.next')}
                      </Button>
                    </div>
                  </>
                )}
              </Group>
              <Confirm
                open={confirm}
                onOpenChange={setConfirm}
                title={t('inspection.confirmTitle', {
                  action: t(
                    schedule.enabled
                      ? 'inspection.actions.pause'
                      : 'inspection.actions.activate',
                  ),
                  name: t('inspection.scheduling'),
                })}
                label={t(
                  schedule.enabled
                    ? 'inspection.actions.pause'
                    : 'inspection.actions.activate',
                )}
                busy={w.busy}
                destructive={schedule.enabled}
                rich
                onConfirm={() => void toggle()}
              >
                <p>
                  {t(
                    schedule.enabled
                      ? 'inspection.consequences.pauseScheduler'
                      : 'inspection.consequences.activateScheduler',
                  )}
                </p>
                {w.error ? <BillingError error={w.error} /> : null}
              </Confirm>
            </>
          )}
        </>
      )}
    </PageContainer>
  );
}
