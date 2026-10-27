import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  applyFieldMap,
  buildAstraCrmPayload,
  signAstraCrmBody,
} from './push';

describe('crm push helpers', () => {
  it('maps fields and signs Astra CRM payloads', () => {
    const mapped = applyFieldMap({
      phone: '+919876543210',
      name: 'Priya',
      email: 'p@example.com',
    });
    expect(mapped.phone).toBe('+919876543210');
    expect(mapped.firstname).toBe('Priya');

    const body = JSON.stringify(
      buildAstraCrmPayload(
        { phone: '+919876543210', name: 'Priya' },
        mapped,
      ),
    );
    const sig = signAstraCrmBody(body, 'secret');
    expect(sig).toBe(
      createHmac('sha256', 'secret').update(body).digest('hex'),
    );
  });
});
