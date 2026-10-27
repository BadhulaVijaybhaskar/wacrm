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
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {items.map((p) => (
                  <div
                    key={p.id}
                    className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold">{p.name}</h3>
                        <p className="mt-1 text-xs text-slate-600">{p.description}</p>
                      </div>
                      <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-500">
                        Not connected
                      </span>
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
