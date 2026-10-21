import { departmentScope, scopedMembers } from './roster.js';
import { Switch } from '#components/ui/switch';
import { Label } from '#components/ui/label';
import { DepartmentTree } from './department-tree.js';
import { EmployeeList } from './employee-list.js';
import { OrgEmpty } from './common.js';
import { useOrg, useSave, useSetting } from './hooks.js';
import { useState } from 'react';
import { Link, Outlet, useSearchParams, useLocation } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { Button } from '#components/ui/button';
import {
  Group,
  ErrorBox,
  LoadingRows,
  Search,
  Confirm,
  type Snapshot,
} from './common.js';
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
    [remove, setRemove] = useState<{
      id: string;
      name: string;
      departmentId: string;
      departmentTitle: string;
    } | null>(null),
    names = new Map(Object.entries(r.data?.data.names ?? {}));
  const directOnly = q.get('directMembers') === 'true';
  const viewKey = `${d?.id}/${directOnly}`;
  const [previousDepartment, setPreviousDepartment] = useState(viewKey);
  // A changed target discards member action drafts before children render, including an A → B → A navigation.
  if (previousDepartment !== viewKey) {
    setPreviousDepartment(viewKey);
    setRemove(null);
  }
  if (r.error && !r.data)
    return <ErrorBox error={r.error} retry={() => void r.refetch()} />;
  if (!r.data) return <LoadingRows />;
  const source = r.data.data.departments,
    departmentSearch = q.get('departmentQ') ?? '',
    members = d
      ? scopedMembers(
          r.data.data.members,
          departmentScope(source, d.id, directOnly),
        )
      : [];
  const removalVisible =
    !!remove &&
    members.some(
      (m) => m.userId === remove.id && m.departmentId === remove.departmentId,
    );
  return (
    <>
      <div className='grid gap-4 lg:grid-cols-3'>
        <Group
          title={t('organization.departments')}
          busy={r.isFetching}
          description={t('organization.inheritHint')}
        >
          <ErrorBox error={r.error} retry={() => void r.refetch()} />
          <div id='department-tree-search'>
            <Search
              value={departmentSearch}
              placeholder={t('organization.searchDepartments')}
              onChange={(v) => {
                const n = new URLSearchParams(q);
                n.set('departmentQ', v);
                setQ(n, { replace: true });
              }}
            />
          </div>
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
          <DepartmentTree
            departments={source}
            members={r.data.data.members}
            selected={d?.id}
            search={departmentSearch}
            canUpdate={can.can}
          />
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
        <div className='flex min-w-0 flex-col gap-4 lg:col-span-2'>
          {d ? (
            <>
              <Group
                title={t('organization.departmentMembers', { name: d.title })}
                description={t('organization.memberScopeHint')}
              >
                <div className='flex flex-wrap items-center justify-between gap-3'>
                  <div className='flex items-center gap-2'>
                    <Switch
                      id='org-direct-members'
                      checked={directOnly}
                      onCheckedChange={(checked) => {
                        const next = new URLSearchParams(q);
                        if (checked) next.set('directMembers', 'true');
                        else next.delete('directMembers');
                        setQ(next, { replace: true });
                      }}
                    />
                    <Label htmlFor='org-direct-members'>
                      {t('organization.directMembersOnly')}
                    </Label>
                  </div>
                  {can.can ? (
                    <Button
                      nativeButton={false}
                      render={
                        <Link
                          to={{
                            pathname: '/organization/departments/members/new',
                            search: new URLSearchParams({
                              ...Object.fromEntries(q),
                              department: d.id,
                            }).toString(),
                          }}
                        />
                      }
                    >
                      {t('organization.addDepartmentMember')}
                    </Button>
                  ) : null}
                </div>
                <ErrorBox error={w.error} />
                {members.length ? (
                  <EmployeeList
                    key={viewKey}
                    department={d}
                    departments={source}
                    members={members}
                    profiles={r.data.data.memberProfiles}
                    names={names}
                    canUpdate={can.can}
                    busy={w.busy}
                    onRemove={setRemove}
                    onChangePrimary={(member) => {
                      if (!can.can || w.busy) return;
                      void w.run(
                        'organization/departments/' +
                          member.departmentId +
                          '/members',
                        'PUT',
                        {
                          userId: member.userId,
                          active: true,
                          primary: !member.primary,
                        },
                        names.get(member.userId) ?? member.userId,
                      );
                    }}
                  />
                ) : null}
                {!members.length ? (
                  <OrgEmpty
                    title={t('organization.noMembers')}
                    description={t('organization.emptyMembersHelp')}
                  />
                ) : null}
              </Group>
            </>
          ) : null}
        </div>
      </div>
      <Confirm
        open={removalVisible}
        error={w.error}
        label={t('organization.remove')}
        title={t('organization.removeMemberNamed', {
          name: remove?.name,
          department: remove?.departmentTitle,
        })}
        description={t('organization.removeHint')}
        busy={w.busy}
        onCancel={() => setRemove(null)}
        onConfirm={() => {
          if (remove && removalVisible)
            void w
              .run(
                'organization/departments/' + remove.departmentId + '/members',
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
