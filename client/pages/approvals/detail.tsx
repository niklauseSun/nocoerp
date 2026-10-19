import { useBusinessIdentity } from '../hyl/hooks.js';
import { useQueryClient } from '@tanstack/react-query';
import { LongText } from '#components/long-text';
import { Snapshot } from './snapshot.js';
import { useBusinessQuery, useWrite, useEvict } from './hooks.js';
import { useState } from 'react';
import {
  useParams,
  useLocation,
  useResolvedPath,
  useSearchParams,
} from 'react-router';
import { Link } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { RouteChildPage } from '#components/route-child-page';
import { Button } from '#components/ui/button';
import { useCoverFocus } from '../profit-sharing/focus.js';
import { useLeave } from '../inspections/leave.js';
import {
  Group,
  FormField,
  BillingError,
  DetailsSkeleton,
  Confirm,
  State,
  RecordedAt,
  Paged,
  Refresh,
  Choice,
  type Approval,
} from './common.js';
export default function Detail() {
  const businessIdentity = useBusinessIdentity();
  useCoverFocus();
  const { t } = useTranslation(),
    { approvalRequestId } = useParams(),
    l = useLocation(),
    path = useResolvedPath('.').pathname,
    [q, setQ] = useSearchParams(),
    local = path.includes('/approvalRequests/'),
    back = {
      pathname: local
        ? path.slice(0, path.lastIndexOf('/approvalRequests/'))
        : '/approvals',
      search: l.search,
    },
    cache = useQueryClient(),
    r = useBusinessQuery<{ data: Approval }>(
      'approvalRequests/' + approvalRequestId,
      {
        eventPage: Number(q.get('eventPage')) || 1,
        eventOrder: q.get('eventOrder') || '-createdAt',
      },
    ),
    d = r.error ? undefined : r.data?.data,
    [comment, setComment] = useState(''),
    [action, setAction] = useState(''),
    [key, setKey] = useState(() => crypto.randomUUID()),
    w = useWrite(),
    leave = useLeave(!!comment, w.busy);
  useEvict(r.error);
  const save = () => {
    if (!d) return;
    void w.send(
      'approvalRequests/' + d.id + '/actions',
      { requestId: key, expectedVersion: d.version, action, comment },
      (value) => {
        const data = value as Approval;
        const query = {
          eventPage: Number(q.get('eventPage')) || 1,
          eventOrder: q.get('eventOrder') || '-createdAt',
        };
        cache.setQueryData(
          [
            'hyl',
            'approvalRequests/' + approvalRequestId,
            query,
            ...businessIdentity,
          ],
          {
            data: {
              ...data,
              events:
                query.eventPage === 1 && query.eventOrder === '-createdAt'
                  ? data.events
                  : d.events,
            },
          },
        );
        setKey(crypto.randomUUID());
        setComment('');
        setAction('');
      },
      d.payload.number,
    );
  };
  const choose = (v: string) => {
    if (w.focus(comment.trim() ? {} : { comment: t('approval.required') })) {
      setKey(crypto.randomUUID());
      setAction(v);
    }
  };
  return (
    <RouteChildPage>
      <PageContainer>
        <BackButton to={back} />
        <PageHeader
          title={
            d
              ? d.payload.number + ' · ' + d.payload.title
              : t('approval.detail')
          }
          actions={
            <>
              {d && !local ? (
                <Button
                  variant='outline'
                  nativeButton={false}
                  render={<Link to={d.sourcePath} />}
                >
                  {t('approval.openSource')}
                </Button>
              ) : null}
              <Refresh busy={r.isFetching} onClick={() => void r.refetch()} />
            </>
          }
        />
        {r.error ? (
          <BillingError error={r.error} retry={() => void r.refetch()} />
        ) : r.isPending ? (
          <DetailsSkeleton />
        ) : d ? (
          <>
            <Group title={t('approval.context')}>
              <dl className='grid gap-4 sm:grid-cols-2'>
                {[
                  ['kind', t('approval.kinds.' + d.kind)],
                  ['applicant', d.applicantName],
                  ['round', String(d.round)],
                  ['sourceVersion', String(d.sourceVersion)],
                  ['revision', String(d.payload.configRevision)],
                  ['comment', d.payload.comment],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    className='grid grid-cols-[8rem_1fr] items-start gap-3'
                  >
                    <dt className='text-sm text-muted-foreground'>
                      {t('approval.' + k)}
                    </dt>
                    <dd className='min-w-0'>
                      <LongText>{v}</LongText>
                    </dd>
                  </div>
                ))}
              </dl>
              <State value={d.status} />
              <p className='text-sm text-muted-foreground'>
                {t('approval.effects.' + d.kind)}
              </p>
            </Group>
            <Snapshot kind={d.kind} source={d.payload.source} />
            <Group title={t('approval.frozenLevels')}>
              <ol className='flex list-inside list-decimal flex-col gap-4'>
                {d.payload.stages.map((s, i) => (
                  // eslint-disable-next-line @eslint-react/no-array-index-key -- Position is immutable within the submitted level snapshot.
                  <li key={i}>
                    <span
                      className={
                        d.status === 'pending' && i === d.level
                          ? 'font-semibold'
                          : ''
                      }
                    >
                      {s.name}
                      {d.status === 'pending' && i === d.level
                        ? ' · ' + t('approval.current')
                        : ''}
                    </span>
                    <p className='mt-1 break-words text-sm text-muted-foreground'>
                      {s.candidates.map((c) => c.name).join(' / ')}
                    </p>
                  </li>
                ))}
              </ol>
              <p className='text-sm text-muted-foreground'>
                {t('approval.freezeHint')}
              </p>
            </Group>
            {d.canDecide || d.canCancel ? (
              <Group title={t('approval.actionsTitle')}>
                <FormField
                  name='comment'
                  required
                  multiline
                  label={t('approval.comment')}
                  value={comment}
                  onChange={setComment}
                  error={
                    w.attempted && !comment.trim()
                      ? t('approval.required')
                      : undefined
                  }
                  disabled={w.busy || w.uncertain || r.isFetching}
                />
                <div className='flex flex-wrap gap-2'>
                  {[
                    ...(d.canDecide ? ['approve', 'reject'] : []),
                    ...(d.canCancel ? ['cancel'] : []),
                  ].map((a) => (
                    <Button
                      key={a}
                      variant={a === 'approve' ? 'default' : 'outline'}
                      disabled={w.busy || w.uncertain || r.isFetching}
                      onClick={() => choose(a)}
                    >
                      {t('approval.actions.' + a)}
                    </Button>
                  ))}
                </div>
                {w.error ? <BillingError error={w.error} retry={save} /> : null}
                {w.uncertain ? (
                  <p role='status'>{t('approval.uncertain')}</p>
                ) : null}
                {w.conflict ? (
                  <Button variant='outline' onClick={() => void r.refetch()}>
                    {t('approval.reload')}
                  </Button>
                ) : null}
              </Group>
            ) : (
              <p className='text-sm text-muted-foreground'>
                {t('approval.readOnly')}
              </p>
            )}
            <Group title={t('approval.history')}>
              <div className='w-full sm:w-60'>
                <Choice
                  value={q.get('eventOrder') || '-createdAt'}
                  ariaLabel={t('approval.createdAt')}
                  onChange={(v) => {
                    const n = new URLSearchParams(q);
                    n.set('eventOrder', v);
                    n.delete('eventPage');
                    setQ(n);
                  }}
                  options={['-createdAt', 'createdAt'].map((v) => ({
                    value: v,
                    label: t(
                      'approval.' + (v.startsWith('-') ? 'newest' : 'oldest'),
                    ),
                  }))}
                />
              </div>
              {d.events.data.map((e) => (
                <article
                  key={e.id}
                  className='flex flex-col gap-2 border-b pb-4 last:border-0'
                >
                  <p className='font-medium'>
                    {t('approval.actions.' + e.action)} · {e.payload.actorName}{' '}
                    · {t('approval.round')} {e.round} · {e.payload.levelName}
                  </p>
                  <LongText>{e.comment}</LongText>
                  <RecordedAt value={e.createdAt} />
                </article>
              ))}
              <Paged
                meta={d.events.meta}
                onChange={(page) => {
                  const n = new URLSearchParams(q);
                  n.set('eventPage', String(page));
                  setQ(n);
                }}
              />
            </Group>
            <Confirm
              open={!!action}
              onOpenChange={(v) => {
                if (!v && !w.uncertain) setAction('');
              }}
              title={
                t('approval.actions.' + (action || 'approve')) +
                ' · ' +
                d.payload.number
              }
              label={t(
                w.uncertain
                  ? 'approval.retry'
                  : 'approval.actions.' + (action || 'approve'),
              )}
              busy={w.busy}
              destructive={action !== 'approve'}
              onConfirm={save}
            >
              {t(
                action === 'approve'
                  ? d.level === d.payload.stages.length - 1
                    ? 'approval.finalConfirm'
                    : 'approval.advanceConfirm'
                  : action === 'reject'
                    ? 'approval.rejectConfirm'
                    : 'approval.cancelConfirm',
              )}{' '}
              {comment}
              {w.error ? <BillingError error={w.error} retry={save} /> : null}
            </Confirm>
          </>
        ) : null}
        <Confirm
          open={leave.discard}
          onOpenChange={(v) => {
            if (!v) leave.dismiss();
          }}
          title={
            t('approval.discardOpinion') +
            ' · ' +
            (d?.payload.number ?? t('approval.detail'))
          }
          label={t('approval.discard')}
          busy={false}
          destructive
          onConfirm={() => leave.accept(() => window.history.back())}
        >
          {t('approval.discardHint')}
        </Confirm>
      </PageContainer>
    </RouteChildPage>
  );
}
