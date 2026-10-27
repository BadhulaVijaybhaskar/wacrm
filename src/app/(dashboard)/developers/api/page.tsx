'use client';

import Link from 'next/link';

import {
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_DESCRIPTIONS,
  samplePayloadForEvent,
} from '@/lib/webhooks/events';

/**
 * In-app public API docs (CHAT-17). Full reference also lives in
 * docs/public-api.md in the repo.
 */
export default function PublicApiDocsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Public API</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Authenticate with Settings → API keys. Outbound webhooks and
          Zapier/Make REST Hooks use HMAC signatures (
          <code className="text-xs">X-Wacrm-Signature</code>).
        </p>
        <p className="mt-2 text-sm">
          <Link href="/settings?tab=api" className="underline">
            Manage API keys &amp; webhooks
          </Link>
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Base URL</h2>
        <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-xs">
          {`Authorization: Bearer <api_key>
GET|POST /api/v1/...`}
        </pre>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">REST Hooks (Zapier / Make)</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            <code className="text-xs">POST /api/v1/hooks/subscribe</code> —{' '}
            <code className="text-xs">{`{ hookUrl, event }`}</code>
          </li>
          <li>
            <code className="text-xs">POST|DELETE /api/v1/hooks/unsubscribe</code>{' '}
            — <code className="text-xs">{`{ id | hookUrl }`}</code>
          </li>
          <li>
            <code className="text-xs">GET /api/v1/hooks/sample?event=message.received</code>
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Event catalog</h2>
        <div className="space-y-3">
          {WEBHOOK_EVENTS.map((ev) => (
            <div
              key={ev}
              className="rounded-xl border border-border bg-card p-4 text-sm"
            >
              <p className="font-mono text-xs font-semibold">{ev}</p>
              <p className="mt-1 text-muted-foreground">
                {WEBHOOK_EVENT_DESCRIPTIONS[ev]}
              </p>
              <pre className="mt-2 overflow-x-auto rounded-md bg-muted/50 p-2 text-[10px] leading-relaxed">
                {JSON.stringify(samplePayloadForEvent(ev), null, 2)}
              </pre>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
