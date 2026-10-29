import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Embedded Signup settings wiring', () => {
  it('has a single popup card and no legacy stub Connect button or probe', () => {
    const page = readFileSync('src/app/(dashboard)/settings/page.tsx', 'utf8');
    const legacyConfig = readFileSync('src/components/settings/whatsapp-config.tsx', 'utf8');
    expect(page.match(/<EmbeddedSignupCard\s*\/>/g)).toHaveLength(1);
    expect(legacyConfig).not.toContain('handleEmbeddedSignup');
    expect(legacyConfig).not.toContain('/api/whatsapp/config/embedded-signup');
    expect(legacyConfig).not.toContain('embeddedSignupConnect');
  });
});
