import { useMemo } from 'react';
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
} from '#components/ui/dropdown-menu';
import type { Member, Department, Snapshot } from './common.js';
export function EmployeeList({
  members,
  department,
  profiles,
  names,
  canUpdate,
  busy,
  onRemove,
  onChangePrimary,
}: {
  members: Member[];
  department: Department;
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
  const filtered = useMemo(
    () =>
      members.filter((member) =>
        (
          (names.get(member.userId) ?? member.userId) +
          ' ' +
          (profiles?.[member.userId]?.email ?? '')
        )
          .toLocaleLowerCase()
          .includes(search.trim().toLocaleLowerCase()),
      ),
    [members, names, profiles, search],
  );
  const columns = useMemo<ColumnDef<Member>[]>(
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
        cell: () => department.title,
      },
      {
        id: 'primary',
        header: t('organization.membershipType'),
        cell: ({ row }) => (
          <Badge variant='secondary'>
            {t(
              row.original.primary
                ? 'organization.primary'
                : 'organization.secondaryDepartment',
            )}
          </Badge>
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
                    <DropdownMenuItem
                      disabled={busy}
                      onClick={() => onChangePrimary(row.original)}
                    >
                      {t(
                        row.original.primary
                          ? 'organization.unsetPrimaryDepartment'
                          : 'organization.setPrimaryDepartment',
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant='destructive'
                      onClick={() =>
                        onRemove({
                          id: row.original.userId,
                          name:
                            names.get(row.original.userId) ??
                            row.original.userId,
                          departmentId: department.id,
                          departmentTitle: department.title,
                        })
                      }
                    >
                      {t('organization.remove')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ),
            } satisfies ColumnDef<Member>,
          ]
        : []),
    ],
    [
      t,
      names,
      profiles,
      department,
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
