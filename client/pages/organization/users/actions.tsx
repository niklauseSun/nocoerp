import { Link, useLocation } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import type { ManagedUser } from '@nocobase/app-plugin-users/client/user-client';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '#components/ui/button';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '#components/ui/dropdown-menu';
import { useUserPermission } from './hooks.js';
export function UserActions({
  user,
  busy,
  onStatus,
}: {
  user: ManagedUser;
  busy: boolean;
  onStatus: (user: ManagedUser) => void;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const edit = useUserPermission('update', user.id);
  const reset = useUserPermission('reset-password', user.id);
  const status = useUserPermission(
    user.disabledAt ? 'enable' : 'disable',
    user.id,
  );
  if (!edit.can && !reset.can && !status.can) return null;
  const label = t('organization.employeeActions', { name: user.name });
  return (
    <DropdownMenu>
      <Tooltip>
        <DropdownMenuTrigger
          render={
            <TooltipTrigger
              render={
                <Button
                  size='icon'
                  variant='ghost'
                  className='size-7 p-1'
                  disabled={busy}
                  id={'staff-menu-' + user.id}
                  aria-label={label}
                />
              }
            />
          }
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align='end' className='w-auto min-w-40'>
        {edit.can ? (
          <DropdownMenuItem
            render={
              <Link
                to={{
                  pathname:
                    '/organization/users/edit/' + encodeURIComponent(user.id),
                  search: location.search,
                }}
              />
            }
          >
            {t('organization.edit')}
          </DropdownMenuItem>
        ) : null}
        {reset.can ? (
          <DropdownMenuItem
            render={
              <Link
                to={{
                  pathname:
                    '/organization/users/resetPassword/' +
                    encodeURIComponent(user.id),
                  search: location.search,
                }}
              />
            }
          >
            {t('organization.resetPassword')}
          </DropdownMenuItem>
        ) : null}
        {status.can ? (
          <>
            {edit.can || reset.can ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              variant={user.disabledAt ? 'default' : 'destructive'}
              onClick={() => onStatus(user)}
            >
              {t(
                user.disabledAt
                  ? 'organization.enable'
                  : 'organization.disable',
              )}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
