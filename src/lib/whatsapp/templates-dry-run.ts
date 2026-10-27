/**
 * Shared dry-run / Meta stub detection for message templates.
 * Staging can set either WHATSAPP_TEMPLATES_DRY_RUN or META_STUB.
 */

function envFlagOn(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/** True when template submit/edit/delete must not call live Meta. */
export function isTemplatesDryRun(): boolean {
  return envFlagOn('WHATSAPP_TEMPLATES_DRY_RUN') || envFlagOn('META_STUB');
}

/** Local dry-run Meta IDs look like `dry-run-<uuid>`. */
export function isDryRunTemplateId(metaTemplateId: string | null | undefined): boolean {
  return typeof metaTemplateId === 'string' && metaTemplateId.startsWith('dry-run-');
}

export const STUB_DECISIONS = ['APPROVED', 'REJECTED'] as const;
export type StubDecision = (typeof STUB_DECISIONS)[number];

export function isStubDecision(value: unknown): value is StubDecision {
  return (
    typeof value === 'string' &&
    (STUB_DECISIONS as ReadonlyArray<string>).includes(value)
  );
}
