'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RequireRole } from '@/components/auth/require-role';
import { useAuth } from '@/hooks/use-auth';
import {
  CATEGORY_LABELS,
  INTEGRATION_CATEGORIES,
  type IntegrationProviderMeta,
} from '@/lib/integrations/catalog';
import type { PublicIntegrationConnection } from '@/lib/integrations/store';
import type { IntegrationEventRow } from '@/lib/integrations/event-log';
import { IntegrationCard } from './integration-card';
import { SettingsPanelHead } from './settings-panel-head';

export function IntegrationsHub() {
  const { canEditSettings } = useAuth();
  const t = useTranslations('Settings.integrations');

  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState<IntegrationProviderMeta[]>([]);
  const [connections, setConnections] = useState<
    Record<string, PublicIntegrationConnection>
  >({});
  const [logProvider, setLogProvider] = useState<string | null>(null);
  const [events, setEvents] = useState<IntegrationEventRow[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/account/integrations', {
        cache: 'no-store',
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(
          typeof payload.error === 'string' ? payload.error : t('loadFailed'),
        );
        return;
      }
      const data = (await res.json()) as {
        catalog: IntegrationProviderMeta[];
        connections: PublicIntegrationConnection[];
      };
      setCatalog(data.catalog);
      const map: Record<string, PublicIntegrationConnection> = {};
      for (const c of data.connections) map[c.provider] = c;
      setConnections(map);
    } catch (err) {
      console.error('[IntegrationsHub] load error:', err);
      toast.error(t('networkError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const byCategory = useMemo(() => {
    return INTEGRATION_CATEGORIES.map((category) => ({
      category,
      label: CATEGORY_LABELS[category],
      items: catalog.filter((p) => p.category === category),
    })).filter((g) => g.items.length > 0);
  }, [catalog]);

  const openLog = async (provider: string) => {
    setLogProvider(provider);
    setEventsLoading(true);
    try {
      const res = await fetch(
        `/api/account/integrations/${provider}/events?limit=40`,
        { cache: 'no-store' },
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          typeof payload.error === 'string' ? payload.error : t('logFailed'),
        );
        setEvents([]);
        return;
      }
      setEvents((payload.events ?? []) as IntegrationEventRow[]);
    } catch {
      toast.error(t('networkError'));
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
      />

      <RequireRole min="admin" fallback={null}>
        <p className="text-xs text-muted-foreground">{t('adminHint')}</p>
      </RequireRole>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t('loading')}
        </div>
      ) : (
        byCategory.map((group) => (
          <section key={group.category} className="space-y-3">
            <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
              {group.label}
            </h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {group.items.map((meta) => (
                <IntegrationCard
                  key={meta.id}
                  meta={meta}
                  connection={
                    connections[meta.id] ?? {
                      provider: meta.id,
                      status: 'disconnected',
                      display_name: null,
                      config: {},
                      credential_keys: {},
                      last_tested_at: null,
                      last_error: null,
                      connected_at: null,
                      updated_at: null,
                    }
                  }
                  canEdit={canEditSettings}
                  onChanged={(next) =>
                    setConnections((prev) => ({
                      ...prev,
                      [next.provider]: next,
                    }))
                  }
                  onOpenLog={(p) => void openLog(p)}
                />
              ))}
            </div>
          </section>
        ))
      )}

      <Dialog
        open={logProvider !== null}
        onOpenChange={(open) => {
          if (!open) setLogProvider(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t('eventLogTitle', { provider: logProvider ?? '' })}
            </DialogTitle>
            <DialogDescription>{t('eventLogDesc')}</DialogDescription>
          </DialogHeader>
          {eventsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('loading')}
            </div>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noEvents')}</p>
          ) : (
            <ul className="space-y-2">
              {events.map((ev) => (
                <li
                  key={ev.id}
                  className="rounded-lg border border-border px-3 py-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{ev.event_type}</span>
                    <Badge variant="secondary">{ev.status}</Badge>
                  </div>
                  {ev.message ? (
                    <p className="mt-1 text-muted-foreground">{ev.message}</p>
                  ) : null}
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {new Date(ev.created_at).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => logProvider && void openLog(logProvider)}
          >
            {t('refreshLog')}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
