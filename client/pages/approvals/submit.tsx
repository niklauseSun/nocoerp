import { Snapshot } from './snapshot.js';
import { useBusinessQuery, useWrite } from './hooks.js';
import { useState } from 'react';
import {
  useLocation,
  useNavigate,
  useSearchParams,
  useResolvedPath,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { RouteChildPage } from '#components/route-child-page';
import { Button } from '#components/ui/button';
import { Spinner } from '#components/ui/spinner';
import { useCoverFocus } from '../profit-sharing/focus.js';
import { useLeave } from '../inspections/leave.js';
import {
  Group,
  FormField,
  BillingError,
  DetailsSkeleton,
  Confirm,
} from './common.js';
import type { SourceView } from './panel.js';
export default function Submit() {
  useCoverFocus();
  const { t } = useTranslation(),
    l = useLocation(),
    path = useResolvedPath('.').pathname,
    navigate = useNavigate(),
    [q] = useSearchParams(),
    kind = q.get('approvalKind') || '',
    id = q.get('approvalSourceId') || '',
    back = { pathname: path.slice(0, path.lastIndexOf('/')), search: l.search },
    r = useBusinessQuery<{ data: SourceView }>(
      'approvalSources/' + kind + '/' + id,
    ),
    d = r.error ? undefined : r.data?.data,
    [comment, setComment] = useState(''),
    w = useWrite(),
    leave = useLeave(!!comment, w.busy),
    [key] = useState(() => crypto.randomUUID());
  const save = () => {
    if (
      !d ||
      !w.focus(comment.trim() ? {} : { comment: t('approval.required') })
    )
      return;
    void w.send(
      'approvalRequests',
      {
        requestId: key,
        kind,
        sourceId: id,
        expectedVersion: d.version,
        comment,
      },
      () => {
        leave.allow();
        void navigate(back);
      },
      d.number,
    );
  };
  return (
    <RouteChildPage>
      <PageContainer>
        <BackButton to={back} />
        <PageHeader
          title={t('approval.submit')}
          description={d ? d.number + ' · ' + d.title : undefined}
        />
        {r.error ? (
          <BillingError error={r.error} retry={() => void r.refetch()} />
        ) : r.isPending ? (
          <DetailsSkeleton form />
        ) : d ? (
          <>
            <p className='text-sm text-muted-foreground'>
              {t('approval.sourceVersion')} {d.version}
            </p>
            <Snapshot kind={kind} source={d.snapshot} />
            <Group title={t('approval.levels')}>
              <p className='text-sm text-muted-foreground'>
                {t('approval.effects.' + kind)}
              </p>
              <ol className='flex list-inside list-decimal flex-col gap-2'>
                {d.levels.map((s, i) => (
                  // eslint-disable-next-line @eslint-react/no-array-index-key -- Level position identifies this read-only preview.
                  <li key={i}>
                    {s.name} ·{' '}
                    {t('approval.candidateCount', { count: s.count })}
                  </li>
                ))}
              </ol>
              <p className='text-sm text-muted-foreground'>
                {t('approval.freezeHint')}
              </p>
            </Group>
            <Group title={t('approval.submit')}>
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
                disabled={w.busy || w.uncertain}
              />
              {!d.canSubmit ? <p>{t('approval.cannotSubmit')}</p> : null}
              {w.error ? <BillingError error={w.error} retry={save} /> : null}
              {w.conflict ? (
                <Button variant='outline' onClick={() => void r.refetch()}>
                  {t('approval.reload')}
                </Button>
              ) : null}
              {w.uncertain ? (
                <p role='status'>{t('approval.uncertain')}</p>
              ) : null}
              <div className='flex flex-wrap justify-end gap-2 border-t pt-4'>
                <Button
                  variant='outline'
                  disabled={w.busy}
                  onClick={() =>
                    void Promise.resolve(leave.guard()).then((ok) => {
                      if (ok) {
                        leave.allow();
                        void navigate(back);
                      }
                    })
                  }
                >
                  {t('approval.cancelForm')}
                </Button>
                <Button
                  disabled={!d.canSubmit || w.busy}
                  aria-busy={w.busy}
                  onClick={save}
                >
                  {w.busy ? <Spinner /> : null}
                  {t(w.uncertain ? 'approval.retry' : 'approval.submit')}
                </Button>
              </div>
            </Group>
          </>
        ) : null}
        <Confirm
          open={leave.discard}
          onOpenChange={(v) => {
            if (!v) leave.dismiss();
          }}
          title={
            t('approval.discardSubmit') +
            ' · ' +
            (d?.number ?? t('approval.submit'))
          }
          label={t('approval.discard')}
          busy={false}
          destructive
          onConfirm={() =>
            leave.accept(() => {
              void navigate(back);
            })
          }
        >
          {t('approval.discardHint')}
        </Confirm>
      </PageContainer>
    </RouteChildPage>
  );
}
