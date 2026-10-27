'use client';

import { useMemo, useState } from 'react';
import { Loader2, Plug, Unplug } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import type {
  IntegrationProviderMeta,
} from '@/lib/integrations/catalog';
import type { PublicIntegrationConnection } from '@/lib/integrations/store';
import { SettingsChip, StatusDot } from './settings-chip';

function statusTone(
  status: PublicIntegrationConnection['status'],
): 'ok' | 'muted' {
  if (status === 'connected') return 'ok';
  return 'muted';
}

export function IntegrationCard({
  meta,
  connection,
  canEdit,
  onChanged,
  onOpenLog,
}: {
  meta: IntegrationProviderMeta;
  connection: PublicIntegrationConnection;
  canEdit: boolean;
  onChanged: (next: PublicIntegrationConnection) => void;
  onOpenLog: (provider: string) => void;
}) {
  const [connectOpen, setConnectOpen] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<
    'connect' | 'disconnect' | 'test' | 'catalog' | 'sheets' | 'crm' | null
  >(null);

  const statusLabel = useMemo(() => {
    if (connection.status === 'connected') return 'Connected';
    if (connection.status === 'error') return 'Error';
    return 'Not connected';
  }, [connection.status]);

  const openConnect = () => {
    const initial: Record<string, string> = {};
    for (const f of meta.fields) {
      if (!f.secret && typeof connection.config[f.key] === 'string') {
        initial[f.key] = String(connection.config[f.key]);
      } else {
        initial[f.key] = '';
      }
    }
    setFields(initial);
    setConnectOpen(true);
  };

  const connect = async () => {
    setBusy('connect');
    try {
      const res = await fetch(
        `/api/account/integrations/${meta.id}/connect`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields }),
        },
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          typeof payload.error === 'string' ? payload.error : 'Connect failed',
        );
        return;
      }
      onChanged(payload.connection as PublicIntegrationConnection);
      toast.success(`${meta.name} connected`);
      setConnectOpen(false);
    } catch {
      toast.error('Network error');
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy('disconnect');
    try {
      const res = await fetch(
        `/api/account/integrations/${meta.id}/disconnect`,
        { method: 'POST' },
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          typeof payload.error === 'string'
            ? payload.error
            : 'Disconnect failed',
        );
        return;
      }
      onChanged(payload.connection as PublicIntegrationConnection);
      toast.success(`${meta.name} disconnected`);
    } catch {
      toast.error('Network error');
    } finally {
      setBusy(null);
    }
  };

  const sheetsSync = async (direction: 'import' | 'export') => {
    setBusy('sheets');
    try {
      const res = await fetch(
        '/api/account/integrations/google_sheets/sync',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ direction }),
        },
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          typeof payload.error === 'string' ? payload.error : 'Sheets sync failed',
        );
        return;
      }
      toast.success(
        direction === 'import'
          ? `Imported ${payload.rowsOk ?? 0} (errors ${payload.rowsError ?? 0})`
          : `Exported ${payload.rowsOk ?? 0} rows`,
      );
    } catch {
      toast.error('Network error');
    } finally {
      setBusy(null);
    }
  };

  const startSheetsOAuth = async () => {
    setBusy('sheets');
    try {
      const res = await fetch(
        '/api/account/integrations/google_sheets/oauth/start',
        { cache: 'no-store' },
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          typeof payload.error === 'string' ? payload.error : 'OAuth start failed',
        );
        return;
      }
      if (typeof payload.url === 'string') {
        window.location.href = payload.url;
      }
    } catch {
      toast.error('Network error');
    } finally {
      setBusy(null);
    }
  };

  const crmPushSample = async () => {
    setBusy('crm');
    try {
      const res = await fetch(
        `/api/account/integrations/${meta.id}/crm-push`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: '+919876543210',
            name: 'Priya Sharma',
            email: 'priya@example.com',
            summary: 'Stub conversation summary from Integrations hub',
          }),
        },
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          typeof payload.error === 'string' ? payload.error : 'CRM push failed',
        );
        return;
      }
      toast.success(
        `CRM ${payload.status}${payload.externalId ? ` · ${payload.externalId}` : ''}`,
      );
    } catch {
      toast.error('Network error');
    } finally {
      setBusy(null);
    }
  };

  const syncCatalog = async () => {
    setBusy('catalog');
    try {
      const res = await fetch(
        `/api/account/integrations/${meta.id}/catalog-sync`,
        { method: 'POST' },
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          typeof payload.error === 'string'
            ? payload.error
            : 'Catalog sync failed',
        );
        return;
      }
      toast.success(
        payload.stub
          ? `Stub catalog synced (${payload.synced} items)`
          : `Synced ${payload.synced} items`,
      );
    } catch {
      toast.error('Network error');
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      const res = await fetch(
        `/api/account/integrations/${meta.id}/test`,
        { method: 'POST' },
      );
      const payload = await res.json().catch(() => ({}));
      if (payload.connection) {
        onChanged(payload.connection as PublicIntegrationConnection);
      }
      if (!res.ok || !payload.ok) {
        toast.error(
          typeof payload.message === 'string'
            ? payload.message
            : typeof payload.error === 'string'
              ? payload.error
              : 'Test failed',
        );
        return;
      }
      toast.success(
        payload.stub
          ? `Stub OK — ${payload.message}`
          : String(payload.message ?? 'Connection OK'),
      );
    } catch {
      toast.error('Network error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Card className="flex h-full flex-col">
        <CardHeader className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">{meta.name}</CardTitle>
              <CardDescription className="mt-1">
                {meta.description}
              </CardDescription>
            </div>
            <SettingsChip>
              <StatusDot tone={statusTone(connection.status)} />
              {statusLabel}
            </SettingsChip>
          </div>
          {connection.last_error ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {connection.last_error}
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="flex-1 space-y-2 text-xs text-muted-foreground">
          {connection.last_tested_at ? (
            <p>
              Last tested{' '}
              {new Date(connection.last_tested_at).toLocaleString()}
            </p>
          ) : (
            <p>Not tested yet</p>
          )}
          {Object.keys(connection.credential_keys).length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {Object.entries(connection.credential_keys)
                .filter(([, v]) => v)
                .map(([k]) => (
                  <Badge key={k} variant="secondary" className="font-mono text-[10px]">
                    {k}
                  </Badge>
                ))}
            </div>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          {canEdit ? (
            connection.status === 'connected' ||
            connection.status === 'error' ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => void disconnect()}
              >
                {busy === 'disconnect' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Unplug className="size-3.5" />
                )}
                Disconnect
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={busy !== null}
                onClick={openConnect}
              >
                <Plug className="size-3.5" />
                Connect
              </Button>
            )
          ) : null}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!canEdit || busy !== null || connection.status === 'disconnected'}
            onClick={() => void test()}
          >
            {busy === 'test' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : null}
            Test connection
          </Button>
          {(meta.id === 'shopify' || meta.id === 'woocommerce') &&
          canEdit &&
          connection.status === 'connected' ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              onClick={() => void syncCatalog()}
            >
              {busy === 'catalog' ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              Sync catalog
            </Button>
          ) : null}
          {(meta.id === 'hubspot' ||
            meta.id === 'zoho' ||
            meta.id === 'astra_crm') &&
          canEdit &&
          connection.status === 'connected' ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              onClick={() => void crmPushSample()}
            >
              {busy === 'crm' ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              Push sample
            </Button>
          ) : null}
          {meta.id === 'google_sheets' &&
          canEdit &&
          connection.status === 'connected' ? (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy !== null}
                onClick={() => void startSheetsOAuth()}
              >
                OAuth
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy !== null}
                onClick={() => void sheetsSync('import')}
              >
                {busy === 'sheets' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : null}
                Import
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy !== null}
                onClick={() => void sheetsSync('export')}
              >
                Export
              </Button>
            </>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenLog(meta.id)}
          >
            Event log
          </Button>
          {canEdit && connection.status !== 'disconnected' ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={openConnect}
            >
              Update
            </Button>
          ) : null}
        </CardFooter>
      </Card>

      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Connect {meta.name}</DialogTitle>
            <DialogDescription>
              Credentials are encrypted at rest with ENCRYPTION_KEY. Secrets
              are never shown again after save.
              {meta.docsHint ? ` ${meta.docsHint}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {meta.fields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={`${meta.id}-${field.key}`}>
                  {field.label}
                  {field.required ? ' *' : ''}
                </Label>
                <Input
                  id={`${meta.id}-${field.key}`}
                  type={field.secret ? 'password' : 'text'}
                  autoComplete="off"
                  placeholder={field.placeholder}
                  value={fields[field.key] ?? ''}
                  onChange={(e) =>
                    setFields((prev) => ({
                      ...prev,
                      [field.key]: e.target.value,
                    }))
                  }
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConnectOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={busy === 'connect'}
              onClick={() => void connect()}
            >
              {busy === 'connect' ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              Save & connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
