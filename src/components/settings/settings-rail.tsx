'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import {
  RAIL_GROUPS,
  SECTION_META,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from './settings-sections';

// Width at/above which the rail is a vertical column (already in view, so
// no auto-scroll needed). Mirrors the Tailwind `lg:` breakpoint that
// drives the row→column switch in the markup below — keep the two in sync.
const RAIL_DESKTOP_MIN_PX = 1024;

/**
 * The settings left rail — grouped, vertical on desktop. On narrow
 * screens the chip strip was clipping at ~390px, so mobile uses a
 * native `<select>` instead of a horizontal scroller.
 */
export function SettingsRail({
  active,
  onSelect,
  hints,
}: {
  active: SettingsSection;
  onSelect: (section: SettingsSection) => void;
  hints?: Partial<Record<SettingsSection, ReactNode>>;
}) {
  const t = useTranslations('Settings');
  const activeRef = useRef<HTMLButtonElement>(null);

  // When horizontal (legacy / mid widths if select is hidden), keep the
  // active chip in view. On desktop the rail is a static column, so skip.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia(`(min-width: ${RAIL_DESKTOP_MIN_PX}px)`).matches) {
      return;
    }
    activeRef.current?.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: 'smooth',
    });
  }, [active]);

  return (
    <>
      <label className="block lg:hidden">
        <span className="sr-only">{t('sectionsNav')}</span>
        <select
          value={active}
          onChange={(e) => onSelect(e.target.value as SettingsSection)}
          className={cn(
            'border-border bg-background text-foreground h-10 w-full rounded-lg border px-3 text-sm font-medium',
            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
          )}
        >
          {SETTINGS_SECTIONS.map((s) => (
            <option key={s} value={s}>
              {t(`sections.${s}`)}
            </option>
          ))}
        </select>
      </label>

      <nav
        aria-label={t('sectionsNav')}
        className={cn(
          'relative hidden gap-1 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          'border-b border-border',
          // Edge fade so a mid-width horizontal strip still hints at more tabs.
          'mask-[linear-gradient(90deg,transparent,black_12px,black_calc(100%-12px),transparent)]',
          'lg:sticky lg:top-0 lg:flex lg:flex-col lg:overflow-visible lg:border-b-0 lg:pb-0 lg:mask-none',
        )}
      >
        {RAIL_GROUPS.map(({ label, group }) => {
          const items = SETTINGS_SECTIONS.filter(
            (s) => SECTION_META[s].group === group,
          );
          return (
            <div
              key={group}
              className="flex shrink-0 gap-1 lg:flex-col lg:gap-0.5"
            >
              {label ? (
                <div className="hidden px-3 pt-3.5 pb-1.5 text-[11px] font-semibold tracking-[0.09em] text-muted-foreground uppercase lg:block">
                  {t(`groups.${group}`)}
                </div>
              ) : null}
              {items.map((s) => {
                const meta = SECTION_META[s];
                const Icon = meta.icon;
                const isActive = s === active;
                return (
                  <button
                    key={s}
                    ref={isActive ? activeRef : undefined}
                    type="button"
                    onClick={() => onSelect(s)}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium whitespace-nowrap transition-colors',
                      'lg:w-full',
                      isActive
                        ? 'bg-primary-soft text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="flex-1">{t(`sections.${s}`)}</span>
                    {hints?.[s] != null ? (
                      <span
                        className={cn(
                          'hidden items-center gap-1.5 text-xs lg:inline-flex',
                          isActive ? 'text-primary' : 'text-muted-foreground',
                        )}
                      >
                        {hints[s]}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>
    </>
  );
}
