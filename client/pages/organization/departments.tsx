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
  const [previousDepartment, setPreviousDepartment] = useState(d?.id);
  // A changed target discards member action drafts before children render, including an A → B → A navigation.
  if (previousDepartment !== d?.id) {
    setPreviousDepartment(d?.id);
    setRemove(null);
  }
  if (r.error && !r.data)
    return <ErrorBox error={r.error} retry={() => void r.refetch()} />;
  if (!r.data) return <LoadingRows />;
  const source = r.data.data.departments,
    departmentSearch = q.get('departmentQ') ?? '';
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
                description={t('organization.memberHint')}
              >
                {can.can ? (
                  <div className='flex justify-end'>
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
                  </div>
                ) : null}
                <ErrorBox error={w.error} />
                {r.data.data.members.some(
                  (x) => x.departmentId === d.id && x.active,
                ) ? (
                  <EmployeeList
                    key={d.id}
                    department={d}
                    members={r.data.data.members.filter(
                      (x) => x.departmentId === d.id && x.active,
                    )}
                    profiles={r.data.data.memberProfiles}
                    names={names}
                    canUpdate={can.can}
                    busy={w.busy}
                    onRemove={setRemove}
                    onChangePrimary={(member) => {
                      if (!can.can || w.busy) return;
                      void w.run(
                        'organization/departments/' + d.id + '/members',
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
                {!r.data.data.members.some(
                  (x) => x.departmentId === d.id && x.active,
                ) ? (
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
        open={!!remove && remove.departmentId === d?.id}
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
          if (d && remove && remove.departmentId === d.id)
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
