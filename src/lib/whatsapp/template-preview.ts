/**
 * Pure helpers for the template phone-style preview.
 * Substitutes {{n}} placeholders with sample values (1-indexed).
 */

export function substituteTemplateVariables(
  text: string,
  samples: ReadonlyArray<string> | undefined,
): string {
  if (!text) return '';
  return text.replace(/\{\{(\d+)\}\}/g, (match, raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) return match;
    const sample = samples?.[n - 1];
    return sample && sample.length > 0 ? sample : match;
  });
}
