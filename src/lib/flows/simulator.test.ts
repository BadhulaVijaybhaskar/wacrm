import { describe, expect, it } from 'vitest';

import { simulateFlowStep } from './simulator';

describe('simulateFlowStep', () => {
  it('walks start → message → end', () => {
    const a = simulateFlowStep({
      node_type: 'start',
      config: { next_node_key: 'msg' },
      vars: {},
    });
    expect(a.next).toBe('msg');
    const b = simulateFlowStep({
      node_type: 'send_message',
      config: { text: 'Hi', next_node_key: 'end' },
      vars: a.vars,
    });
    expect(b.log).toMatch(/Hi/);
    const c = simulateFlowStep({
      node_type: 'end',
      config: {},
      vars: b.vars,
    });
    expect(c.terminal).toBe(true);
  });

  it('stores collect_input and evaluates condition', () => {
    const collected = simulateFlowStep({
      node_type: 'collect_input',
      config: { var_key: 'city', next_node_key: 'cond' },
      vars: {},
      inputText: 'Mumbai',
    });
    expect(collected.vars.city).toBe('Mumbai');
    const cond = simulateFlowStep({
      node_type: 'condition',
      config: {
        subject_key: 'city',
        operator: 'equals',
        value: 'Mumbai',
        true_next: 'yes',
        false_next: 'no',
      },
      vars: collected.vars,
    });
    expect(cond.next).toBe('yes');
  });
});
