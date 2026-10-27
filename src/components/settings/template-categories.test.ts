import { describe, expect, it } from 'vitest';

import { CREATEABLE_TEMPLATE_CATEGORIES } from './template-manager';

describe('CREATEABLE_TEMPLATE_CATEGORIES', () => {
  it('exposes Marketing and Utility only (Auth is Meta-sync)', () => {
    expect([...CREATEABLE_TEMPLATE_CATEGORIES]).toEqual([
      'Marketing',
      'Utility',
    ]);
    expect(CREATEABLE_TEMPLATE_CATEGORIES).not.toContain('Authentication');
  });
});
