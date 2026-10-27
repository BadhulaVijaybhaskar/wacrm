'use client';

/**
 * Production-build screenshot surface for the Connect-themed app shell.
 * Renders the real Sidebar + Header with a mock session. Gated in
 * production unless UI_PREVIEW=1 (see middleware).
 */

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  LayoutDashboard,
  MessageSquare,
  Settings as SettingsIcon,
} from 'lucide-react';

import { PreviewAuthProvider } from '@/hooks/use-auth';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import {
  CATEGORY_LABELS,
  INTEGRATION_CATEGORIES,
  INTEGRATION_CATALOG,
} from '@/lib/integrations/catalog';

type Surface =
  | 'dashboard'
  | 'inbox'
  | 'templates'
  | 'settings'
  | 'integrations';

function resolveSurface(raw: string | null): Surface {
  if (
    raw === 'inbox' ||
    raw === 'templates' ||
    raw === 'settings' ||
    raw === 'integrations'
  ) {
    return raw;
  }
  return 'dashboard';
}

function ShellPreviewInner() {
  const searchParams = useSearchParams();
  const surface = resolveSurface(searchParams.get('surface'));
  const tDash = useTranslations('Dashboard.page');
  const tSettings = useTranslations('Settings');
  const tIntegrations = useTranslations('Settings.integrations');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const title = useMemo(() => {
    switch (surface) {
      case 'inbox':
        return 'Inbox';
      case 'templates':
        return 'Templates';
      case 'settings':
        return 'Settings';
      case 'integrations':
        return 'Integrations';
      default:
        return 'Dashboard';
    }
  }, [surface]);

  return (
    <div className="bg-background flex h-dvh overflow-hidden">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex h-dvh min-w-0 flex-1 flex-col overflow-hidden">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5 sm:py-5 lg:px-6 2xl:px-10">
          {surface === 'dashboard' ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="bg-primary/10 text-primary grid size-10 place-items-center rounded-xl">
                  <LayoutDashboard className="size-5" />
                </div>
                <div>
                  <h2 className="text-foreground text-xl font-semibold tracking-tight">
                    {tDash('title') === 'title' ? title : tDash('title')}
                  </h2>
                  <p className="text-muted-foreground text-sm">
                    Overview of your Astra Chat workspace.
                  </p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {['Open chats', 'New contacts', 'Pipeline', 'Broadcasts'].map(
                  (label) => (
                    <div
                      key={label}
                      className="rounded-2xl border border-[color-mix(in_srgb,var(--s200)_70%,transparent)] bg-[var(--t-surf)] p-4 shadow-[var(--sh-card)]"
                    >
                      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {label}
                      </p>
                      <p className="text-foreground mt-2 text-2xl font-semibold">
                        —
                      </p>
                    </div>
                  ),
                )}
              </div>
            </div>
          ) : null}

          {surface === 'inbox' ? (
            <div className="flex h-[calc(100dvh-8rem)] overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--s200)_70%,transparent)] bg-[var(--t-surf)] shadow-[var(--sh-card)]">
              <aside className="w-72 shrink-0 border-r border-[color-mix(in_srgb,var(--s200)_70%,transparent)] p-3">
                <div className="text-foreground mb-3 flex items-center gap-2 text-sm font-semibold">
                  <MessageSquare className="size-4" />
                  Conversations
                </div>
                {['Priya Sharma', 'Rahul Mehta', 'Ananya Iyer'].map((name, i) => (
                  <div
                    key={name}
                    className={`mb-1 rounded-xl px-3 py-2.5 ${i === 0 ? 'bg-primary/10' : 'hover:bg-muted/60'}`}
                  >
                    <p className="text-foreground text-sm font-medium">{name}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      Thanks — that works for me.
                    </p>
                  </div>
                ))}
              </aside>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="border-b border-[color-mix(in_srgb,var(--s200)_70%,transparent)] px-4 py-3">
                  <p className="text-foreground text-sm font-semibold">
                    Priya Sharma
                  </p>
                  <p className="text-muted-foreground text-xs">+91 98765 43210</p>
                </div>
                <div className="flex-1 space-y-3 p-4">
                  <div className="bg-muted text-foreground max-w-[70%] rounded-2xl px-3 py-2 text-sm">
                    Hi — can we schedule a demo tomorrow?
                  </div>
                  <div className="bg-primary text-primary-foreground ml-auto max-w-[70%] rounded-2xl px-3 py-2 text-sm">
                    Absolutely. Does 11:00 IST work?
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {surface === 'templates' ? (
            <div className="space-y-4">
              <h2 className="text-foreground text-xl font-semibold">
                Message templates
              </h2>
              <div className="overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--s200)_70%,transparent)] bg-[var(--t-surf)] shadow-[var(--sh-card)]">
                <table className="w-full text-left text-sm">
                  <thead className="text-muted-foreground border-b border-[color-mix(in_srgb,var(--s200)_70%,transparent)] text-xs uppercase">
                    <tr>
                      <th className="px-4 py-3 font-medium">Name</th>
                      <th className="px-4 py-3 font-medium">Category</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['welcome_offer', 'MARKETING', 'APPROVED'],
                      ['order_update', 'UTILITY', 'APPROVED'],
                      ['appointment_reminder', 'UTILITY', 'PENDING'],
                    ].map(([name, category, status]) => (
                      <tr
                        key={name}
                        className="border-b border-[color-mix(in_srgb,var(--s200)_50%,transparent)] last:border-0"
                      >
                        <td className="text-foreground px-4 py-3 font-medium">
                          {name}
                        </td>
                        <td className="text-muted-foreground px-4 py-3">
                          {category}
                        </td>
                        <td className="px-4 py-3">
                          <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium">
                            {status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {surface === 'settings' ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="bg-primary/10 text-primary grid size-10 place-items-center rounded-xl">
                  <SettingsIcon className="size-5" />
                </div>
                <div>
                  <h2 className="text-foreground text-xl font-semibold">
                    {tSettings('title') === 'title' ? 'Settings' : tSettings('title')}
                  </h2>
                  <p className="text-muted-foreground text-sm">
                    Workspace preferences, WhatsApp, and team access.
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  'Profile',
                  'Appearance',
                  'WhatsApp',
                  'Astra Connect',
                  'Members',
                  'API keys',
                ].map((label) => (
                  <div
                    key={label}
                    className="rounded-2xl border border-[color-mix(in_srgb,var(--s200)_70%,transparent)] bg-[var(--t-surf)] p-4 shadow-[var(--sh-card)]"
                  >
                    <p className="text-foreground text-sm font-semibold">{label}</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      Configure {label.toLowerCase()} for this workspace.
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {surface === 'integrations' ? (
            <div className="space-y-6">
              <div>
                <h2 className="text-foreground text-xl font-semibold">
                  {tIntegrations('title')}
                </h2>
                <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
                  {tIntegrations('description')}
                </p>
              </div>
              {INTEGRATION_CATEGORIES.map((category) => {
                const items = INTEGRATION_CATALOG.filter(
                  (p) => p.category === category,
                );
                if (!items.length) return null;
                return (
                  <section key={category}>
                    <h3 className="text-muted-foreground mb-3 text-xs font-semibold tracking-wide uppercase">
                      {CATEGORY_LABELS[category]}
                    </h3>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {items.map((p) => (
                        <div
                          key={p.id}
                          className="rounded-2xl border border-[color-mix(in_srgb,var(--s200)_70%,transparent)] bg-[var(--t-surf)] p-4 shadow-[var(--sh-card)]"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-foreground text-sm font-semibold">
                                {p.name}
                              </p>
                              <p className="text-muted-foreground mt-1 text-xs">
                                {p.description}
                              </p>
                            </div>
                            <span className="text-muted-foreground rounded-full border border-[color-mix(in_srgb,var(--s200)_80%,transparent)] px-2 py-0.5 text-[10px]">
                              Not connected
                            </span>
                          </div>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <span className="bg-primary text-primary-foreground rounded-md px-2.5 py-1 text-xs">
                              Connect
                            </span>
                            <span className="text-muted-foreground rounded-md border border-[color-mix(in_srgb,var(--s200)_80%,transparent)] px-2.5 py-1 text-xs">
                              Test connection
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}

export default function ShellPreviewPage() {
  return (
    <PreviewAuthProvider>
      <Suspense fallback={null}>
        <ShellPreviewInner />
      </Suspense>
    </PreviewAuthProvider>
  );
}
