'use client';

export default function IntentsPreviewPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#e8eef7,_#f7f4ef)] p-6 text-slate-900">
      <h1 className="font-serif text-3xl tracking-tight">Intents</h1>
      <p className="mt-1 max-w-2xl text-sm text-slate-600">
        CHAT-25 — Dialogflow-style intents with training phrases and entities.
        Matches become optional <code>intent_hints</code> on the Connect inbound
        payload; local keyword fallback fires linked flows/automations when the
        adapter is off.
      </p>
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
            Example intent
          </h2>
          <p className="mt-2 text-lg font-medium">
            Order status{' '}
            <span className="font-mono text-xs text-slate-500">order_status</span>
          </p>
          <p className="mt-3 text-xs text-slate-500">Training phrases</p>
          <ul className="mt-1 space-y-1 text-sm">
            <li>where is my order</li>
            <li>track order</li>
            <li>order status</li>
          </ul>
          <p className="mt-3 text-xs text-slate-500">Entities / slots</p>
          <ul className="mt-1 space-y-1 text-sm">
            <li>
              <code>order_id</code> · text · required
            </li>
          </ul>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
            Sample intent_hints payload
          </h2>
          <pre className="mt-3 overflow-auto rounded-md bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-700">
{`{
  "intent_hints": [
    {
      "name": "order_status",
      "display_name": "Order status",
      "confidence": 1,
      "matched_phrase": "where is my order"
    }
  ]
}`}
          </pre>
        </section>
      </div>
    </main>
  );
}
