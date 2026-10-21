import { employees, type Employee } from './roster.js';
import { Fragment, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { Search } from './common.js';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from '@nocobase/i18n/client';
import { MoreHorizontal } from 'lucide-react';
import { DataTable } from '#components/data-table';
import { StatusBadge } from '#components/status-badge';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import { Badge } from '#components/ui/badge';
import { Button } from '#components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuGroup,
} from '#components/ui/dropdown-menu';
import type { Member, Department, Snapshot } from './common.js';
export function EmployeeList({
  members,
  department,
  departments,
  profiles,
  names,
  canUpdate,
  busy,
  onRemove,
  onChangePrimary,
}: {
  members: Member[];
  department: Department;
  departments: Department[];
  profiles: Snapshot['memberProfiles'];
  names: Map<string, string>;
  canUpdate: boolean;
  busy: boolean;
  onChangePrimary: (member: Member) => void;
  onRemove: (member: {
    id: string;
    name: string;
    departmentId: string;
    departmentTitle: string;
  }) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useSearchParams();
  const search = query.get('employeeQ') ?? '';
  const departmentNames = useMemo(
    () => new Map(departments.map((d) => [d.id, d.title])),
    [departments],
  );
  const rows = useMemo(() => employees(members), [members]);
  const filtered = useMemo(
    () =>
      rows.filter((member) =>
        (
          (names.get(member.userId) ?? member.userId) +
          ' ' +
          (profiles?.[member.userId]?.email ?? '')
        )
          .toLocaleLowerCase()
          .includes(search.trim().toLocaleLowerCase()),
      ),
    [rows, names, profiles, search],
  );
  const columns = useMemo<ColumnDef<Employee>[]>(
    () => [
      {
        id: 'name',
        header: t('organization.employeeName'),
        cell: ({ row }) => (
          <span className='font-medium'>
            {names.get(row.original.userId) ?? row.original.userId}
          </span>
        ),
      },
      {
        id: 'email',
        header: t('organization.email'),
        cell: ({ row }) => (
          <span className='break-all'>
            {profiles?.[row.original.userId]?.email ??
              t('organization.unavailable')}
          </span>
        ),
      },
      {
        id: 'department',
        header: t('organization.department'),
        cell: ({ row }) => (
          <div className='flex flex-col gap-1'>
            {row.original.memberships.map((m) => (
              <span key={m.id}>
                {departmentNames.get(m.departmentId) ?? m.departmentId}
              </span>
            ))}
          </div>
        ),
      },
      {
        id: 'primary',
        header: t('organization.membershipType'),
        cell: ({ row }) => (
          <div className='flex flex-col items-start gap-1'>
            {row.original.memberships.map((m) => (
              <Badge
                key={m.id}
                variant='secondary'
                className='max-w-full whitespace-normal'
              >
                {row.original.memberships.length > 1
                  ? (departmentNames.get(m.departmentId) ?? m.departmentId) +
                    ' · '
                  : ''}
                {t(
                  m.primary
                    ? 'organization.primary'
                    : 'organization.secondaryDepartment',
                )}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        id: 'status',
        header: t('organization.status'),
        cell: ({ row }) => {
          const p = profiles?.[row.original.userId];
          return (
            <StatusBadge
              tone={!p ? 'neutral' : p.disabledAt ? 'warning' : 'success'}
            >
              {t(
                !p
                  ? 'organization.unavailable'
                  : p.disabledAt
                    ? 'organization.inactive'
                    : 'organization.active',
              )}
            </StatusBadge>
          );
        },
      },
      ...(canUpdate
        ? [
            {
              id: 'actions',
              header: t('organization.actions'),
              cell: ({ row }) => (
                <DropdownMenu>
                  <Tooltip>
                    <DropdownMenuTrigger
                      render={
                        <TooltipTrigger
                          render={
                            <Button
                              variant='ghost'
                              size='icon'
                              className='size-7 p-1'
                              disabled={busy}
                              aria-label={t('organization.employeeActions', {
                                name:
                                  names.get(row.original.userId) ??
                                  row.original.userId,
                              })}
                            />
                          }
                        />
                      }
                    >
                      <MoreHorizontal />
                    </DropdownMenuTrigger>
                    <TooltipContent>
                      {t('organization.employeeActions', {
                        name:
                          names.get(row.original.userId) ?? row.original.userId,
                      })}
                    </TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align='end' className='w-auto min-w-40'>
                    {row.original.memberships.map((member, index) => {
                      const title =
                        departmentNames.get(member.departmentId) ??
                        member.departmentId;
                      const suffix =
                        row.original.memberships.length > 1
                          ? ' · ' + title
                          : '';
                      return (
                        <Fragment key={member.id}>
                          {index ? <DropdownMenuSeparator /> : null}
                          <DropdownMenuGroup>
                            <DropdownMenuLabel>{title}</DropdownMenuLabel>
                            <DropdownMenuItem
                              disabled={busy}
                              onClick={() => onChangePrimary(member)}
                            >
                              {t(
                                member.primary
                                  ? 'organization.unsetPrimaryDepartment'
                                  : 'organization.setPrimaryDepartment',
                              )}
                              {suffix}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant='destructive'
                              disabled={busy}
                              onClick={() =>
                                onRemove({
                                  id: member.userId,
                                  name:
                                    names.get(member.userId) ?? member.userId,
                                  departmentId: member.departmentId,
                                  departmentTitle: title,
                                })
                              }
                            >
                              {t('organization.remove')}
                              {suffix}
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </Fragment>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              ),
            } satisfies ColumnDef<Employee>,
          ]
        : []),
    ],
    [
      t,
      names,
      profiles,
      departmentNames,
      canUpdate,
      busy,
      onRemove,
      onChangePrimary,
    ],
  );
  return (
    <div className='flex min-w-0 flex-col gap-4'>
      <Search
        value={search}
        placeholder={t('organization.searchEmployees')}
        onChange={(value) => {
          const next = new URLSearchParams(query);
          if (value) next.set('employeeQ', value);
          else next.delete('employeeQ');
          setQuery(next, { replace: true });
        }}
      />
      {search ? (
        <Button
          variant='outline'
          className='self-start'
          onClick={() => {
            const next = new URLSearchParams(query);
            next.delete('employeeQ');
            setQuery(next);
          }}
        >
          {t('organization.clear')}
        </Button>
      ) : null}
      <DataTable
        data={filtered}
        columns={columns}
        getRowId={(row) => row.id}
        label={t('organization.departmentMembers', { name: department.title })}
        emptyMessage={t(
          search ? 'organization.noResults' : 'organization.noMembers',
        )}
      />
    </div>
  );
}
