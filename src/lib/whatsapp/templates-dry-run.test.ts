import { afterEach, describe, expect, it } from 'vitest';

import {
  isDryRunTemplateId,
  isStubDecision,
  isTemplatesDryRun,
} from './templates-dry-run';

describe('isTemplatesDryRun', () => {
  afterEach(() => {
    delete process.env.WHATSAPP_TEMPLATES_DRY_RUN;
    delete process.env.META_STUB;
  });

  it('is off by default', () => {
    expect(isTemplatesDryRun()).toBe(false);
  });

  it('accepts WHATSAPP_TEMPLATES_DRY_RUN or META_STUB', () => {
    process.env.WHATSAPP_TEMPLATES_DRY_RUN = '1';
    expect(isTemplatesDryRun()).toBe(true);
    delete process.env.WHATSAPP_TEMPLATES_DRY_RUN;
    process.env.META_STUB = 'true';
    expect(isTemplatesDryRun()).toBe(true);
  });
});

describe('isDryRunTemplateId / isStubDecision', () => {
  it('detects dry-run meta ids', () => {
    expect(isDryRunTemplateId('dry-run-abc')).toBe(true);
    expect(isDryRunTemplateId('12345')).toBe(false);
    expect(isDryRunTemplateId(null)).toBe(false);
  });

  it('accepts APPROVED and REJECTED only', () => {
    expect(isStubDecision('APPROVED')).toBe(true);
    expect(isStubDecision('REJECTED')).toBe(true);
    expect(isStubDecision('PENDING')).toBe(false);
  });
});
