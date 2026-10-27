'use client';

/**
 * Settings → Astra Connect
 *
 * Admin-only per-account switch for the WhatsApp → Astra Connect
 * adapter. Uses PATCH /api/whatsapp/config/astra-connect. The global
 * env (CONNECT_ADAPTER_URL + WACRM_ADAPTER_SECRET) must also be set
 * for the adapter to fire — that status is shown as a chip here.
 */

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { RequireRole } from '@/components/auth/require-role';
import { useAuth } from '@/hooks/use-auth';
import { SettingsPanelHead } from './settings-panel-head';
import { SettingsChip, StatusDot } from './settings-chip';

interface AstraConnectState {
  env_configured: boolean;
  enabled: boolean;
  tenant_id: string | null;
  employee_id: string | null;
  phone_number_id: string | null;
  has_whatsapp_config: boolean;
  has_secret?: boolean;
  rotation_active?: boolean;
  previous_expires_at?: string | null;
}

export function AstraConnectSettings() {
  const t = useTranslations('Settings.astraConnect');
  const { canEditSettings } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<AstraConnectState | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [tenantId, setTenantId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [secret, setSecret] = useState('');
  const [clearSecret, setClearSecret] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/config/astra-connect', {
        cache: 'no-store',
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(
          typeof payload.error === 'string' ? payload.error : t('loadFailed'),
        );
        return;
      }
      const data = (await res.json()) as AstraConnectState;
      setState(data);
      setEnabled(data.enabled);
      setTenantId(data.tenant_id ?? '');
      setEmployeeId(data.employee_id ?? '');
      setSecret('');
      setClearSecret(false);
    } catch (err) {
      console.error('[AstraConnectSettings] load error:', err);
      toast.error(t('networkError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!canEditSettings) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        enabled,
        tenant_id: tenantId.trim() || null,
        employee_id: employeeId.trim() || null,
      };
      if (clearSecret) {
        body.secret = null;
      } else if (secret.trim()) {
        body.secret = secret.trim();
      }
      const res = await fetch('/api/whatsapp/config/astra-connect', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          typeof payload.error === 'string' ? payload.error : t('saveFailed'),
        );
        return;
      }
      const next = payload as AstraConnectState;
      setState((prev) =>
        prev
          ? {
              ...prev,
              env_configured: next.env_configured,
              enabled: next.enabled,
              tenant_id: next.tenant_id,
              employee_id: next.employee_id,
              phone_number_id: next.phone_number_id,
              has_secret: next.has_secret,
              rotation_active: next.rotation_active,
              previous_expires_at: next.previous_expires_at,
            }
          : {
              env_configured: next.env_configured,
              enabled: next.enabled,
              tenant_id: next.tenant_id,
              employee_id: next.employee_id,
              phone_number_id: next.phone_number_id,
              has_whatsapp_config: true,
              has_secret: next.has_secret,
              rotation_active: next.rotation_active,
              previous_expires_at: next.previous_expires_at,
            },
      );
      setEnabled(next.enabled);
      setTenantId(next.tenant_id ?? '');
      setEmployeeId(next.employee_id ?? '');
      setSecret('');
      setClearSecret(false);
      toast.success(t('saved'));
    } catch (err) {
      console.error('[AstraConnectSettings] save error:', err);
      toast.error(t('networkError'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t('loading')}
      </div>
    );
  }

  const envOk = state?.env_configured === true;
  const active =
    envOk && state?.enabled === true && Boolean(state?.tenant_id);

  return (
    <div>
      <SettingsPanelHead title={t('title')} description={t('description')} />

      <RequireRole min="admin" fallback={<p className="text-sm text-muted-foreground">{t('adminOnly')}</p>}>
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <SettingsChip variant={envOk ? 'ok' : 'warn'}>
            <StatusDot tone={envOk ? 'ok' : 'muted'} />
            {envOk ? t('statusEnvReady') : t('statusEnvMissing')}
          </SettingsChip>
          <SettingsChip variant={active ? 'ok' : 'muted'}>
            <StatusDot tone={active ? 'ok' : 'muted'} />
            {active ? t('statusActive') : t('statusInactive')}
          </SettingsChip>
        </div>

        {!envOk ? (
          <Alert className="mb-5">
            <AlertTitle>{t('envMissingTitle')}</AlertTitle>
            <AlertDescription>{t('envMissingDesc')}</AlertDescription>
          </Alert>
        ) : null}

        {state && !state.has_whatsapp_config ? (
          <Alert className="mb-5">
            <AlertTitle>{t('whatsappMissingTitle')}</AlertTitle>
            <AlertDescription>{t('whatsappMissingDesc')}</AlertDescription>
          </Alert>
        ) : null}

        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-base">{t('cardTitle')}</CardTitle>
            <CardDescription>{t('cardDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <Label htmlFor="astra-connect-enabled">{t('enabledLabel')}</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('enabledHint')}
                </p>
              </div>
              <Switch
                id="astra-connect-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
                disabled={!canEditSettings || saving}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="astra-connect-tenant">{t('tenantLabel')}</Label>
              <Input
                id="astra-connect-tenant"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                placeholder={t('tenantPlaceholder')}
                disabled={!canEditSettings || saving}
                className="border-border bg-muted"
              />
              <p className="text-xs text-muted-foreground">{t('tenantHint')}</p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="astra-connect-employee">{t('employeeLabel')}</Label>
              <Input
                id="astra-connect-employee"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                placeholder={t('employeePlaceholder')}
                disabled={!canEditSettings || saving}
                className="border-border bg-muted"
              />
              <p className="text-xs text-muted-foreground">{t('employeeHint')}</p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="astra-connect-secret">{t('secretLabel')}</Label>
              <Input
                id="astra-connect-secret"
                type="password"
                autoComplete="new-password"
                value={secret}
                onChange={(e) => {
                  setSecret(e.target.value);
                  if (e.target.value) setClearSecret(false);
                }}
                placeholder={
                  state?.has_secret
                    ? t('secretPlaceholderSet')
                    : t('secretPlaceholder')
                }
                disabled={!canEditSettings || saving || clearSecret}
                className="border-border bg-muted"
              />
              <p className="text-xs text-muted-foreground">{t('secretHint')}</p>
              {state?.has_secret ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={clearSecret}
                    onChange={(e) => {
                      setClearSecret(e.target.checked);
                      if (e.target.checked) setSecret('');
                    }}
                    disabled={!canEditSettings || saving}
                  />
                  {t('secretClear')}
                </label>
              ) : null}
              {state?.rotation_active && state.previous_expires_at ? (
                <p className="text-xs text-muted-foreground">
                  {t('secretRotationActive', {
                    when: new Date(state.previous_expires_at).toLocaleString(),
                  })}
                </p>
              ) : null}
            </div>

            {state?.phone_number_id ? (              <p className="text-xs text-muted-foreground">
                {t('phoneNumberId', { id: state.phone_number_id })}
              </p>
            ) : null}

            <div className="flex justify-end">
              <Button
                type="button"
                onClick={() => void save()}
                disabled={!canEditSettings || saving}
              >
                {saving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t('saving')}
                  </>
                ) : (
                  t('save')
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </RequireRole>
    </div>
  );
}
