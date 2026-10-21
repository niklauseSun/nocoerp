import { OrgEmpty } from './common.js';
import { useOrg, useSave, useSetting } from './hooks.js';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { Button } from '#components/ui/button';
import { Label } from '#components/ui/label';
import { Badge } from '#components/ui/badge';
import {
  Group,
  ErrorBox,
  LoadingRows,
  Choice,
  Search,
  Paged,
  Confirm,
  type Snapshot,
  type Options,
  type Assignment,
} from './common.js';
export default function Projects() {
  const { t } = useTranslation(),
    [q, setQ] = useSearchParams(),
    [projectId, setProjectId] = useState(''),
    [type, setType] = useState('org.department'),
    [subjectId, setSubjectId] = useState(''),
    [remove, setRemove] = useState<Assignment | null>(null),
    can = useSetting('hyl.organization', 'update'),
    r = useOrg<{ data: Snapshot }>('organization'),
    page = Number(q.get('optionPage')) || 1,
    search = q.get('optionQ') ?? '',
    o = useOrg<{ data: Options }>('organization/options', {
      page,
      pageSize: 20,
      q: search,
    }),
    w = useSave(),
    data = r.data?.data;
  if (r.error)
    return <ErrorBox error={r.error} retry={() => void r.refetch()} />;
  if (!data) return <LoadingRows />;
  const names = new Map([
      ...Object.entries(data.names ?? {}),
      ...(o.data?.data.users ?? []).map((x) => [x.id, x.name] as const),
      ...data.departments.map((x) => [x.id, x.title] as const),
    ]),
    projects = new Map([
      ...Object.entries(data.names ?? {}),
      ...(o.data?.data.projects.map(
        (x) => [x.id, x.name] as [string, string],
      ) ?? []),
    ]);
  return (
    <Group
      title={t('organization.projects')}
      busy={r.isFetching || o.isFetching}
      description={t('organization.projectHint')}
    >
      <ErrorBox error={w.error} />
      {data.projects
        .filter((x) => x.active)
        .map((x) => (
          <div
            key={x.id}
            className='flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4'
          >
            <div className='min-w-0 break-all text-sm'>
              {projects.get(x.projectId) ?? x.projectId} ·{' '}
              {names.get(x.subjectId) ?? x.subjectId}{' '}
              <Badge variant='secondary'>
                {t(
                  x.subjectType === 'user'
                    ? 'organization.direct'
                    : 'organization.inherited',
                )}
              </Badge>
            </div>
            {can.can ? (
              <Button
                variant='ghost'
                disabled={w.busy}
                onClick={() => setRemove(x)}
              >
                {t('organization.revoke')}
              </Button>
            ) : null}
          </div>
        ))}
      {!data.projects.some((x) => x.active) ? (
        <OrgEmpty
          title={t('organization.noAssignments')}
          description={t('organization.emptyProjectsHelp')}
        />
      ) : null}
      {can.can ? (
        <>
          <Search
            value={search}
            placeholder={t('organization.searchUsers')}
            onChange={(v) => {
              const n = new URLSearchParams(q);
              n.set('optionQ', v);
              n.delete('optionPage');
              setQ(n, { replace: true });
            }}
          />
          {search ? (
            <Button
              variant='outline'
              onClick={() => {
                const n = new URLSearchParams(q);
                n.delete('optionQ');
                n.delete('optionPage');
                setQ(n);
              }}
            >
              {t('organization.clear')}
            </Button>
          ) : null}
          <ErrorBox error={o.error} retry={() => void o.refetch()} />
          <div className='grid gap-4 sm:grid-cols-3'>
            <div className='flex flex-col gap-2'>
              <Label>{t('organization.project')}</Label>
              <Choice
                value={projectId}
                onChange={setProjectId}
                ariaLabel={t('organization.project')}
                disabled={w.busy || o.isFetching}
                options={[
                  { value: '', label: t('organization.chooseProject') },
                  ...(o.data?.data.projects ?? []).map((x) => ({
                    value: x.id,
                    label: x.name,
                  })),
                ]}
              />
            </div>
            <div className='flex flex-col gap-2'>
              <Label>{t('organization.subjectType')}</Label>
              <Choice
                value={type}
                onChange={(v) => {
                  setType(v);
                  setSubjectId('');
                }}
                ariaLabel={t('organization.subjectType')}
                options={['org.department', 'user'].map((value) => ({
                  value,
                  label: t(
                    value === 'user'
                      ? 'organization.user'
                      : 'organization.department',
                  ),
                }))}
                disabled={w.busy}
              />
            </div>
            <div className='flex flex-col gap-2'>
              <Label>{t('organization.subject')}</Label>
              <Choice
                value={subjectId}
                onChange={setSubjectId}
                ariaLabel={t('organization.subject')}
                disabled={w.busy || o.isFetching}
                options={[
                  { value: '', label: t('organization.chooseSubject') },
                  ...(type === 'user'
                    ? (o.data?.data.users ?? [])
                        .filter((x) => !x.disabledAt)
                        .map((x) => ({
                          value: x.id,
                          label: x.name + ' · ' + x.email,
                        }))
                    : data.departments
                        .filter((x) => x.active)
                        .map((x) => ({ value: x.id, label: x.title }))),
                ]}
              />
            </div>
          </div>
          <Paged
            meta={{
              page,
              pageSize: 20,
              total: Math.max(
                o.data?.data.projectTotal ?? 0,
                o.data?.data.userTotal ?? 0,
              ),
            }}
            onChange={(p) => {
              const n = new URLSearchParams(q);
              n.set('optionPage', String(p));
              setQ(n);
            }}
          />
          <div className='flex justify-end'>
            <Button
              disabled={!projectId || !subjectId || w.busy}
              onClick={() => {
                const old = data.projects.find(
                  (x) =>
                    x.projectId === projectId &&
                    x.subjectId === subjectId &&
                    x.subjectType === type,
                );
                void w.run(
                  'organization/projects',
                  'PUT',
                  {
                    projectId,
                    subjectId,
                    subjectType: type,
                    active: true,
                    version: old?.version ?? 0,
                  },
                  projects.get(projectId) ?? projectId,
                );
              }}
            >
              {t(w.busy ? 'organization.saving' : 'organization.grant')}
            </Button>
          </div>
        </>
      ) : null}
      <Confirm
        open={!!remove}
        label={t('organization.revoke')}
        error={w.error}
        title={t('organization.revokeNamed', {
          name: remove ? (names.get(remove.subjectId) ?? remove.subjectId) : '',
        })}
        description={t('organization.revokeHint')}
        busy={w.busy}
        onCancel={() => setRemove(null)}
        onConfirm={() => {
          if (remove)
            void w
              .run(
                'organization/projects',
                'PUT',
                {
                  projectId: remove.projectId,
                  subjectId: remove.subjectId,
                  subjectType: remove.subjectType,
                  active: false,
                  version: remove.version,
                },
                names.get(remove.subjectId) ?? remove.subjectId,
              )
              .then((x) => {
                if (x) setRemove(null);
              });
        }}
      />
    </Group>
  );
}
