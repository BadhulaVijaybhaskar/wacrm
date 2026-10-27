#!/usr/bin/env node
'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSeedPlan,
  DEMO_AGENT,
  DEMO_CONTACTS,
  DEMO_NOTE,
  DEMO_TAG,
} from './seed-demo-data.mjs';

test('buildSeedPlan uses Demo Agent identity and realistic copy', () => {
  const plan = buildSeedPlan({
    accountId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
  });
  assert.equal(plan.agent.fullName, DEMO_AGENT.fullName);
  assert.equal(plan.agent.email, DEMO_AGENT.email);
  assert.equal(plan.tag.name, DEMO_TAG.name);
  assert.equal(plan.noteText, DEMO_NOTE);
  assert.equal(plan.contacts.length, 8);
  assert.equal(plan.contacts.filter((c) => c.withConversation).length, 5);
  assert.ok(plan.contacts.some((c) => c.handoff === 'human'));
  assert.equal(plan.broadcast.status, 'sent');

  const blob = JSON.stringify(plan);
  assert.doesNotMatch(blob, /CHAT-?\d+/i);
  assert.doesNotMatch(blob, /seed-demo-data/);
  assert.doesNotMatch(blob, /staging smoke/i);
  assert.doesNotMatch(blob, /Chat14/i);
});

test('buildSeedPlan refuses missing ids', () => {
  assert.throws(() => buildSeedPlan({ accountId: '', userId: 'x' }), /required/);
});

test('DEMO_CONTACTS stay customer-facing', () => {
  for (const c of DEMO_CONTACTS) {
    assert.ok(c.name);
    assert.match(c.phone, /^\+1555010000\d$/);
    assert.doesNotMatch(c.email, /chat14/i);
    assert.doesNotMatch(c.company, /CHAT-?\d+/i);
  }
});
