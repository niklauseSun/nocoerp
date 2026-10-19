import { House, ListTodo, Bell, Menu } from 'lucide-react';
import { NavLink } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useSidebar } from '#components/ui/sidebar';
import { Button } from '#components/ui/button';
export function MobileNavigation() {
  const { t } = useTranslation(),
    { setOpenMobile, openMobile } = useSidebar();
  return (
    <nav
      aria-label={t('mobile.navigation')}
      className='mobile-navigation grid shrink-0 grid-cols-4 border-t border-border bg-background md:hidden'
    >
      {[
        { path: '/workbench', key: 'workbench', icon: House },
        { path: '/messageTodos', key: 'todos', icon: ListTodo },
        { path: '/inbox', key: 'inbox', icon: Bell },
      ].map(({ path, key, icon: Icon }) => (
        <NavLink
          key={key}
          to={path}
          className={({ isActive }) =>
            'flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 px-1 text-xs ' +
            (isActive
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground')
          }
        >
          <Icon className='size-4' />
          <span>{t('mobile.' + key)}</span>
        </NavLink>
      ))}
      <Button
        variant='ghost'
        className='h-auto min-h-14 flex-col gap-1 rounded-none text-xs'
        aria-expanded={openMobile}
        onClick={() => setOpenMobile(!openMobile)}
      >
        <Menu />
        {t('mobile.menu')}
      </Button>
    </nav>
  );
}
