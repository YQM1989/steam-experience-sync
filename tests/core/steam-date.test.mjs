import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseSteamPostedAt } from '../../src/core/steam-date.mjs';

test('parseSteamPostedAt handles day-month screenshots without year', () => {
  const postedAt = parseSteamPostedAt('6 Jun @ 8:57am', new Date(2026, 5, 25, 20, 12, 0));

  assert.equal(postedAt.getFullYear(), 2026);
  assert.equal(postedAt.getMonth(), 5);
  assert.equal(postedAt.getDate(), 6);
  assert.equal(postedAt.getHours(), 8);
  assert.equal(postedAt.getMinutes(), 57);
});
