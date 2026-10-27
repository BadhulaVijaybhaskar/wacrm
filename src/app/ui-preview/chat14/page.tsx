'use client';

/**
 * CHAT-14 verification surface — mock data only, no Meta / no DB writes.
 * Public under META_STUB for screenshot capture.
 */

import { TemplatePhonePreview } from '@/components/settings/template-phone-preview';

export default function Chat14PreviewPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#e8eef7,_#f7f4ef)] p-6 text-slate-900">
      <h1 className="font-serif text-3xl tracking-tight">CHAT-14 UI preview</h1>
      <p className="mt-1 max-w-xl text-sm text-slate-600">
        Stubbed surfaces for verification screenshots. Default import country IN.
        No live Meta calls.
      </p>

      <section id="template-manager" className="mt-8 grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">
            Template manager preview
          </h2>
          <TemplatePhonePreview
            headerFormat="text"
            headerContent="Welcome {{1}}"
            headerMediaUrl=""
            headerSample="Priya"
            bodyText="Your appointment is confirmed for {{1}}. Reply STOP to opt out."
            bodySamples={['Tue 3pm']}
            footerText="Astra Chat"
            buttons={[
              { type: 'QUICK_REPLY', text: 'Confirm' },
              { type: 'QUICK_REPLY', text: 'Reschedule' },
            ]}
          />
        </div>

        <div className="space-y-6">
          <div id="csv-import">
            <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">
              CSV import validation
            </h2>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-xs">
                <span>Map columns · default country IN</span>
                <span className="text-slate-500">2 rows · 1 error</span>
              </div>
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Row</th>
                    <th className="px-3 py-2">Phone</th>
                    <th className="px-3 py-2">E.164</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t">
                    <td className="px-3 py-2">2</td>
                    <td className="px-3 py-2 font-mono">9876543210</td>
                    <td className="px-3 py-2 font-mono">+919876543210</td>
                    <td className="px-3 py-2 text-emerald-600">OK</td>
                  </tr>
                  <tr className="border-t bg-amber-50/60">
                    <td className="px-3 py-2">3</td>
                    <td className="px-3 py-2 font-mono">bad</td>
                    <td className="px-3 py-2">—</td>
                    <td className="px-3 py-2 text-amber-700">Invalid phone</td>
                  </tr>
                </tbody>
              </table>
              <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
                Summary: 1 imported · 0 duplicates · 1 error ·{' '}
                <span className="underline">Download error CSV</span>
              </div>
            </div>
          </div>

          <div id="consent">
            <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">
              Consent / opt-out
            </h2>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium">Priya Sharma · +919876543210</p>
              <div className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700">
                Opted out of WhatsApp messaging
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Last event: opt_out · keyword STOP · consent_events append-only
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="astra-connect" className="mt-10 max-w-2xl">
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">
          Settings · Astra Connect
        </h2>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold">Astra Connect</h3>
              <p className="mt-1 text-sm text-slate-600">
                Forward inbound WhatsApp messages to your Astra Connect tenant.
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Env configured
            </span>
          </div>
          <div className="mt-4 space-y-3 text-sm">
            <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
              <span>Enable adapter</span>
              <span className="h-5 w-9 rounded-full bg-emerald-500/90" />
            </label>
            <div>
              <p className="text-xs text-slate-500">Tenant ID</p>
              <p className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs">
                tenant_staging_01
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Employee ID</p>
              <p className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs">
                emp_whatsapp_bot
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="embedded-signup" className="mt-10 max-w-2xl">
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">
          Embedded Signup
        </h2>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-semibold">Connect WhatsApp Business</h3>
          <p className="mt-1 text-sm text-slate-600">
            Launch Meta Embedded Signup to link a phone number. META_STUB mode
            simulates approval without calling Graph.
          </p>
          <button
            type="button"
            className="mt-4 rounded-lg bg-[#1877F2] px-4 py-2 text-sm font-medium text-white"
          >
            Continue with Facebook
          </button>
          <p className="mt-3 text-xs text-slate-500">
            Status: pending → approved (stub)
          </p>
        </div>
      </section>

      <section id="inbox" className="mt-10">
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">
          Inbox layout
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <div
            id="inbox-desktop"
            className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
          >
            <div className="flex h-72">
              <aside className="w-2/5 border-r border-slate-100 bg-slate-50 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <p className="font-semibold">Inbox</p>
                  <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px]">
                    Unread 2
                  </span>
                </div>
                <input
                  readOnly
                  className="mt-2 w-full rounded-md border border-slate-200 bg-white px-2 py-1"
                  value="Search messages…"
                />
                <div className="mt-2 space-y-1">
                  <div className="rounded-md bg-white p-2 shadow-sm">
                    <p className="font-medium">Priya · assignee you</p>
                    <p className="text-slate-500">tag: appointment</p>
                  </div>
                  <div className="rounded-md p-2 text-slate-600">
                    Ravi · unread 2
                  </div>
                </div>
              </aside>
              <div className="flex flex-1 flex-col p-3 text-xs">
                <p className="font-semibold">Priya Sharma</p>
                <div className="mt-auto space-y-2">
                  <div className="max-w-[85%] rounded-2xl bg-slate-100 px-3 py-2">
                    Reply STOP to opt out.
                  </div>
                  <div className="ml-auto max-w-[80%] rounded-2xl bg-emerald-600 px-3 py-2 text-white">
                    See you Tue 3pm
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div
            id="inbox-mobile"
            className="mx-auto w-[280px] overflow-hidden rounded-[1.5rem] border border-slate-300 bg-white shadow-md"
          >
            <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold">
              ← Back to list
            </div>
            <div className="space-y-2 p-3 text-xs">
              <p className="font-medium">Priya Sharma</p>
              <div className="rounded-2xl bg-slate-100 px-3 py-2">Hi from Priya</div>
              <div className="ml-auto max-w-[80%] rounded-2xl bg-emerald-600 px-3 py-2 text-white">
                Thanks — see you Tue 3pm
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
