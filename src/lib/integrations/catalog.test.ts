import { describe, expect, it } from 'vitest';

import {
  CATEGORY_LABELS,
  INTEGRATION_CATALOG,
  INTEGRATION_CATEGORIES,
  getProviderMeta,
  isIntegrationProvider,
  providersByCategory,
} from './catalog';

describe('integrations catalog', () => {
  it('covers every category with at least one provider', () => {
    for (const cat of INTEGRATION_CATEGORIES) {
      expect(providersByCategory(cat).length).toBeGreaterThan(0);
      expect(CATEGORY_LABELS[cat]).toBeTruthy();
    }
  });

  it('has unique provider ids and required field metadata', () => {
    const ids = INTEGRATION_CATALOG.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of INTEGRATION_CATALOG) {
      expect(isIntegrationProvider(p.id)).toBe(true);
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.fields.length).toBeGreaterThan(0);
    }
  });

  it('resolves provider meta', () => {
    expect(getProviderMeta('shopify')?.category).toBe('commerce');
    expect(getProviderMeta('nope')).toBeUndefined();
  });
});
