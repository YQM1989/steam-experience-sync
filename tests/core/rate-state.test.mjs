import assert from 'node:assert/strict';
import { test } from 'node:test';

import { recordRateFailure, resetRateFailures } from '../../src/core/rate-state.mjs';

test('recordRateFailure pauses after three consecutive failures', () => {
  let state = {};
  state = recordRateFailure(state, '2026-06-23T10:00:00.000Z');
  state = recordRateFailure(state, '2026-06-23T10:01:00.000Z');
  state = recordRateFailure(state, '2026-06-23T10:02:00.000Z');

  assert.equal(state.consecutiveRateFailures, 3);
  assert.equal(state.pausedByRateLimit, true);
});

test('resetRateFailures clears pause state', () => {
  const state = resetRateFailures({
    consecutiveRateFailures: 3,
    pausedByRateLimit: true,
  });

  assert.equal(state.consecutiveRateFailures, 0);
  assert.equal(state.pausedByRateLimit, false);
});
