import { departmentScope, scopedMembers, employees } from './roster.js';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '#components/ui/dropdown-menu';
import { useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  MoreHorizontal,
} from 'lucide-react';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import { Button } from '#components/ui/button';
import { Badge } from '#components/ui/badge';
import { OrgEmpty, type Department, type Member } from './common.js';

/** Nested navigation uses native links/buttons, rather than an ARIA tree without its full keyboard contract. */
export function DepartmentTree({
  departments,
  members,
  selected,
  search,
  canUpdate,
}: {
  departments: Department[];
  members: Member[];
  selected?: string;
  search: string;
  canUpdate: boolean;
}) {
  const { t } = useTranslation();
  const [q] = useSearchParams();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const byId = new Map(departments.map((d) => [d.id, d]));
  const visible = new Set<string>();
  const term = search.trim().toLocaleLowerCase();
  for (const d of departments) {
    if (!d.title.toLocaleLowerCase().includes(term)) continue;
    let current: Department | undefined = d;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      visible.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  const rendered = new Set<string>();
  function branch(d: Department) {
    if (!visible.has(d.id) || rendered.has(d.id)) return null;
    rendered.add(d.id);
    const children = departments.filter(
      (x) => x.parentId === d.id && visible.has(x.id) && !rendered.has(x.id),
    );
    const open = !!term || !collapsed.has(d.id);
    const count = employees(
      scopedMembers(members, departmentScope(departments, d.id)),
    ).length;
    const params = new URLSearchParams(q);
    params.set('department', d.id);
    // Render closed children too, so they are not mistaken for orphan roots.
    const nested = children.map(branch);
    return (
      <li key={d.id} className='min-w-0'>
        <div className='flex min-w-0 items-start gap-1'>
          {children.length ? (
            <Tooltip>
              <Button
                render={<TooltipTrigger />}
                aria-controls={'department-children-' + d.id}
                size='icon'
                variant='ghost'
                aria-expanded={open}
                aria-label={t(
                  open
                    ? 'organization.collapseDepartment'
                    : 'organization.expandDepartment',
                  { name: d.title },
                )}
                onClick={() =>
                  setCollapsed((previous) => {
                    const next = new Set(previous);
                    if (next.has(d.id)) next.delete(d.id);
                    else next.add(d.id);
                    return next;
                  })
                }
              >
                {open ? <ChevronDown /> : <ChevronRight />}
              </Button>
              <TooltipContent>
                {t(
                  open
                    ? 'organization.collapseDepartment'
                    : 'organization.expandDepartment',
                  { name: d.title },
                )}
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className='w-9 shrink-0' aria-hidden='true' />
          )}
          <Button
            className='h-auto min-h-9 min-w-0 flex-1 justify-start whitespace-normal text-left'
            variant={selected === d.id ? 'secondary' : 'ghost'}
            nativeButton={false}
            render={
              <Link
                role='link'
                to={{ pathname: location.pathname, search: params.toString() }}
                aria-current={selected === d.id ? 'page' : undefined}
              />
            }
          >
            {open && children.length ? (
              <FolderOpen className='shrink-0' />
            ) : (
              <Folder className='shrink-0' />
            )}
            <span className='min-w-0 break-words'>
              {d.title}
              {!d.active ? ' · ' + t('organization.inactive') : ''}
            </span>
            <Badge
              variant='secondary'
              className='ml-auto shrink-0'
              aria-label={t('organization.memberCount', { count })}
            >
              {count}
            </Badge>
          </Button>
          {canUpdate ? (
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
                          id={'department-menu-' + d.id}
                          aria-label={t('organization.departmentActions', {
                            name: d.title,
                          })}
                        />
                      }
                    />
                  }
                >
                  <MoreHorizontal />
                </DropdownMenuTrigger>
                <TooltipContent>
                  {t('organization.departmentActions', { name: d.title })}
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent align='end' className='w-auto min-w-40'>
                <DropdownMenuItem
                  render={
                    <Link
                      to={{
                        pathname:
                          '/organization/departments/edit/' +
                          encodeURIComponent(d.id),
                        search: location.search,
                      }}
                    />
                  }
                >
                  {t('organization.edit')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        {open && nested.length ? (
          <ul
            id={'department-children-' + d.id}
            className='ml-4 flex flex-col gap-1 border-l pl-2'
          >
            {nested}
          </ul>
        ) : null}
      </li>
    );
  }
  const roots = departments.filter((d) => !d.parentId || !byId.has(d.parentId));
  const nodes = roots.map(branch);
  // Defensive fallback: show disconnected/cyclic legacy data once instead of dropping departments.
  for (const d of departments) if (!rendered.has(d.id)) nodes.push(branch(d));
  return visible.size ? (
    <nav
      aria-label={t('organization.departments')}
      className='min-w-0 overflow-x-auto'
    >
      <ul className='flex min-w-0 flex-col gap-1'>{nodes}</ul>
    </nav>
  ) : (
    <OrgEmpty
      title={t(term ? 'organization.noResults' : 'organization.noDepartments')}
      description={t('organization.inheritHint')}
    />
  );
}
