'use client';

import { useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { DEFAULT_IMPORT_COUNTRY, e164Digits } from '@/lib/contacts/e164';
import {
  applyColumnMapping,
  autoDetectColumnMapping,
  mappingHasPhone,
  type ColumnMapping,
  type ContactImportField,
  CONTACT_IMPORT_FIELDS,
} from '@/lib/contacts/column-map';
import {
  parseContactCsvRaw,
  type ParsedContactRow,
} from '@/lib/contacts/parse-contact-csv';
import {
  assignImportedContactTags,
  resolveImportTagIds,
  type ContactTagAssignment,
} from '@/lib/contacts/resolve-import-tags';
import {
  buildImportErrorCsv,
  describeImportErrors,
  validateImportRows,
  type ValidatedImportRow,
} from '@/lib/contacts/validate-import';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Tag,
  Download,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CountryCode } from 'libphonenumber-js';

const DEFAULT_TAG_COLOR = '#3b82f6';
const PREVIEW_LIMIT = 8;

const DEFAULT_COUNTRY_OPTIONS: { value: CountryCode; label: string }[] = [
  { value: 'IN', label: 'India (+91)' },
  { value: 'US', label: 'United States (+1)' },
  { value: 'GB', label: 'United Kingdom (+44)' },
  { value: 'AE', label: 'United Arab Emirates (+971)' },
  { value: 'SG', label: 'Singapore (+65)' },
  { value: 'AU', label: 'Australia (+61)' },
];

function truncateFilename(name: string, max = 48): string {
  if (name.length <= max) return name;
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  const base = name.slice(0, name.length - ext.length);
  const keep = max - ext.length - 1;
  return `${base.slice(0, Math.max(keep, 12))}…${ext}`;
}

function PreviewCell({
  value,
  mono,
  maxWidth = 'max-w-[9rem]',
}: {
  value: string;
  mono?: boolean;
  maxWidth?: string;
}) {
  return (
    <span
      className={cn(
        'block truncate',
        maxWidth,
        mono && 'font-mono text-[11px]'
      )}
      title={value}
    >
      {value}
    </span>
  );
}

function ImportPreviewTags({
  tagNames,
  tagColorByKey,
}: {
  tagNames: string[];
  tagColorByKey: Map<string, string>;
}) {
  const t = useTranslations('Contacts.importModal');

  if (tagNames.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="flex min-w-[4.5rem] flex-wrap gap-1">
      {tagNames.map((name) => {
        const color =
          tagColorByKey.get(name.trim().toLowerCase()) ?? DEFAULT_TAG_COLOR;
        const isKnown = tagColorByKey.has(name.trim().toLowerCase());
        return (
          <span
            key={name}
            className="inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[10px] leading-none font-medium"
            style={{
              backgroundColor: `${color}18`,
              color,
              border: `1px solid ${color}${isKnown ? '55' : '30'}`,
            }}
            title={isKnown ? name : t('willBeCreated', { name })}
          >
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="truncate">{name}</span>
          </span>
        );
      })}
    </div>
  );
}

