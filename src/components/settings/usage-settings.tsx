'use client';

/**
 * Settings → Usage (item 4c)
 *
 * Per-day WhatsApp message counters from `astra_usage_daily`, plus whether
 * BILLING_WEBHOOK_URL is wired (stubbed emitter on the server).
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { RequireRole } from '@/components/auth/require-role';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';
import { SettingsChip, StatusDot } from './settings-chip';

interface UsageRow {
  day: string;
  inbound_messages: number;
  outbound_messages: number;
  template_sends: number;
  conversations: number;
}

interface UsagePayload {
  days: number;
  since: string;
  billing_webhook_configured: boolean;
  totals: UsageRow;
  rows: UsageRow[];
}

export function UsageSettings() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<UsagePayload | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/billing/usage?days=30', { cache: 'no-store' });
      if (!res.ok) {
        toast.error('Failed to load usage');
        return;
      }
      setData((await res.json()) as UsagePayload);
    } catch {
      toast.error('Network error loading usage');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading usage…
      </div>
    );
  }

  const totals = data?.totals;

  return (
    <div>
      <SettingsPanelHead
        title="Usage & billing"
        description="WhatsApp message counts per day for this workspace. Billing webhook events fire when BILLING_WEBHOOK_URL is set."
      />

      <RequireRole
        min="admin"
        fallback={
          <p className="text-sm text-muted-foreground">
            Only admins can view usage.
          </p>
        }
      >
        <div className="mb-5 flex flex-wrap gap-2">
          <SettingsChip
            variant={data?.billing_webhook_configured ? 'ok' : 'muted'}
          >
            <StatusDot
              tone={data?.billing_webhook_configured ? 'ok' : 'muted'}
            />
            {data?.billing_webhook_configured
              ? 'Billing webhook configured'
              : 'Billing webhook not set (stubbed / no-op)'}
          </SettingsChip>
        </div>

        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ['Inbound', totals?.inbound_messages],
              ['Outbound', totals?.outbound_messages],
              ['Templates', totals?.template_sends],
              ['Conversations', totals?.conversations],
            ] as const
          ).map(([label, value]) => (
            <Card key={label} className="border-border bg-card">
              <CardHeader className="pb-2">
                <CardDescription>{label} (30d)</CardDescription>
                <CardTitle className="text-2xl tabular-nums">
                  {value ?? 0}
                </CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>

        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-base">Daily breakdown</CardTitle>
            <CardDescription>
              UTC days since {data?.since ?? '—'}. Empty days are omitted.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!data?.rows?.length ? (
              <p className="text-sm text-muted-foreground">
                No usage recorded yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-4 font-medium">Day</th>
                      <th className="py-2 pr-4 font-medium">In</th>
                      <th className="py-2 pr-4 font-medium">Out</th>
                      <th className="py-2 pr-4 font-medium">Templates</th>
                      <th className="py-2 font-medium">Conversations</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr key={row.day} className="border-t border-border">
                        <td className="py-2 pr-4 font-mono text-xs">{row.day}</td>
                        <td className="py-2 pr-4 tabular-nums">
                          {row.inbound_messages}
                        </td>
                        <td className="py-2 pr-4 tabular-nums">
                          {row.outbound_messages}
                        </td>
                        <td className="py-2 pr-4 tabular-nums">
                          {row.template_sends}
                        </td>
                        <td className="py-2 tabular-nums">
                          {row.conversations}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </RequireRole>
    </div>
  );
}
