'use client';

/**
 * Settings → Consent / opt-out list (item 5d)
 *
 * Lists contacts with opted_out=true. Agents can opt someone back in
 * (or search-add a contact to the list). STOP keywords still write via
 * the webhook + consent_events ledger.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Ban, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import { SettingsPanelHead } from './settings-panel-head';

interface OptOutContact {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  opted_out: boolean;
  opted_out_at: string | null;
}

export function ConsentSettings() {
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<OptOutContact[]>([]);
  const [phone, setPhone] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/consent/opt-outs', { cache: 'no-store' });
      if (!res.ok) {
        toast.error('Failed to load opt-out list');
        return;
      }
      const body = (await res.json()) as { contacts: OptOutContact[] };
      setContacts(body.contacts ?? []);
    } catch {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setConsent = async (contactId: string, action: 'opt_out' | 'opt_in') => {
    setBusyId(contactId);
    try {
      const res = await fetch('/api/consent/opt-outs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: contactId, action }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(
          typeof payload.error === 'string' ? payload.error : 'Update failed',
        );
        return;
      }
      toast.success(action === 'opt_out' ? 'Marked opted out' : 'Opted back in');
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const addByPhone = async () => {
    const needle = phone.trim();
    if (!needle) return;
    setAdding(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('contacts')
        .select('id, phone, name, opted_out')
        .ilike('phone', `%${needle.replace(/^\+/, '')}%`)
        .limit(5);
      if (error || !data?.length) {
        toast.error('No contact found for that phone');
        return;
      }
      const hit = data[0];
      await setConsent(hit.id, 'opt_out');
      setPhone('');
    } finally {
      setAdding(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading opt-out list…
      </div>
    );
  }

  return (
    <div>
      <SettingsPanelHead
        title="Consent & opt-out"
        description="Contacts who replied STOP (or were marked manually). Broadcasts skip them; the consent ledger keeps every event."
      />

      <Card className="mb-6 border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Add to opt-out list</CardTitle>
          <CardDescription>
            Find a contact by phone and mark them opted out. Inbound STOP still
            works automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-[220px] flex-1 flex-col gap-2">
            <Label htmlFor="optout-phone">Phone</Label>
            <Input
              id="optout-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1555…"
              className="border-border bg-muted"
            />
          </div>
          <Button
            type="button"
            onClick={() => void addByPhone()}
            disabled={adding || !phone.trim()}
          >
            {adding ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />}
            Opt out
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Opted-out contacts</CardTitle>
          <CardDescription>
            {contacts.length === 0
              ? 'None yet.'
              : `${contacts.length} contact${contacts.length === 1 ? '' : 's'}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {contacts.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {c.name || c.phone || 'Unknown'}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {[c.phone, c.email].filter(Boolean).join(' · ')}
                  {c.opted_out_at
                    ? ` · since ${new Date(c.opted_out_at).toLocaleDateString()}`
                    : ''}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busyId === c.id}
                onClick={() => void setConsent(c.id, 'opt_in')}
              >
                {busyId === c.id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="size-3.5" />
                )}
                Opt back in
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
