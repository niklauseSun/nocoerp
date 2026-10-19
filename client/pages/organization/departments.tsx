import { ApiClientError } from '@nocobase/app-client';
import { FieldError } from '#components/ui/field';
import { OrgEmpty } from './common.js';
import { useOrg, useSave, useSetting } from './hooks.js';
import { useLeave } from '../inspections/leave.js';
import { useState } from 'react';
import { Link, Outlet, useSearchParams, useLocation } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import { Badge } from '#components/ui/badge';
import { Checkbox } from '#components/ui/checkbox';
import {
  Group,
  ErrorBox,
  LoadingRows,
  Choice,
  Search,
  Paged,
  Confirm,
  type Snapshot,
  type Department,
  type Options,
} from './common.js';
function Editor({
  d,
  tree,
  reload,
}: {
  d: Department;
  tree: Department[];
  reload: () => void;
}) {
  const { t } = useTranslation(),
    can = useSetting('hyl.organization', 'update'),
    [title, setTitle] = useState(d.title),
    [parent, setParent] = useState(d.parentId ?? ''),
    [confirm, setConfirm] = useState(false),
    [attempted, setAttempted] = useState(false),
    [parentError, setParentError] = useState(''),
    [reset, setReset] = useState(false),
    w = useSave(),
    leave = useLeave(
      title !== d.title || parent !== (d.parentId ?? ''),
      w.busy,
    );
  return (
    <Group title={d.title} description={t('organization.departmentHint')}>
      <ErrorBox error={w.error} />
      {w.error instanceof ApiClientError && w.error.reason === 'ORG_STALE' ? (
        <Button variant='outline' onClick={() => setReset(true)}>
          {t('organization.reload')}
        </Button>
      ) : null}
      <form
        noValidate
        className='flex flex-col gap-4'
        onSubmit={(e) => {
          e.preventDefault();
          setAttempted(true);
          setParentError('');
          if (!title.trim()) {
            document.getElementById('org-title')?.focus();
            return;
          }
          void w
            .run(
              'organization/departments/' + d.id,
              'PATCH',
              {
                title,
                parentId: parent || null,
                active: d.active,
                version: d.version,
              },
              title,
              (error) => {
                if (
                  error instanceof ApiClientError &&
                  ['ORG_CYCLE', 'ORG_PARENT_MISSING'].includes(
                    error.reason ?? '',
                  )
                ) {
                  setParentError(t('organization.errors.' + error.reason));
                  requestAnimationFrame(() =>
                    document.getElementById('org-parent')?.focus(),
                  );
                }
              },
            )
            .then((result) => {
              if (result)
                requestAnimationFrame(() =>
                  document.getElementById('org-title')?.focus(),
                );
            });
        }}
      >
        <div className='flex flex-col gap-2'>
          <Label htmlFor='org-title'>{t('organization.name')} *</Label>
          <Input
            id='org-title'
            aria-invalid={attempted && !title.trim()}
            aria-describedby={
              attempted && !title.trim() ? 'org-name-error' : undefined
            }
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            required
            disabled={!can.can || w.busy}
          />
          {attempted && !title.trim() ? (
            <FieldError id='org-name-error'>
              {t('organization.nameRequired')}
            </FieldError>
          ) : null}
        </div>
        <div className='flex flex-col gap-2'>
          <Label htmlFor='org-parent'>{t('organization.parent')}</Label>
          <Choice
            id='org-parent'
            invalid={!!parentError}
            ariaDescribedBy={parentError ? 'org-parent-error' : undefined}
            value={parent}
            onChange={(value) => {
              setParent(value);
              setParentError('');
            }}
            ariaLabel={t('organization.parent')}
            options={[
              { value: '', label: t('organization.noParent') },
              ...tree
                .filter((x) => x.id !== d.id)
                .map((x) => ({ value: x.id, label: x.title })),
            ]}
            disabled={!can.can || w.busy}
          />
          {parentError ? (
            <FieldError id='org-parent-error'>{parentError}</FieldError>
          ) : null}
        </div>
        <Badge variant='secondary'>
          {t(d.active ? 'organization.active' : 'organization.inactive')}
        </Badge>
        {can.can ? (
          <div className='flex flex-wrap justify-end gap-2'>
            <Button
              type='button'
              variant='outline'
              disabled={w.busy}
              onClick={() => setConfirm(true)}
            >
              {t(d.active ? 'organization.disable' : 'organization.enable')}
            </Button>
            <Button type='submit' disabled={w.busy}>
              {t(w.busy ? 'organization.saving' : 'organization.save')}
            </Button>
          </div>
        ) : null}
      </form>
      <Confirm
        open={leave.discard}
        label={t('organization.discardChanges')}
        busy={w.busy}
        title={t('organization.discard')}
        description={t('organization.discardHint')}
        onCancel={leave.dismiss}
        onConfirm={() => leave.accept(() => {})}
      />
      <Confirm
        open={reset}
        label={t('organization.reload')}
        title={t('organization.reload')}
        description={t('organization.reloadHint')}
        busy={w.busy}
        onCancel={() => setReset(false)}
        onConfirm={() => {
          leave.allow();
          setReset(false);
          reload();
        }}
      />
      <Confirm
        open={confirm}
        label={t(d.active ? 'organization.disable' : 'organization.enable')}
        error={w.error}
        title={t(
          d.active ? 'organization.disableNamed' : 'organization.enableNamed',
          { name: d.title },
        )}
        description={t(
          d.active ? 'organization.disableHint' : 'organization.enableHint',
        )}
        onCancel={() => setConfirm(false)}
        busy={w.busy}
        onConfirm={() =>
          void w
            .run(
              'organization/departments/' + d.id,
              'PATCH',
              {
                title: d.title,
                parentId: d.parentId,
                active: !d.active,
                version: d.version,
              },
              d.title,
            )
            .then((r) => {
              if (r) setConfirm(false);
            })
        }
      />
    </Group>
  );
}
export default function Departments() {
  const { t } = useTranslation(),
    [q, setQ] = useSearchParams(),
    l = useLocation(),
    can = useSetting('hyl.organization', 'update'),
    r = useOrg<{ data: Snapshot }>('organization'),
    d =
      r.data?.data.departments.find((x) => x.id === q.get('department')) ??
      r.data?.data.departments[0],
    w = useSave(),
    [userId, setUserId] = useState(''),
    [primary, setPrimary] = useState(false),
    [remove, setRemove] = useState<{ id: string; name: string } | null>(null),
    search = q.get('memberQ') ?? '',
    page = Number(q.get('memberPage')) || 1,
    o = useOrg<{ data: Options }>('organization/options', {
      q: search,
      page,
      pageSize: 20,
    }),
    names = new Map([
      ...Object.entries(r.data?.data.names ?? {}),
      ...(o.data?.data.users.map((x) => [x.id, x.name] as [string, string]) ??
        []),
    ]);
  if (r.error)
    return <ErrorBox error={r.error} retry={() => void r.refetch()} />;
  if (!r.data) return <LoadingRows />;
  const source = r.data.data.departments,
    departmentSearch = q.get('departmentQ') ?? '',
    seen = new Set<string>(),
    ordered: Department[] = [];
  const walk = (parent: string | null) => {
    for (const row of source.filter((x) => x.parentId === parent)) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      ordered.push(row);
      walk(row.id);
    }
  };
  walk(null);
  for (const row of source) if (!seen.has(row.id)) ordered.push(row);
  const tree = ordered.filter((x) =>
    x.title.toLowerCase().includes(departmentSearch.toLowerCase()),
  );
  const depth = (row: Department) => {
    const seen = new Set<string>();
    let parent = row.parentId,
      n = 0;
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      n++;
      parent = source.find((x) => x.id === parent)?.parentId ?? null;
    }
    return n;
  };
  return (
    <>
      <div className='grid gap-4 lg:grid-cols-3'>
        <Group
          title={t('organization.departments')}
          busy={r.isFetching}
          description={t('organization.inheritHint')}
        >
          <Search
            value={departmentSearch}
            placeholder={t('organization.searchDepartments')}
            onChange={(v) => {
              const n = new URLSearchParams(q);
              n.set('departmentQ', v);
              setQ(n, { replace: true });
            }}
          />
          {departmentSearch ? (
            <Button
              variant='outline'
              onClick={() => {
                const n = new URLSearchParams(q);
                n.delete('departmentQ');
                setQ(n);
              }}
            >
              {t('organization.clear')}
            </Button>
          ) : null}
          {tree.length ? (
            tree.map((x) => (
              <Button
                key={x.id}
                className='justify-start whitespace-normal'
                variant={d?.id === x.id ? 'secondary' : 'ghost'}
                nativeButton={false}
                render={
                  <Link
                    to={{
                      pathname: l.pathname,
                      search: new URLSearchParams({
                        ...Object.fromEntries(q),
                        department: x.id,
                      }).toString(),
                    }}
                  />
                }
              >
                {'↳ '.repeat(depth(x))}
                {x.title} {!x.active ? t('organization.inactive') : ''}
              </Button>
            ))
          ) : (
            <OrgEmpty
              title={t(
                departmentSearch
                  ? 'organization.noResults'
                  : 'organization.noDepartments',
              )}
              description={t('organization.inheritHint')}
            />
          )}
          {can.can ? (
            <Button
              variant='outline'
              nativeButton={false}
              render={
                <Link
                  to={{
                    pathname: '/organization/departments/new',
                    search: l.search,
                  }}
                />
              }
            >
              {t('organization.newDepartment')}
            </Button>
          ) : null}
        </Group>
        <div className='flex flex-col gap-4 lg:col-span-2'>
          {d ? (
            <>
              <Editor
                key={d.id + ':' + d.version}
                d={d}
                tree={source}
                reload={() => void r.refetch()}
              />
              <Group
                title={t('organization.members')}
                description={t('organization.memberHint')}
              >
                <ErrorBox error={w.error} />
                {r.data.data.members
                  .filter((x) => x.departmentId === d.id && x.active)
                  .map((m) => (
                    <div
                      key={m.id}
                      className='flex flex-wrap items-center justify-between gap-2'
                    >
                      <span className='break-all text-sm'>
                        {names.get(m.userId) ?? m.userId}{' '}
                        {m.primary ? (
                          <Badge variant='secondary'>
                            {t('organization.primary')}
                          </Badge>
                        ) : null}
                      </span>
                      {can.can ? (
                        <Button
                          variant='ghost'
                          disabled={w.busy}
                          onClick={() =>
                            setRemove({
                              id: m.userId,
                              name: names.get(m.userId) ?? m.userId,
                            })
                          }
                        >
                          {t('organization.remove')}
                        </Button>
                      ) : null}
                    </div>
                  ))}
                {!r.data.data.members.some(
                  (x) => x.departmentId === d.id && x.active,
                ) ? (
                  <OrgEmpty
                    title={t('organization.noMembers')}
                    description={t('organization.emptyMembersHelp')}
                  />
                ) : null}
                {can.can ? (
                  <>
                    <Search
                      value={search}
                      placeholder={t('organization.searchUsers')}
                      onChange={(v) => {
                        const n = new URLSearchParams(q);
                        n.set('memberQ', v);
                        n.delete('memberPage');
                        setQ(n, { replace: true });
                      }}
                    />
                    {search ? (
                      <Button
                        variant='outline'
                        onClick={() => {
                          const n = new URLSearchParams(q);
                          n.delete('memberQ');
                          n.delete('memberPage');
                          setQ(n);
                        }}
                      >
                        {t('organization.clear')}
                      </Button>
                    ) : null}
                    <ErrorBox error={o.error} retry={() => void o.refetch()} />
                    <Choice
                      ariaLabel={t('organization.user')}
                      value={userId}
                      onChange={setUserId}
                      disabled={w.busy || o.isFetching}
                      options={[
                        { value: '', label: t('organization.chooseUser') },
                        ...(o.data?.data.users ?? [])
                          .filter((x) => !x.disabledAt)
                          .map((x) => ({
                            value: x.id,
                            label: x.name + ' · ' + x.email,
                          })),
                      ]}
                    />
                    <Paged
                      meta={{
                        page,
                        pageSize: 20,
                        total: o.data?.data.userTotal ?? 0,
                      }}
                      onChange={(p) => {
                        const n = new URLSearchParams(q);
                        n.set('memberPage', String(p));
                        setQ(n);
                      }}
                    />
                    <Label>
                      <Checkbox
                        checked={primary}
                        onCheckedChange={(v) => setPrimary(v === true)}
                        disabled={w.busy}
                      />
                      {t('organization.primary')}
                    </Label>
                    <div className='flex justify-end'>
                      <Button
                        disabled={!userId || w.busy}
                        onClick={() =>
                          void w.run(
                            'organization/departments/' + d.id + '/members',
                            'PUT',
                            { userId, active: true, primary },
                            names.get(userId) ?? userId,
                          )
                        }
                      >
                        {t(
                          w.busy
                            ? 'organization.saving'
                            : 'organization.addMember',
                        )}
                      </Button>
                    </div>
                  </>
                ) : null}
              </Group>
            </>
          ) : null}
        </div>
      </div>
      <Confirm
        open={!!remove}
        error={w.error}
        label={t('organization.remove')}
        title={t('organization.removeMemberNamed', {
          name: remove?.name,
          department: d?.title,
        })}
        description={t('organization.removeHint')}
        busy={w.busy}
        onCancel={() => setRemove(null)}
        onConfirm={() => {
          if (d && remove)
            void w
              .run(
                'organization/departments/' + d.id + '/members',
                'PUT',
                { userId: remove.id, active: false, primary: false },
                remove.name,
              )
              .then((x) => {
                if (x) setRemove(null);
              });
        }}
      />
      <Outlet />
    </>
  );
}
