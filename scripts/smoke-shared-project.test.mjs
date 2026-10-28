#!/usr/bin/env node
'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  SMOKE_TAG,
  resolveSmokeSchema,
  resolveSmokeBucketPrefix,
  signGet,
} from './smoke-shared-project.mjs';

test('shared-project defaults target wacrm schema and wacrm- buckets', () => {
  assert.equal(resolveSmokeSchema({}), 'wacrm');
  assert.equal(resolveSmokeSchema({ SUPABASE_DB_SCHEMA: 'wacrm' }), 'wacrm');
  assert.equal(resolveSmokeBucketPrefix({}), 'wacrm-');
  assert.equal(
    resolveSmokeBucketPrefix({ STORAGE_BUCKET_PREFIX: 'wacrm-' }),
    'wacrm-',
  );
  assert.match(SMOKE_TAG, /smoke-shared/);
});

test('signGet matches Connect read GET payload shape', () => {
  const path = '/api/astra-connect/v1/conversations?tenant_id=t_x';
  const tenant = 't_x';
  const secret = 'test-secret-16chars';
  const { ts, sig } = signGet(path, tenant, secret);
  assert.equal(typeof ts, 'number');
  assert.match(sig, /^sha256=[0-9a-f]+$/);
  const expected = createHmac('sha256', secret)
    .update(`${ts}.`)
    .update(`${path}.${tenant}`)
    .digest('hex');
  assert.equal(sig, `sha256=${expected}`);
});
