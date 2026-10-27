import { describe, expect, it } from 'vitest';

import { nextBackoffSeconds } from './retry-queue';

describe('nextBackoffSeconds', () => {
  it('grows then caps', () => {
    expect(nextBackoffSeconds(0)).toBe(30);
    expect(nextBackoffSeconds(1)).toBe(60);
    expect(nextBackoffSeconds(7)).toBe(7200);
    expect(nextBackoffSeconds(99)).toBe(7200);
  });
});
