'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RequireRole } from '@/components/auth/require-role';
import { useAuth } from '@/hooks/use-auth';
import {
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_DESCRIPTIONS,
  type WebhookEvent,
} from '@/lib/webhooks/events';
import type { ApiWebhookEndpoint } from '@/lib/webhooks/endpoints';
import { SettingsPanelHead } from './settings-panel-head';

export function WebhooksSettings() {
  const { canEditSettings } = useAuth();
  const t = useTranslations('Settings.webhooks');

  const [rows, setRows] = useState<ApiWebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<WebhookEvent[]>(['message.received']);
  const [creating, setCreating] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/account/webhooks', { cache: 'no-store' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          typeof payload.error === 'string' ? payload.error : t('loadFailed'),
        );
        return;
      }
      setRows((payload.webhooks ?? []) as ApiWebhookEndpoint[]);
    } catch {
      toast.error(t('networkError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleEvent = (ev: WebhookEvent) => {
    setEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev],
    );
  };

  const create = async () => {
    setCreating(true);
    try {
      const res = await fetch('/api/account/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, events }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          typeof payload.error === 'string' ? payload.error : t('createFailed'),
        );
        return;
      }
      const webhook = payload.webhook as ApiWebhookEndpoint & { secret?: string };
      setRevealedSecret(webhook.secret ?? null);
      setCreateOpen(false);
      setUrl('');
      setEvents(['message.received']);
      await load();
      toast.success(t('createSuccess'));
    } catch {
      toast.error(t('networkError'));
    } finally {
      setCreating(false);
    }
  };

  const remove = async (id: string) => {
    try {
      const res = await fetch(`/api/account/webhooks/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(
          typeof payload.error === 'string' ? payload.error : t('deleteFailed'),
        );
        return;
      }
      toast.success(t('deleteSuccess'));
      await load();
    } catch {
      toast.error(t('networkError'));
    }
  };

  const toggleActive = async (row: ApiWebhookEndpoint) => {
    try {
      const res = await fetch(`/api/account/webhooks/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !row.is_active }),
      });
      if (!res.ok) {
        toast.error(t('updateFailed'));
        return;
      }
      await load();
    } catch {
      toast.error(t('networkError'));
    }
  };

  return (
    <div className="mt-10 space-y-4 border-t border-border pt-8">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <p className="text-xs text-muted-foreground">
        {t('docsHint')}{' '}
        <Link href="/developers/api" className="underline">
          {t('docsLink')}
        </Link>
      </p>

      <RequireRole min="admin" fallback={null}>
        <Button
          type="button"
          size="sm"
          onClick={() => setCreateOpen(true)}
          disabled={!canEditSettings}
        >
          <Plus className="size-3.5" />
          {t('addEndpoint')}
        </Button>
      </RequireRole>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t('loading')}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <Card key={row.id}>
              <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="truncate font-mono text-xs">{row.url}</p>
                  <div className="flex flex-wrap gap-1">
                    {row.events.map((ev) => (
                      <Badge key={ev} variant="secondary" className="text-[10px]">
                        {ev}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {row.is_active ? t('active') : t('inactive')} · failures{' '}
                    {row.failure_count}
                    {row.last_delivery_at
                      ? ` · last ${new Date(row.last_delivery_at).toLocaleString()}`
                      : ''}
                  </p>
                </div>
                {canEditSettings ? (
                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void toggleActive(row)}
                    >
                      {row.is_active ? t('disable') : t('enable')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void remove(row.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('addEndpoint')}</DialogTitle>
            <DialogDescription>{t('createDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="webhook-url">HTTPS URL</Label>
              <Input
                id="webhook-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://hooks.example.com/astra"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('events')}</Label>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {WEBHOOK_EVENTS.map((ev) => (
                  <label
                    key={ev}
                    className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={events.includes(ev)}
                      onCheckedChange={() => toggleEvent(ev)}
                    />
                    <span>
                      <span className="font-mono">{ev}</span>
                      <span className="mt-0.5 block text-muted-foreground">
                        {WEBHOOK_EVENT_DESCRIPTIONS[ev]}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={creating || !url.trim() || events.length === 0}
              onClick={() => void create()}
            >
              {creating ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {t('create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={revealedSecret !== null}
        onOpenChange={(open) => {
          if (!open) setRevealedSecret(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('secretTitle')}</DialogTitle>
            <DialogDescription>{t('secretDesc')}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={revealedSecret ?? ''} className="font-mono text-xs" />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={async () => {
                if (!revealedSecret) return;
                await navigator.clipboard.writeText(revealedSecret);
                toast.success(t('copied'));
              }}
            >
              <Copy className="size-3.5" />
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setRevealedSecret(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
