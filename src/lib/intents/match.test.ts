import { describe, expect, it } from 'vitest';

import { matchIntents, type IntentPhrase } from './match';

const PHRASES: IntentPhrase[] = [
  {
    intent_id: 'i1',
    intent_name: 'order_status',
    display_name: 'Order status',
    phrase: 'where is my order',
    trigger_flow_id: 'flow-1',
  },
  {
    intent_id: 'i1',
    intent_name: 'order_status',
    display_name: 'Order status',
    phrase: 'track order',
  },
  {
    intent_id: 'i2',
    intent_name: 'greeting',
    display_name: 'Greeting',
    phrase: 'hello',
  },
];

describe('matchIntents', () => {
  it('exact-matches training phrases', () => {
    const hits = matchIntents('Where is my order?', PHRASES);
    expect(hits[0]?.name).toBe('order_status');
    expect(hits[0]?.confidence).toBe(1);
    expect(hits[0]?.trigger_flow_id).toBe('flow-1');
  });

  it('contains-matches and ranks above greeting', () => {
    const hits = matchIntents('hi, can you track order please', PHRASES);
    expect(hits[0]?.name).toBe('order_status');
    expect(hits[0]?.confidence).toBe(0.85);
  });

  it('returns empty when nothing matches', () => {
    expect(matchIntents('unrelated gibberish xyz', PHRASES)).toEqual([]);
  });
});
