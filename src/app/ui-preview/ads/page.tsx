'use client';

import type { AdAttributionRow } from '@/lib/ads/ctwa';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const DEMO: AdAttributionRow[] = [
  {
    source_id: '120212345678901234',
    ad_id: '23851234567890123',
    headline: 'Summer sale — chat now',
    conversations: 48,
    conversions: 12,
  },
  {
    source_id: '120298765432109876',
    ad_id: '23859876543210987',
    headline: 'Free shipping this week',
    conversations: 21,
    conversions: 4,
  },
  {
    source_id: '120211112223334445',
    ad_id: '23851111222333444',
    headline: 'Book a demo',
    conversations: 9,
    conversions: 0,
  },
];

export default function AdsPreviewPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#e8eef7,_#f7f4ef)] p-6 text-slate-900">
      <h1 className="font-serif text-3xl tracking-tight">Ads attribution</h1>
      <p className="mt-1 max-w-2xl text-sm text-slate-600">
        CHAT-24 — Click-to-WhatsApp referral capture (source_id, ctwa_clid,
        headline, ad id) with conversations and conversions per ad.
      </p>
      <div className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ad</TableHead>
              <TableHead>Ad ID</TableHead>
              <TableHead>Source ID</TableHead>
              <TableHead className="text-right">Conversations</TableHead>
              <TableHead className="text-right">Conversions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {DEMO.map((row) => (
              <TableRow key={row.ad_id ?? row.source_id ?? row.headline ?? ''}>
                <TableCell className="font-medium">{row.headline}</TableCell>
                <TableCell className="font-mono text-xs text-slate-500">
                  {row.ad_id}
                </TableCell>
                <TableCell className="font-mono text-xs text-slate-500">
                  {row.source_id}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.conversations}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.conversions}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </main>
  );
}
