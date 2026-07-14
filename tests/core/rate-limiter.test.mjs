import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  computePageDelay,
  computeRequestDelay,
  createRateLimiterState,
  loadRateLimiterState,
  record429,
  record5xx,
  recordSuccess,
  saveRateLimiterState,
} from '../../src/core/rate-limiter.mjs';

test('initial delay equals configured value', () => {
  const state = createRateLimiterState(2000);
  assert.equal(computeRequestDelay(state), 2000);
});

test('delay floors to minimum of 500ms', () => {
  const state = createRateLimiterState(100);
  assert.equal(computeRequestDelay(state), 500);
});

test('delay caps at maximum of 30000ms', () => {
  const state = createRateLimiterState(99999);
  assert.equal(computeRequestDelay(state), 30000);
});

test('success gradually reduces boosted delay after threshold', () => {
  let state = record429(createRateLimiterState(2000));

  // First 9 successes should not change delay
  for (let i = 0; i < 9; i++) {
    state = recordSuccess(state);
  }
  assert.equal(computeRequestDelay(state), 4000);

  // 10th success triggers reduction (4000 * 0.9 = 3600)
  state = recordSuccess(state);
  assert.equal(computeRequestDelay(state), 3600);
});

test('429 doubles base delay', () => {
  let state = createRateLimiterState(2000);
  state = record429(state);
  assert.equal(computeRequestDelay(state), 4000);
});

test('429 resets consecutive successes', () => {
  let state = createRateLimiterState(2000);

  // Build up some successes
  for (let i = 0; i < 5; i++) {
    state = recordSuccess(state);
  }
  assert.equal(state.consecutiveSuccesses, 5);

  // 429 resets to 0
  state = record429(state);
  assert.equal(state.consecutiveSuccesses, 0);
});

test('5xx increases delay by 1.5x', () => {
  let state = createRateLimiterState(2000);
  state = record5xx(state);
  assert.equal(computeRequestDelay(state), 3000);
});

test('delay never goes below configured delay floor after many successes', () => {
  let state = createRateLimiterState(2000);

  // Push many successes to drive delay down
  for (let cycle = 0; cycle < 20; cycle++) {
    for (let i = 0; i < 10; i++) {
      state = recordSuccess(state);
    }
  }

  assert.equal(computeRequestDelay(state), 2000);
});

test('delay never exceeds maximum after many 429s', () => {
  let state = createRateLimiterState(2000);

  // Rapid 429s
  for (let i = 0; i < 10; i++) {
    state = record429(state);
  }

  assert.equal(computeRequestDelay(state), 30000); // max cap
});

test('page delay is roughly 2x request delay', () => {
  const state = createRateLimiterState(2000);
  assert.equal(computePageDelay(state), 4000);
});

test('page delay has its own max cap', () => {
  const state = createRateLimiterState(50000);
  assert.equal(computePageDelay(state), 60000); // page cap, not 100000
});

test('persists and reloads state from file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-rl-'));
  const filePath = path.join(root, 'rate-limiter.json');

  const original = createRateLimiterState(2000);
  const modified = record429(record429(original));
  await saveRateLimiterState(filePath, modified);

  const loaded = await loadRateLimiterState(filePath);
  assert.equal(loaded.baseDelayMs, modified.baseDelayMs);
  assert.equal(loaded.total429s, modified.total429s);
});

test('loadRateLimiterState returns fresh state for missing file', async () => {
  const state = await loadRateLimiterState('/does/not/exist.json', 3000);
  assert.equal(state.baseDelayMs, 3000);
  assert.equal(state.consecutiveSuccesses, 0);
});

test('loadRateLimiterState does not allow persisted delay below configured delay', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-rl-'));
  const filePath = path.join(root, 'rate-limiter.json');
  await fs.writeFile(
    filePath,
    JSON.stringify({
      baseDelayMs: 3000,
      consecutiveSuccesses: 0,
      consecutive429s: 2,
      totalRequests: 28,
      total429s: 2,
      last429At: '2026-06-25T15:35:45.509Z',
    }),
  );

  const state = await loadRateLimiterState(filePath, 30000);

  assert.equal(computeRequestDelay(state), 30000);
});

test('success recovery does not reduce delay below configured delay floor', () => {
  let state = createRateLimiterState(30000);

  for (let cycle = 0; cycle < 10; cycle++) {
    for (let i = 0; i < 10; i++) {
      state = recordSuccess(state);
    }
  }

  assert.equal(computeRequestDelay(state), 30000);
});
