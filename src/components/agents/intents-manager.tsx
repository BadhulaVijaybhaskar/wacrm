'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface IntentRow {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  enabled: boolean;
  trigger_flow_id: string | null;
  trigger_automation_id: string | null;
  intent_training_phrases?: Array<{ id: string; phrase: string }>;
  intent_entities?: Array<{
    id: string;
    name: string;
    entity_type: string;
    required: boolean;
  }>;
}

/**
 * Dialogflow-style intents manager (CHAT-25). GOLDEN RULE: every control
 * calls a real API (list/create/update/delete/match test).
 */
export function IntentsManager() {
  const [intents, setIntents] = useState<IntentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phrasesText, setPhrasesText] = useState('');
  const [entitiesText, setEntitiesText] = useState('');
  const [testText, setTestText] = useState('');
  const [testResult, setTestResult] = useState<string>('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/intents');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to load');
      setIntents(json.intents ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = async () => {
    if (!name.trim() || !displayName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const phrases = phrasesText
        .split('\n')
        .map((p) => p.trim())
        .filter(Boolean);
      const entities = entitiesText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [n, type] = line.split(':').map((s) => s.trim());
          return { name: n, entity_type: type || 'text' };
        });
      const res = await fetch('/api/intents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          display_name: displayName,
          phrases,
          entities,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Create failed');
      setName('');
      setDisplayName('');
      setPhrasesText('');
      setEntitiesText('');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/intents/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Delete failed');
      }
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (intent: IntentRow) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/intents/${intent.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !intent.enabled }),
      });
      if (!res.ok) throw new Error('Update failed');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const runMatchTest = async () => {
    setTestResult('');
    const res = await fetch('/api/intents/match', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: testText }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setTestResult(json.error || 'Match failed');
      return;
    }
    const hints = json.hints ?? [];
    setTestResult(
      hints.length === 0
        ? 'No match'
        : hints
            .map(
              (h: { name: string; confidence: number; matched_phrase: string }) =>
                `${h.name} (${Math.round(h.confidence * 100)}%) ← “${h.matched_phrase}”`,
            )
            .join('\n'),
    );
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold">Intents</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Training phrases and entities (slots). When Astra Connect is on,
          matches are sent as optional <code>intent_hints</code> on the inbound
          payload. When it is off, local keyword matching can start a linked
          flow or automation.
        </p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-4 rounded-xl border border-border bg-card p-4 md:grid-cols-2">
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">New intent</h3>
          <Input
            placeholder="display name (e.g. Order status)"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <Input
            placeholder="slug (e.g. order_status)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="font-mono text-xs"
          />
          <Textarea
            placeholder="Training phrases (one per line)"
            value={phrasesText}
            onChange={(e) => setPhrasesText(e.target.value)}
            rows={4}
          />
          <Textarea
            placeholder="Entities / slots (name or name:type per line)"
            value={entitiesText}
            onChange={(e) => setEntitiesText(e.target.value)}
            rows={2}
          />
          <Button type="button" disabled={saving} onClick={() => void create()}>
            <Plus className="size-4" />
            Create intent
          </Button>
        </div>
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Test matcher</h3>
          <Textarea
            placeholder="Sample customer message…"
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            rows={3}
          />
          <Button
            type="button"
            variant="outline"
            disabled={!testText.trim()}
            onClick={() => void runMatchTest()}
          >
            Match locally
          </Button>
          <pre className="min-h-20 whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-xs">
            {testResult || 'Results appear here.'}
          </pre>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading…
        </div>
      ) : intents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No intents yet.</p>
      ) : (
        <ul className="space-y-3">
          {intents.map((intent) => (
            <li
              key={intent.id}
              className="rounded-xl border border-border bg-card p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {intent.display_name}{' '}
                    <span className="font-mono text-xs text-muted-foreground">
                      {intent.name}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {(intent.intent_training_phrases?.length ?? 0)} phrases ·{' '}
                    {(intent.intent_entities?.length ?? 0)} entities ·{' '}
                    {intent.enabled ? 'enabled' : 'disabled'}
                  </p>
                  {intent.intent_training_phrases &&
                  intent.intent_training_phrases.length > 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {intent.intent_training_phrases
                        .map((p) => p.phrase)
                        .join(' · ')}
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={saving}
                    onClick={() => void toggle(intent)}
                  >
                    {intent.enabled ? 'Disable' : 'Enable'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => void remove(intent.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
