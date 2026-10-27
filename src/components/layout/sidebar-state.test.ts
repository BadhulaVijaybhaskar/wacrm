import { describe, expect, it } from 'vitest';

import { resolveSidebarCollapsed } from './sidebar-state';

describe('resolveSidebarCollapsed', () => {
  it('auto-collapses below the desktop breakpoint', () => {
    expect(
      resolveSidebarCollapsed({ belowDesktop: true, preference: 'expanded' })
    ).toBe(true);
  });

  it('uses the saved preference on desktop', () => {
    expect(
      resolveSidebarCollapsed({ belowDesktop: false, preference: 'collapsed' })
    ).toBe(true);
    expect(
      resolveSidebarCollapsed({ belowDesktop: false, preference: 'expanded' })
    ).toBe(false);
  });

  it('defaults to expanded on desktop', () => {
    expect(
      resolveSidebarCollapsed({ belowDesktop: false, preference: null })
    ).toBe(false);
  });
});
