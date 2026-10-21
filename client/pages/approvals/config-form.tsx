import { LocalRecordSearch } from '#components/record-search';
import { useBusinessIdentity } from '../hyl/hooks.js';
import { useQueryClient } from '@tanstack/react-query';
import { useBusinessQuery, useWrite, kinds } from './hooks.js';
import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { RouteChildPage } from '#components/route-child-page';
import { Button } from '#components/ui/button';
import { Checkbox } from '#components/ui/checkbox';
import { Spinner } from '#components/ui/spinner';
import { useCoverFocus } from '../profit-sharing/focus.js';
import { useLeave } from '../inspections/leave.js';
import { configValues } from '../../../server/approvals/schema.js';
import {
  Group,
  FormField,
  BillingError,
  DetailsSkeleton,
  Confirm,
  Choice,
  Search,
  Paged,
} from './common.js';
import type { Config } from './configs.js';
interface Person {
  id: string;
  name: string;
}
export default function ConfigForm() {
  const businessIdentity = useBusinessIdentity();
  useCoverFocus();
  const { t } = useTranslation(),
    p = useParams(),
    l = useLocation(),
    navigate = useNavigate(),
    back = { pathname: '/approvals/configs', search: l.search },
    cache = useQueryClient(),
    can = useCan({
      resource: { type: 'composite', id: 'hyl.approvals' },
      action: 'configure',
    }),
    [projectId, setProjectId] = useState(p.approvalProjectId || ''),
    [kind, setKind] = useState(p.approvalKind || 'contracts'),
    [enabled, setEnabled] = useState(false),
    [levels, setLevels] = useState<
      { uiId: string; name: string; userIds: string[] }[]
    >([{ uiId: 'initial', name: '', userIds: [] }]),
    [names, setNames] = useState<Record<string, string>>({}),
    [q, setQ] = useState(''),
    [page, setPage] = useState(1),
    [dirty, setDirty] = useState(false),
    revisionRef = useRef(0),
    [loaded, setLoaded] = useState(''),
    [key, setKey] = useState(() => crypto.randomUUID()),
    w = useWrite(),
    leave = useLeave(dirty, w.busy),
    projects = useBusinessQuery<{ data: Person[] }>(
      'approvalProjects',
      { action: can.can ? 'configure' : 'read' },
      !can.isPending,
    ),
    r = useBusinessQuery<{ data: Config }>(
      'approvalConfigs/' + projectId + '/' + kind,
      undefined,
      !!projectId,
    ),
    people = useBusinessQuery<{
      data: Person[];
      meta: { page: number; pageSize: number; total: number };
    }>('approvalPeople', { q, page }, !!can.can);
  useEffect(() => {
    if (!r.data || r.error || loaded === r.data.data.id || dirty) return;
    let active = true;
    // Hydrate one authoritative server baseline; refetches never overwrite a dirty draft.
    queueMicrotask(() => {
      if (!active) return;
      const d = r.data.data;
      setLoaded(d.id);
      revisionRef.current = d.revision;
      setEnabled(d.revision ? d.enabled : false);
      setLevels(
        d.levels.length
          ? d.levels.map((x, i) => ({
              uiId: d.id + ':' + i,
              name: x.name,
              userIds: x.userIds,
            }))
          : [{ uiId: 'initial', name: '', userIds: [] }],
      );
      setNames(
        Object.fromEntries(
          d.levels.flatMap((x) =>
            x.users.map((u) => [
              u.id,
              u.name + (u.active ? '' : ' · ' + t('approval.inactive')),
            ]),
          ),
        ),
      );
    });
    return () => {
      active = false;
    };
  }, [r.data, r.error, dirty, loaded, t]);
  const change = () => {
    setDirty(true);
    setKey(crypto.randomUUID());
  };
  const baseline =
    !!projectId && !!r.data && !r.error && loaded === r.data.data.id;
  const locked = !can.can || w.busy || w.uncertain || !baseline || r.isFetching;
  const validate = () => {
    const e: Record<string, string> = {};
    if (!projectId) e.projectId = t('approval.chooseProject');
    const emptyDisabled =
      !enabled && levels.every((x) => !x.name.trim() && !x.userIds.length);
    if (!emptyDisabled)
      levels.forEach((x, i) => {
        if (!x.name.trim() || x.name.trim().length > 60)
          e['level-' + i] = t('approval.nameInvalid');
        if (!x.userIds.length || x.userIds.length > 20)
          e['candidates-' + i] = t('approval.candidatesInvalid');
      });
    return e;
  };
  const errors = w.attempted ? validate() : {};
  const save = () => {
    const v = configValues.safeParse({
      enabled,
      levels:
        !enabled && levels.every((x) => !x.name.trim() && !x.userIds.length)
          ? []
          : levels.map(({ uiId: _id, ...x }) => x),
    });
    if (!w.focus(validate()) || !v.success) return;
    void w.send(
      'approvalConfigs',
      {
        requestId: key,
        expectedRevision: revisionRef.current,
        projectId,
        kind,
        values: v.data,
      },
      (value) => {
        const data = value as Config;
        cache.setQueryData(
          [
            'hyl',
            'approvalConfigs/' + projectId + '/' + kind,
            undefined,
            ...businessIdentity,
          ],
          { data },
        );
        revisionRef.current = data.revision;
        setDirty(false);
        setEnabled(data.enabled);
        setLevels(
          data.levels.map((x, i) => ({
            uiId: data.id + ':' + i,
            name: x.name,
            userIds: x.userIds,
          })),
        );
        leave.allow();
        void navigate(back);
      },
      (projects.data?.data.find((x) => x.id === projectId)?.name ??
        t('approval.project')) +
        ' · ' +
        t('approval.kinds.' + kind),
    );
  };
  return (
    <RouteChildPage>
      <PageContainer>
        <BackButton to={back} />
        <PageHeader
          title={t('approval.configs')}
          description={t('approval.freezeHint')}
        />
        {projects.error ? (
          <BillingError
            error={projects.error}
            retry={() => void projects.refetch()}
          />
        ) : null}
        {r.error ? (
          <BillingError error={r.error} retry={() => void r.refetch()} />
        ) : null}
        {can.isPending ||
        projects.isPending ||
        (!!projectId && !r.error && (!r.data || loaded !== r.data.data.id)) ? (
          <DetailsSkeleton form />
        ) : r.error || projects.error ? null : (
          <>
            <Group title={t('approval.context')}>
              <label className='grid gap-2' htmlFor='cashier-projectId'>
                {t('approval.project')}
                <LocalRecordSearch
                  id='cashier-projectId'
                  value={projectId}
                  label={t('approval.project')}
                  scopeKey='approval-projects'
                  disabled={
                    !can.can ||
                    w.busy ||
                    w.uncertain ||
                    dirty ||
                    !!p.approvalProjectId
                  }
                  onChange={(v) => {
                    setProjectId(v);
                    setLoaded('');
                  }}
                  options={(projects.data?.data ?? []).map((x) => ({
                    value: x.id,
                    label: x.name,
                  }))}
                />
              </label>
              {errors.projectId ? (
                <p role='alert' className='text-sm text-destructive'>
                  {errors.projectId}
                </p>
              ) : null}
              <label className='grid gap-2' htmlFor='approval-kind'>
                {t('approval.kind')}
                <Choice
                  id='approval-kind'
                  value={kind}
                  ariaLabel={t('approval.kind')}
                  disabled={
                    !can.can ||
                    w.busy ||
                    w.uncertain ||
                    dirty ||
                    !!p.approvalKind
                  }
                  onChange={(v) => {
                    setKind(v);
                    setLoaded('');
                  }}
                  options={kinds.map((v) => ({
                    value: v,
                    label: t('approval.kinds.' + v),
                  }))}
                />
              </label>
              <p>
                {t('approval.revision')} {r.data?.data.revision ?? 0}
              </p>
              <label className='flex items-center gap-2'>
                <Checkbox
                  checked={enabled}
                  disabled={locked}
                  onCheckedChange={(v) => {
                    setEnabled(v === true);
                    change();
                  }}
                />
                {t('approval.enabled')}
              </label>
            </Group>
            <Group title={t('approval.levels')}>
              <p className='text-sm text-muted-foreground'>
                {t('approval.levelHint')}
              </p>
              {can.can ? (
                <>
                  <Search
                    value={q}
                    onChange={(v) => {
                      setQ(v);
                      setPage(1);
                    }}
                    placeholder={t('approval.peopleSearch')}
                  />
                  {people.error ? (
                    <BillingError
                      error={people.error}
                      retry={() => void people.refetch()}
                    />
                  ) : people.isPending ? (
                    <DetailsSkeleton form />
                  ) : null}
                  {people.data ? (
                    <Paged meta={people.data.meta} onChange={setPage} />
                  ) : null}
                </>
              ) : null}
              {levels.map((level, i) => (
                <div
                  key={level.uiId}
                  className='grid gap-3 rounded-lg border p-4'
                >
                  <FormField
                    name={'level-' + i}
                    label={t('approval.level') + ' ' + (i + 1)}
                    required
                    value={level.name}
                    error={errors['level-' + i]}
                    disabled={locked}
                    onChange={(v) => {
                      setLevels((old) =>
                        old.map((x, j) => (j === i ? { ...x, name: v } : x)),
                      );
                      change();
                    }}
                  />
                  <div
                    className='grid gap-2 sm:grid-cols-2'
                    id={'cashier-candidates-' + i}
                    tabIndex={-1}
                    role='group'
                    aria-label={t('approval.candidates') + ' ' + (i + 1)}
                    aria-invalid={!!errors['candidates-' + i]}
                  >
                    {[
                      ...new Map(
                        [
                          ...level.userIds.map((id) => ({
                            id,
                            name: names[id] || id,
                          })),
                          ...(people.isPlaceholderData
                            ? []
                            : (people.data?.data ?? [])),
                        ].map((x) => [x.id, x]),
                      ).values(),
                    ].map((person) => (
                      <label
                        key={person.id}
                        className='flex items-center gap-2 break-words'
                      >
                        <Checkbox
                          disabled={locked || people.isFetching}
                          checked={level.userIds.includes(person.id)}
                          onCheckedChange={(v) => {
                            setLevels((old) =>
                              old.map((x, j) =>
                                j === i
                                  ? {
                                      ...x,
                                      userIds:
                                        v === true
                                          ? [...x.userIds, person.id]
                                          : x.userIds.filter(
                                              (id) => id !== person.id,
                                            ),
                                    }
                                  : x,
                              ),
                            );
                            setNames((old) => ({
                              ...old,
                              [person.id]: person.name,
                            }));
                            change();
                          }}
                        />
                        {person.name}
                      </label>
                    ))}
                  </div>
                  {errors['candidates-' + i] ? (
                    <p role='alert' className='text-sm text-destructive'>
                      {errors['candidates-' + i]}
                    </p>
                  ) : null}
                  {can.can ? (
                    <div className='flex flex-wrap gap-2'>
                      {[-1, 1].map((delta) => (
                        <Button
                          key={delta}
                          variant='outline'
                          disabled={
                            locked ||
                            i + delta < 0 ||
                            i + delta >= levels.length
                          }
                          onClick={() => {
                            setLevels((old) => {
                              const next = [...old];
                              [next[i], next[i + delta]] = [
                                next[i + delta],
                                next[i],
                              ];
                              return next;
                            });
                            change();
                          }}
                        >
                          {t(
                            delta < 0 ? 'approval.moveUp' : 'approval.moveDown',
                          )}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                  {can.can ? (
                    <Button
                      variant='outline'
                      className='self-start'
                      disabled={locked || levels.length === 1}
                      onClick={() => {
                        setLevels((old) => old.filter((_, j) => i !== j));
                        change();
                      }}
                    >
                      {t('approval.removeLevel')}
                    </Button>
                  ) : null}
                </div>
              ))}
              {can.can ? (
                <Button
                  className='self-start'
                  variant='outline'
                  disabled={locked || levels.length >= 5}
                  onClick={() => {
                    setLevels((old) => [
                      ...old,
                      { uiId: crypto.randomUUID(), name: '', userIds: [] },
                    ]);
                    change();
                  }}
                >
                  {t('approval.addLevel')}
                </Button>
              ) : (
                <p>{t('approval.configReadOnly')}</p>
              )}
              {w.error ? <BillingError error={w.error} retry={save} /> : null}
              {w.conflict ? (
                <Button
                  variant='outline'
                  onClick={() => {
                    void (async () => {
                      const current = await r.refetch();
                      if (current.data)
                        revisionRef.current = current.data.data.revision;
                      setKey(crypto.randomUUID());
                    })();
                  }}
                >
                  {t('approval.useRevision')}
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
                </Button>{' '}
                {can.can ? (
                  <Button
                    disabled={w.busy || !baseline || r.isFetching}
                    aria-busy={w.busy}
                    onClick={save}
                  >
                    {w.busy ? <Spinner /> : null}
                    {t(w.uncertain ? 'approval.retry' : 'approval.save')}
                  </Button>
                ) : null}
              </div>{' '}
            </Group>
          </>
        )}
        <Confirm
          open={leave.discard}
          onOpenChange={(v) => {
            if (!v) leave.dismiss();
          }}
          title={
            t('approval.discardConfig') +
            ' · ' +
            (projects.data?.data.find((x) => x.id === projectId)?.name ??
              t('approval.project'))
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
