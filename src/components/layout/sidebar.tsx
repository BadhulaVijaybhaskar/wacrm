'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Bell,
  Bot,
  Crown,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Scale,
  Settings,
  Shield,
  User,
  UserCog,
  Users,
  UsersRound,
  Workflow,
  X,
  Zap,
} from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/use-auth';
import { useTotalUnread } from '@/hooks/use-total-unread';
import { useUnreadNotifications } from '@/hooks/use-unread-notifications';
import type { AccountRole } from '@/lib/auth/roles';
import { cn } from '@/lib/utils';
import {
  resolveSidebarCollapsed,
  type SidebarPreference,
} from './sidebar-state';
import { BrandLockup, BrandMark } from '@/components/brand/brand-lockup';

const SIDEBAR_STORAGE_KEY = 'astra.v2.sidebar';

const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; labelKey: string; className: string }
> = {
  owner: {
    icon: Crown,
    labelKey: 'roleOwner',
    className: 'border-amber-400/35 bg-amber-400/10 text-amber-200',
  },
  admin: {
    icon: Shield,
    labelKey: 'roleAdmin',
    className: 'border-sky-400/35 bg-sky-400/10 text-sky-200',
  },
  agent: {
    icon: UserCog,
    labelKey: 'roleAgent',
    className: 'border-white/10 bg-white/5 text-white/70',
  },
  viewer: {
    icon: User,
    labelKey: 'roleViewer',
    className: 'border-white/10 bg-white/5 text-white/55',
  },
};

interface NavItem {
  href: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  beta?: boolean;
}

const navItems: NavItem[] = [
  { href: '/dashboard', labelKey: 'dashboard', icon: LayoutDashboard },
  { href: '/inbox', labelKey: 'inbox', icon: MessageSquare },
  { href: '/notifications', labelKey: 'notifications', icon: Bell },
  { href: '/contacts', labelKey: 'contacts', icon: Users },
  { href: '/pipelines', labelKey: 'pipelines', icon: GitBranch },
  { href: '/broadcasts', labelKey: 'broadcasts', icon: Radio },
  { href: '/ads', labelKey: 'ads', icon: Megaphone },
  { href: '/automations', labelKey: 'automations', icon: Zap },
  { href: '/flows', labelKey: 'flows', icon: Workflow, beta: true },
  { href: '/agents', labelKey: 'aiAgents', icon: Bot },
];

const bottomNavItems = [
  { href: '/settings', labelKey: 'settings', icon: Settings },
];

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

