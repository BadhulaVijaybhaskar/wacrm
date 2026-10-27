import { describe, expect, it } from 'vitest';

import { substituteTemplateVariables } from './template-preview';

describe('substituteTemplateVariables', () => {
  it('replaces contiguous {{n}} with samples', () => {
    expect(
      substituteTemplateVariables('Hi {{1}}, order {{2}}', ['Priya', '42']),
    ).toBe('Hi Priya, order 42');
  });

  it('leaves missing samples as placeholders', () => {
    expect(substituteTemplateVariables('Hi {{1}}', [])).toBe('Hi {{1}}');
  });

  it('handles empty text', () => {
    expect(substituteTemplateVariables('', ['a'])).toBe('');
  });
});
