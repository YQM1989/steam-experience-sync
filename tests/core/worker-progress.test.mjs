import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeWorkerCursor } from '../../src/core/worker-progress.mjs';

test('scan limit keeps the worker on the current page and accumulates checked ids', () => {
  const cursor = computeWorkerCursor({
    startPage: 4,
    checkedIds: ['100'],
    summary: {
      lastScannedPage: 4,
      scannedIds: ['101', '102', '100'],
      stoppedByMaxMatches: false,
      stoppedByScanLimit: true,
      stoppedByStopFile: false,
    },
  });

  assert.deepEqual(cursor, {
    nextPage: 4,
    checkedPage: 4,
    checkedIds: ['100', '101', '102'],
  });
});

test('completed page advances and clears checked ids', () => {
  const cursor = computeWorkerCursor({
    startPage: 4,
    checkedIds: ['100'],
    summary: {
      lastScannedPage: 4,
      scannedIds: ['101'],
      stoppedByMaxMatches: false,
      stoppedByScanLimit: false,
      stoppedByStopFile: false,
    },
  });

  assert.deepEqual(cursor, {
    nextPage: 5,
    checkedPage: null,
    checkedIds: [],
  });
});
