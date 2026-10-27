'use client';

/**
 * Screenshot surface for the Integrations hub — catalog layout only, no DB writes.
 */

import {
  CATEGORY_LABELS,
  INTEGRATION_CATEGORIES,
  INTEGRATION_CATALOG,
} from '@/lib/integrations/catalog';

export default function IntegrationsPreviewPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#e8eef7,_#f7f4ef)] p-6 text-slate-900">
      <h1 className="font-serif text-3xl tracking-tight">Integrations</h1>
      <p className="mt-1 max-w-2xl text-sm text-slate-600">
        Connect commerce, payments, CRM, sheets and automation tools. Credentials
        are encrypted per account.
      </p>
      <div className="mt-8 space-y-8">
        {INTEGRATION_CATEGORIES.map((category) => {
          const items = INTEGRATION_CATALOG.filter((p) => p.category === category);
          if (!items.length) return null;
          return (
            <section key={category}>
              <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">
                {CATEGORY_LABELS[category]}
              </h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-4">
                {items.map((p) => (
                  <div
                    key={p.id}
                    className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="min-w-0 space-y-2">
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <h3 className="min-w-0 truncate font-semibold">{p.name}</h3>
                        <span className="shrink-0 rounded-full border border-slate-200 px-2 py-0.5 text-[10px] whitespace-nowrap text-slate-500">
                          Not connected
                        </span>
                      </div>
                      <p className="text-xs text-pretty break-words whitespace-normal text-slate-600">
                        {p.description}
                      </p>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className="rounded-md bg-slate-900 px-2.5 py-1 text-xs text-white">
                        Connect
                      </span>
                      <span className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-500">
                        Test connection
                      </span>
                      <span className="rounded-md px-2.5 py-1 text-xs text-slate-500">
                        Event log
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
