import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as workerProgress from '../../src/core/worker-progress.mjs';

const { computeWorkerCursor } = workerProgress;

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

test('screenshot pagination stops on the first empty page', () => {
  assert.equal(typeof workerProgress.shouldStopScreenshotPagination, 'function');
  assert.equal(workerProgress.shouldStopScreenshotPagination([]), true);
  assert.equal(workerProgress.shouldStopScreenshotPagination(['100']), false);
});

test('legacy feed cursor is reset to the newest screenshot page', () => {
  assert.equal(typeof workerProgress.normalizeNewestFeedState, 'function');

  const state = workerProgress.normalizeNewestFeedState({
    nextPage: 151,
    checkedPage: 151,
    checkedIds: ['100'],
    imported: 807,
  });

  assert.deepEqual(state, {
    nextPage: 1,
    checkedPage: null,
    checkedIds: [],
    imported: 807,
  });
});

test('newest feed keeps partial page checks but never advances past page one', () => {
  assert.equal(typeof workerProgress.computeNewestFeedCursor, 'function');

  const cursor = workerProgress.computeNewestFeedCursor({
    checkedIds: ['100'],
    summary: {
      lastScannedPage: 1,
      scannedIds: ['101', '100'],
      stoppedByMaxMatches: false,
      stoppedByScanLimit: true,
      stoppedByStopFile: false,
    },
  });

  assert.deepEqual(cursor, {
    nextPage: 1,
    checkedPage: 1,
    checkedIds: ['100', '101'],
  });
});
