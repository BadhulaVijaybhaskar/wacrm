import { describe, expect, it } from 'vitest';
import {
  applyColumnMapping,
  autoDetectColumnMapping,
  mappingHasPhone,
} from './column-map';

describe('autoDetectColumnMapping', () => {
  it('maps common aliases including Mobile → phone', () => {
    const mapping = autoDetectColumnMapping([
      'Mobile',
      'Full Name',
      'E-mail',
      'Organization',
      'Labels',
    ]);
    expect(mapping[0]).toBe('phone');
    expect(mapping[1]).toBe('name');
    expect(mapping[2]).toBe('email');
    expect(mapping[3]).toBe('company');
    expect(mapping[4]).toBe('tags');
    expect(mappingHasPhone(mapping)).toBe(true);
  });

  it('ignores unknown columns', () => {
    const mapping = autoDetectColumnMapping(['phone', 'notes']);
    expect(mapping[0]).toBe('phone');
    expect(mapping[1]).toBe('ignore');
  });
});

describe('applyColumnMapping', () => {
  it('binds cells using the mapping indices', () => {
    const rows = applyColumnMapping(
      ['Mobile', 'Full Name', 'Tags'],
      [
        ['9876543210', 'Ada', 'VIP; Lead'],
        ['+14155552671', 'Bob', ''],
      ],
      { 0: 'phone', 1: 'name', 2: 'tags' },
    );
    expect(rows).toEqual([
      {
        phone: '9876543210',
        name: 'Ada',
        email: undefined,
        company: undefined,
        tagNames: ['VIP', 'Lead'],
      },
      {
        phone: '+14155552671',
        name: 'Bob',
        email: undefined,
        company: undefined,
        tagNames: [],
      },
    ]);
  });
});