function downloadTextFile(filename: string, contents: string) {
  const blob = new Blob([contents], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface ImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export function ImportModal({
  open,
  onOpenChange,
  onImported,
}: ImportModalProps) {
  const t = useTranslations('Contacts.importModal');
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [defaultCountry, setDefaultCountry] = useState<CountryCode>(
    DEFAULT_IMPORT_COUNTRY
  );
  const [existingNormalized, setExistingNormalized] = useState<Set<string>>(
    new Set()
  );
  const [tagColorByKey, setTagColorByKey] = useState<Map<string, string>>(
    new Map()
  );
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
    invalidPhone: number;
    failed: number;
    failedDetails: {
      rowNumber?: number;
      phone: string;
      name?: string;
      email?: string;
      company?: string;
      reason: string;
    }[];
    tagsAssigned: number;
    errorCsv: string;
  } | null>(null);

  const mappedRows: ParsedContactRow[] = useMemo(() => {
    if (!mappingHasPhone(mapping) || dataRows.length === 0) return [];
    return applyColumnMapping(headers, dataRows, mapping);
  }, [headers, dataRows, mapping]);

  const validation = useMemo(
    () =>
      validateImportRows(mappedRows, {
        defaultCountry,
        existingNormalized,
      }),
    [mappedRows, defaultCountry, existingNormalized]
  );

  const hasTagsColumn = Object.values(mapping).includes('tags');
  const hasCompanyColumn = Object.values(mapping).includes('company');

  function reset() {
    setFile(null);
    setHeaders([]);
    setDataRows([]);
    setMapping({});
    setDefaultCountry(DEFAULT_IMPORT_COUNTRY);
    setExistingNormalized(new Set());
    setTagColorByKey(new Map());
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function setFieldMapping(index: number, field: ContactImportField) {
    setMapping((prev) => {
      const next: ColumnMapping = { ...prev };
      // Only one column per field (except ignore).
      if (field !== 'ignore') {
        for (const [k, v] of Object.entries(next)) {
          if (v === field && Number(k) !== index) {
            next[Number(k)] = 'ignore';
          }
        }
      }
      next[index] = field;
      return next;
    });
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    setResult(null);

    const text = await selected.text();
    const raw = parseContactCsvRaw(text);

    if (raw.headers.length === 0 || raw.dataRows.length === 0) {
      toast.error(t('toastNoValidRows'));
      setHeaders([]);
      setDataRows([]);
      setMapping({});
      return;
    }

    const detected = autoDetectColumnMapping(raw.headers);
    setHeaders(raw.headers);
    setDataRows(raw.dataRows);
    setMapping(detected);

    if (!mappingHasPhone(detected)) {
      toast.error(t('toastMapPhone'));
    }

    if (accountId) {
      const [{ data: existingRows }, { data: tags }] = await Promise.all([
        supabase
          .from('contacts')
          .select('phone_normalized')
          .eq('account_id', accountId),
        supabase.from('tags').select('name, color').eq('account_id', accountId),
      ]);

      setExistingNormalized(
        new Set(
          (existingRows ?? [])
            .map(
              (r) =>
                (r as { phone_normalized: string | null }).phone_normalized
            )
            .filter((p): p is string => !!p)
        )
      );

      const colors = new Map<string, string>();
      for (const tag of tags ?? []) {
        const key = tag.name.trim().toLowerCase();
        if (!colors.has(key)) colors.set(key, tag.color);
      }
      setTagColorByKey(colors);
    } else {
      setExistingNormalized(new Set());
      setTagColorByKey(new Map());
    }
  }

  async function handleImport() {
    if (validation.ready.length === 0) return;
    setImporting(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('Not authenticated');
      if (!accountId)
        throw new Error('Your profile is not linked to an account.');

      let imported = 0;
      let skipped =
        validation.duplicatesInFile + validation.duplicatesExisting;
      let failed = 0;
      const failedDetails: {
        rowNumber?: number;
        phone: string;
        name?: string;
        email?: string;
        company?: string;
        reason: string;
      }[] = [];

      // Validation-only failures → error CSV rows.
      for (const row of validation.rows) {
        if (row.errors.length === 0) continue;
        failedDetails.push({
          rowNumber: row.rowNumber,
          phone: row.raw.phone,
          name: row.raw.name,
          email: row.raw.email,
          company: row.raw.company,
          reason: describeImportErrors(row.errors).join('; '),
        });
      }

      const toInsert = validation.ready;
      const allTagNames = toInsert.flatMap((row) => row.tagNames);
      let tagIdByKey = new Map<string, string>();
      let skippedNames: string[] = [];
      if (allTagNames.length > 0) {
        ({ tagIdByKey, skippedNames } = await resolveImportTagIds(supabase, {
          accountId,
          userId: user.id,
          tagNames: allTagNames,
          canCreateTags: canEditSettings,
        }));
      }

      const tagAssignments: ContactTagAssignment[] = [];
      const chunkSize = 50;

      for (let i = 0; i < toInsert.length; i += chunkSize) {
        const chunk = toInsert.slice(i, i + chunkSize);
        const rows = chunk.map((row) => ({
          user_id: user.id,
          account_id: accountId,
          phone: row.e164,
          name: row.name || null,
          email: row.email || null,
          company: row.company || null,
        }));

        const { data, error } = await supabase
          .from('contacts')
          .insert(rows)
          .select('id');

        if (error) {
          for (let j = 0; j < rows.length; j++) {
            const row = rows[j];
            const source = chunk[j];
            const { data: singleData, error: singleErr } = await supabase
              .from('contacts')
              .insert(row)
              .select('id')
              .single();

            if (!singleErr && singleData) {
              imported++;
              if (source.tagNames.length > 0) {
                tagAssignments.push({
                  contactId: singleData.id,
                  tagNames: source.tagNames,
                });
              }
            } else if (isUniqueViolation(singleErr)) {
              skipped++;
              failedDetails.push({
                phone: row.phone,
                name: row.name ?? undefined,
                email: row.email ?? undefined,
                company: row.company ?? undefined,
                reason: describeImportErrors(['duplicate_existing']).join(
                  '; '
                ),
              });
            } else {
              failed++;
              console.error(
                '[contacts import] insert failed for',
                row.phone,
                singleErr
              );
              failedDetails.push({
                phone: row.phone,
                name: row.name ?? undefined,
                email: row.email ?? undefined,
                company: row.company ?? undefined,
                reason:
                  (singleErr as { message?: string } | null)?.message ||
                  t('unknownReason'),
              });
            }
          }
        } else {
          const inserted = data ?? [];
          imported += inserted.length;
          for (let j = 0; j < inserted.length; j++) {
            const source = chunk[j];
            if (!source || source.tagNames.length === 0) continue;
            tagAssignments.push({
              contactId: inserted[j].id,
              tagNames: source.tagNames,
            });
          }
        }
      }

      let tagsAssigned = 0;
      try {
        tagsAssigned = await assignImportedContactTags(
          supabase,
          tagAssignments,
          tagIdByKey
        );
      } catch {
        toast.warning(t('toastTagsWarning'));
      }

      const errorCsv = buildImportErrorCsv(
        failedDetails.map((d) => ({
          rowNumber: d.rowNumber,
          phone: d.phone,
          name: d.name,
          email: d.email,
          company: d.company,
          errors: [d.reason],
        }))
      );

      setResult({
        imported,
        skipped,
        invalidPhone: validation.invalidPhone,
        failed,
        failedDetails,
        tagsAssigned,
        errorCsv,
      });

      // Refresh existing set so a second import in the same session
      // sees newly inserted numbers.
      if (imported > 0) {
        setExistingNormalized((prev) => {
          const next = new Set(prev);
          for (const row of toInsert) {
            next.add(e164Digits(row.e164));
          }
          return next;
        });
        toast.success(t('toastImported', { count: imported }));
        onImported();
      }
      if (tagsAssigned > 0) {
        toast.success(t('toastTagsAssigned', { count: tagsAssigned }));
      }
      if (skippedNames.length > 0) {
        const sample = skippedNames.slice(0, 3).join(', ');
        const more =
          skippedNames.length > 3 ? ` (+${skippedNames.length - 3} more)` : '';
        toast.info(t('toastTagsSkipped', { sample, more }));
      }
      if (skipped > 0) {
        toast.info(t('toastSkipped', { count: skipped }));
      }
      if (validation.invalidPhone > 0) {
        toast.warning(
          t('toastInvalidPhone', { count: validation.invalidPhone })
        );
      }
      if (failed > 0) {
        toast.error(t('toastFailed', { count: failed }));
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('toastError');
      toast.error(message);
    } finally {
      setImporting(false);
    }
  }

  const previewRows: ValidatedImportRow[] = validation.rows.slice(
    0,
    PREVIEW_LIMIT
  );
  const previewHasTags =
    hasTagsColumn || previewRows.some((row) => row.raw.tagNames.length > 0);
  const previewHasCompany =
    hasCompanyColumn && previewRows.some((row) => row.raw.company?.trim());

  const tagStats = useMemo(() => {
    const names = new Set<string>();
    let rowsWithTags = 0;
    for (const row of mappedRows) {
      if (row.tagNames.length === 0) continue;
      rowsWithTags++;
      for (const name of row.tagNames) names.add(name.trim().toLowerCase());
    }
    return { unique: names.size, rowsWithTags };
  }, [mappedRows]);

  const readyCount = validation.ready.length;
  const errorRowCount =
    validation.invalidPhone +
    validation.duplicatesInFile +
    validation.duplicatesExisting;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,720px)] flex-col gap-0 overflow-hidden border-border/80 bg-popover p-0 text-popover-foreground sm:max-w-2xl">
        <div className="shrink-0 space-y-4 border-b border-border/80 px-6 pt-6 pb-5">
          <DialogHeader className="gap-1.5">
            <DialogTitle className="text-lg text-popover-foreground">
              {t('title')}
            </DialogTitle>
            <DialogDescription className="leading-relaxed text-muted-foreground">
              {t('descPlain')}
            </DialogDescription>
          </DialogHeader>

          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ')
                fileInputRef.current?.click();
            }}
            className={cn(
              'group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-5 transition-all',
              file
                ? 'border-primary/35 bg-primary/[0.04]'
                : 'hover:border-primary/40 border-border/80 bg-background/40 hover:bg-background/70'
            )}
          >
            {file ? (
              <>
                <div className="bg-primary/15 ring-primary/25 flex size-10 items-center justify-center rounded-lg ring-1">
                  <FileText className="text-primary size-5" />
                </div>
                <p
                  className="max-w-full truncate px-2 text-sm font-medium text-popover-foreground"
                  title={file.name}
                >
                  {truncateFilename(file.name)}
                </p>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {t('rowsReady', { count: mappedRows.length })}
                </span>
              </>
            ) : (
              <>
                <div className="flex size-10 items-center justify-center rounded-lg bg-muted/80 ring-1 ring-border/80 transition-colors group-hover:bg-muted">
                  <Upload className="size-5 text-muted-foreground group-hover:text-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">
                  {t('uploadDropzone')}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {t('uploadHint')}
                </p>
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="hidden"
          />

          {headers.length > 0 && !result && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                    {t('columnMapping')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('columnMappingHint')}
                  </p>
                </div>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  <span className="font-medium">{t('defaultCountry')}</span>
                  <select
                    value={defaultCountry}
                    onChange={(e) =>
                      setDefaultCountry(e.target.value as CountryCode)
                    }
                    className="h-8 rounded-md border border-border bg-background px-2 text-sm text-popover-foreground"
                  >
                    {DEFAULT_COUNTRY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {headers.map((header, index) => (
                  <label
                    key={`${header}-${index}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border/80 bg-background/40 px-3 py-2 text-xs"
                  >
                    <span
                      className="truncate font-medium text-popover-foreground"
                      title={header}
                    >
                      {header || t('emptyHeader')}
                    </span>
                    <select
                      value={mapping[index] ?? 'ignore'}
                      onChange={(e) =>
                        setFieldMapping(
                          index,
                          e.target.value as ContactImportField
                        )
                      }
                      className="h-7 max-w-[9rem] rounded-md border border-border bg-background px-2 text-xs text-popover-foreground"
                    >
                      {CONTACT_IMPORT_FIELDS.map((field) => (
                        <option key={field} value={field}>
                          {t(`fields.${field}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {previewRows.length > 0 && !result && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                  {t('validationPreview', { count: previewRows.length })}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-md bg-muted/90 px-2 py-0.5 text-[11px] text-muted-foreground">
                    {t('readyCount', { count: readyCount })}
                  </span>
                  {errorRowCount > 0 && (
                    <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-500">
                      {t('errorCount', { count: errorRowCount })}
                    </span>
                  )}
                  {tagStats.rowsWithTags > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted/90 px-2 py-0.5 text-[11px] text-muted-foreground">
                      <Tag className="text-primary/80 size-3" />
                      {t('previewTags', {
                        tags: tagStats.unique,
                        contacts: tagStats.rowsWithTags,
                      })}
                    </span>
                  )}
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-border ring-1 ring-border/50">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[36rem] text-xs">
                    <thead>
                      <tr className="border-b border-border bg-background/60">
                        <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                          {t('columns.status')}
                        </th>
                        <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                          {t('columns.phone')}
                        </th>
                        <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                          {t('columns.e164')}
                        </th>
                        <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                          {t('columns.name')}
                        </th>
                        {previewHasCompany && (
                          <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                            {t('columns.company')}
                          </th>
                        )}
                        {previewHasTags && (
                          <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                            {t('columns.tags')}
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/70">
                      {previewRows.map((row) => {
                        const hasError = row.errors.length > 0;
                        return (
                          <tr
                            key={row.rowNumber}
                            className={cn(
                              'bg-popover/40 transition-colors hover:bg-muted/30',
                              hasError && 'bg-amber-500/[0.04]'
                            )}
                          >
                            <td className="px-3 py-2 align-top">
                              {hasError ? (
                                <span
                                  className="text-amber-500"
                                  title={describeImportErrors(row.errors).join(
                                    '; '
                                  )}
                                >
                                  {describeImportErrors(row.errors)[0]}
                                </span>
                              ) : (
                                <span className="text-primary">{t('rowOk')}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                              <PreviewCell
                                value={row.raw.phone || '—'}
                                mono
                                maxWidth="max-w-[7.5rem]"
                              />
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                              <PreviewCell
                                value={row.e164 || '—'}
                                mono
                                maxWidth="max-w-[8rem]"
                              />
                            </td>
                            <td className="px-3 py-2 text-popover-foreground">
                              <PreviewCell
                                value={row.raw.name || '—'}
                                maxWidth="max-w-[8.5rem]"
                              />
                            </td>
                            {previewHasCompany && (
                              <td className="px-3 py-2 text-muted-foreground">
                                <PreviewCell
                                  value={row.raw.company || '—'}
                                  maxWidth="max-w-[7rem]"
                                />
                              </td>
                            )}
                            {previewHasTags && (
                              <td className="px-3 py-2 align-top">
                                <ImportPreviewTags
                                  tagNames={row.raw.tagNames}
                                  tagColorByKey={tagColorByKey}
                                />
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {validation.rows.length > PREVIEW_LIMIT && (
                <p className="text-center text-[11px] text-muted-foreground">
                  {t('moreRows', {
                    count: validation.rows.length - PREVIEW_LIMIT,
                  })}
                </p>
              )}
            </div>
          )}

          {result && (
            <div className="rounded-xl border border-border bg-background/50 p-4">
              <p className="text-sm font-medium text-popover-foreground">
                {t('importComplete')}
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                {result.imported > 0 && (
                  <div className="text-primary flex items-center gap-1.5 text-sm">
                    <CheckCircle className="size-4 shrink-0" />
                    {t('resultImported', { count: result.imported })}
                  </div>
                )}
                {result.tagsAssigned > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-cyan-400">
                    <CheckCircle className="size-4 shrink-0" />
                    {t('resultTags', { count: result.tagsAssigned })}
                  </div>
                )}
                {result.skipped > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-amber-400">
                    <AlertTriangle className="size-4 shrink-0" />
                    {t('resultSkipped', { count: result.skipped })}
                  </div>
                )}
                {result.invalidPhone > 0 && (
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-sm text-amber-400">
                      <AlertTriangle className="size-4 shrink-0" />
                      {t('resultInvalidPhone', {
                        count: result.invalidPhone,
                      })}
                    </div>
                    <p className="pl-[1.375rem] text-xs text-muted-foreground">
                      {t('invalidPhoneHint')}
                    </p>
                  </div>
                )}
                {result.failed > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-red-400">
                    <XCircle className="size-4 shrink-0" />
                    {t('resultFailed', { count: result.failed })}
                  </div>
                )}
              </div>

              {result.failedDetails.length > 0 && (
                <div className="mt-3 space-y-2 border-t border-border/80 pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                      {t('failedRowsHeading')}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 border-border text-xs text-muted-foreground"
                      onClick={() =>
                        downloadTextFile(
                          'contact-import-errors.csv',
                          result.errorCsv
                        )
                      }
                    >
                      <Download className="size-3.5" />
                      {t('downloadErrorCsv')}
                    </Button>
                  </div>
                  <ul className="max-h-32 space-y-1 overflow-y-auto text-xs">
                    {result.failedDetails.map((row, i) => (
                      <li
                        key={i}
                        className="flex items-baseline gap-2 text-muted-foreground"
                      >
                        <span className="shrink-0 font-mono text-popover-foreground">
                          {row.name ? `${row.name} (${row.phone})` : row.phone}
                        </span>
                        <span className="truncate">{row.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="mt-0 shrink-0 gap-2 border-t border-border/80 bg-background/50 px-6 py-4 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {result ? t('close') : t('cancel')}
          </Button>
          {!result && (
            <Button
              type="button"
              disabled={readyCount === 0 || importing}
              onClick={handleImport}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {importing && <Loader2 className="size-4 animate-spin" />}
              {t('importBtn', { count: readyCount })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