function readSidebarPreference(): SidebarPreference {
  try {
    const value = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    return value === 'collapsed' || value === 'expanded' ? value : null;
  } catch {
    return null;
  }
}

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const t = useTranslations('Sidebar');
  const pathname = usePathname();
  const { profile, profileLoading, account, accountRole, signOut } = useAuth();
  const totalUnread = useTotalUnread();
  const unreadNotifications = useUnreadNotifications();
  const [preference, setPreference] = useState<SidebarPreference>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [belowDesktop, setBelowDesktop] = useState(false);

  useEffect(() => {
    setPreference(readSidebarPreference());

    const mobileQuery = window.matchMedia('(max-width: 767px)');
    const desktopQuery = window.matchMedia('(max-width: 1023px)');
    const syncViewport = () => {
      setIsMobile(mobileQuery.matches);
      setBelowDesktop(desktopQuery.matches);
    };

    syncViewport();
    mobileQuery.addEventListener('change', syncViewport);
    desktopQuery.addEventListener('change', syncViewport);
    return () => {
      mobileQuery.removeEventListener('change', syncViewport);
      desktopQuery.removeEventListener('change', syncViewport);
    };
  }, []);

  const collapsed =
    !isMobile &&
    resolveSidebarCollapsed({
      belowDesktop,
      preference,
    });

  const showAccountStrip =
    !profileLoading && !!account?.name && account.name !== profile?.full_name;

  useEffect(() => {
    onClose?.();
    // A navigation always dismisses the mobile drawer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!open || !isMobile) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [isMobile, onClose, open]);

  const toggleCollapsed = () => {
    if (isMobile) {
      onClose?.();
      return;
    }

    const nextPreference: SidebarPreference = collapsed
      ? 'expanded'
      : 'collapsed';
    setPreference(nextPreference);
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, nextPreference);
    } catch {
      // The in-memory choice still applies when storage is unavailable.
    }
  };

  const navClassName = (active: boolean) =>
    cn(
      'av-item flex min-h-10 items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] font-semibold transition-colors',
      collapsed && 'justify-center px-0',
      isMobile && 'min-h-11 text-sm',
      active && 'av-on'
    );

  const renderNavItem = (item: NavItem) => {
    const active =
      pathname === item.href ||
      (item.href !== '/dashboard' && pathname.startsWith(item.href));
    const showUnreadDot = item.href === '/inbox' && totalUnread > 0 && !active;
    const showNotificationBadge =
      item.href === '/notifications' && unreadNotifications > 0;
    const label = t(item.labelKey as string);

    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-label={label}
          title={collapsed ? label : undefined}
          className={navClassName(active)}
        >
          <item.icon className="size-4 shrink-0" strokeWidth={1.8} />
          {!collapsed && (
            <span className="min-w-0 flex-1 truncate">{label}</span>
          )}
          {!collapsed && item.beta && (
            <span
              aria-label={t('beta')}
              className="rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-amber-200 uppercase"
            >
              {t('beta')}
            </span>
          )}
          {showUnreadDot && (
            <span
              aria-label={t('unreadConversations', { count: totalUnread })}
              className={cn(
                'relative flex size-2 shrink-0',
                collapsed && 'absolute translate-x-2.5 -translate-y-2.5'
              )}
            >
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-white" />
            </span>
          )}
          {showNotificationBadge && (
            <span
              aria-label={t('unreadNotifications', {
                count: unreadNotifications,
              })}
              className={cn(
                'flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-[#0a1222]',
                collapsed &&
                  'absolute translate-x-3 -translate-y-2.5 border-2 border-[#0a1222] px-0'
              )}
            >
              {unreadNotifications > 9 ? '9+' : unreadNotifications}
            </span>
          )}
        </Link>
      </li>
    );
  };

  return (
    <>
      <button
        type="button"
        aria-label={t('closeMenu')}
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-30 bg-[#0f1f33]/50 transition-opacity md:hidden',
          open
            ? 'pointer-events-auto opacity-100'
            : 'pointer-events-none opacity-0'
        )}
      />

      <aside
        aria-label={t('primaryNav')}
        aria-hidden={isMobile && !open ? true : undefined}
        data-collapsed={collapsed ? '1' : '0'}
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex h-dvh w-[272px] max-w-[85vw] shrink-0 transition-[width,transform] duration-200 motion-reduce:transition-none',
          open ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
          'md:static md:z-0 md:max-w-none md:translate-x-0 md:shadow-none',
          collapsed ? 'md:w-16' : 'md:w-60'
        )}
      >
        <div className="av-rail flex h-full w-full flex-col overflow-hidden px-2.5 pt-3.5 pb-3">
          <div
            className={cn(
              'flex shrink-0 items-center pb-3',
              collapsed ? 'flex-col gap-2 px-0' : 'justify-between gap-2 px-2'
            )}
          >
            <Link
              href="/dashboard"
              aria-label={t('title')}
              className={cn(
                'flex min-w-0 items-center',
                collapsed ? 'justify-center' : 'gap-2'
              )}
            >
              {collapsed ? (
                <BrandMark size={32} className="size-8" />
              ) : (
                <BrandLockup
                  size={275}
                  width={148}
                  height={28}
                  forceDark
                  className="h-7 max-w-[148px] object-contain object-left"
                />
              )}
            </Link>
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={
                isMobile
                  ? t('closeMenu')
                  : collapsed
                    ? t('expandSidebar')
                    : t('collapseSidebar')
              }
              aria-expanded={!collapsed}
              className="grid size-8 shrink-0 place-items-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white md:hidden lg:grid"
            >
              {isMobile ? (
                <X className="size-5" />
              ) : collapsed ? (
                <PanelLeftOpen className="size-4" />
              ) : (
                <PanelLeftClose className="size-4" />
              )}
            </button>
          </div>

          <nav className="min-h-0 flex-1 overflow-y-auto pr-0.5">
            {!collapsed && <div className="av-sec">{t('primaryNav')}</div>}
            <ul className="flex flex-col gap-0.5">
              {navItems.map(renderNavItem)}
            </ul>

            {collapsed ? (
              <div
                className="mx-3 my-3 border-t border-white/10"
                aria-hidden="true"
              />
            ) : (
              <div className="av-sec">{t('settings')}</div>
            )}
            <ul className="flex flex-col gap-0.5">
              {bottomNavItems.map(renderNavItem)}
            </ul>
          </nav>

          <div className="shrink-0 pt-3">
            {!collapsed && showAccountStrip && account?.name ? (
              <div className="mb-2 flex items-center gap-2 px-2 text-xs text-white/50">
                <UsersRound className="size-3.5 shrink-0" />
                <span className="truncate" title={account.name}>
                  {account.name}
                </span>
                {accountRole
                  ? (() => {
                      const meta = ROLE_CHIP[accountRole];
                      const Icon = meta.icon;
                      return (
                        <span
                          className={cn(
                            'ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium tracking-wider uppercase',
                            meta.className
                          )}
                        >
                          <Icon className="size-3" />
                          {t(meta.labelKey as string)}
                        </span>
                      );
                    })()
                  : null}
              </div>
            ) : null}

            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={profile?.full_name ?? t('defaultUser')}
                className={cn(
                  'av-user flex w-full items-center rounded-2xl border border-white/10 bg-white/5 text-left backdrop-blur-xl transition-colors outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/30',
                  collapsed ? 'justify-center p-1.5' : 'gap-2.5 px-2.5 py-2.5'
                )}
              >
                <Avatar className="size-8 shrink-0">
                  {profile?.avatar_url ? (
                    <AvatarImage
                      src={profile.avatar_url}
                      alt={profile.full_name ?? t('defaultAvatar')}
                    />
                  ) : null}
                  <AvatarFallback className="bg-primary text-primary-foreground text-sm font-bold">
                    {profile?.full_name?.charAt(0)?.toUpperCase() ??
                      profile?.email?.charAt(0)?.toUpperCase() ??
                      'U'}
                  </AvatarFallback>
                </Avatar>
                {!collapsed && (
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">
                      {profile?.full_name ?? t('defaultUser')}
                    </p>
                    <p className="truncate text-[11px] text-white/45">
                      {profile?.email ?? ''}
                    </p>
                  </div>
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                side="top"
                sideOffset={6}
                className="bg-popover text-popover-foreground ring-border min-w-56"
              >
                <DropdownMenuItem
                  render={
                    <Link
                      href="/settings?tab=profile"
                      onClick={onClose}
                      className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                    />
                  }
                >
                  <User className="size-4" />
                  {t('menuProfile')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  render={
                    <Link
                      href="/settings?tab=whatsapp"
                      onClick={onClose}
                      className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                    />
                  }
                >
                  <Settings className="size-4" />
                  {t('menuSettings')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  render={
                    <Link
                      href="/legal"
                      onClick={onClose}
                      className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                    />
                  }
                >
                  <Scale className="size-4" />
                  {t('menuLegal')}
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-border" />
                <DropdownMenuItem
                  onClick={signOut}
                  className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                >
                  <LogOut className="size-4" />
                  {t('menuSignOut')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </aside>
    </>
  );
}
