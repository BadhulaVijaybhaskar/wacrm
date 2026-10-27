'use client';

import { useEffect, useState } from 'react';
import { Megaphone, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { AdAttributionRow } from '@/lib/ads/ctwa';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * Ads attribution report (CHAT-24) — conversations and conversions per
 * Click-to-WhatsApp ad. Conversion = conversation closed after CTWA.
 */
export default function AdsAttributionPage() {
  const t = useTranslations('Ads');
  const [rows, setRows] = useState<AdAttributionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/ads/attribution');
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json.error || t('loadError'));
        }
        if (!cancelled) setRows(json.report ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : t('loadError'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-muted p-2">
          <Megaphone className="size-5 text-foreground" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t('loading')}
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <p className="font-medium">{t('emptyTitle')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('emptyHint')}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colHeadline')}</TableHead>
                <TableHead>{t('colAdId')}</TableHead>
                <TableHead>{t('colSourceId')}</TableHead>
                <TableHead className="text-right">{t('colConversations')}</TableHead>
                <TableHead className="text-right">{t('colConversions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={`${row.ad_id ?? ''}-${row.source_id ?? ''}-${row.headline ?? ''}`}
                >
                  <TableCell className="font-medium">
                    {row.headline || t('unknownAd')}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {row.ad_id || '—'}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {row.source_id || '—'}
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
      )}
    </div>
  );
}
