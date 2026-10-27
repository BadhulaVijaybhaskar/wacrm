#!/usr/bin/env node
'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSeedPlan, DEMO_CONTACTS, DEMO_TAG } from './seed-demo-data.mjs';

test('buildSeedPlan brands Astra Chat and is deterministic', () => {
  const plan = buildSeedPlan({
    accountId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
  });
  assert.equal(plan.tag.name, DEMO_TAG.name);
  assert.match(plan.tag.name, /Astra Chat/);
  assert.equal(plan.contacts.length, DEMO_CONTACTS.length);
  assert.ok(plan.contacts.every((c) => c.company.includes('Astra Chat')));
  assert.match(plan.noteText, /Astra Chat/);
});

test('buildSeedPlan refuses missing ids', () => {
  assert.throws(() => buildSeedPlan({ accountId: '', userId: 'x' }), /required/);
});
