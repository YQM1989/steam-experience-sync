import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_INITIAL_DELAY_MS = 2000;
const MIN_DELAY_MS = 500;
const MAX_DELAY_MS = 30000;
const MAX_PAGE_DELAY_MS = 60000;
const RECOVERY_THRESHOLD = 10;
const RECOVERY_FACTOR = 0.9;
const BOOST_ON_429 = 2;
const BOOST_ON_5XX = 1.5;

/**
 * @typedef {object} RateLimiterState
 * @property {number} baseDelayMs
 * @property {number} minimumDelayMs
 * @property {number} consecutiveSuccesses
 * @property {number} consecutive429s
 * @property {number} totalRequests
 * @property {number} total429s
 * @property {string|null} last429At
 */

/**
 * @returns {RateLimiterState}
 */
export function createRateLimiterState(initialDelayMs = DEFAULT_INITIAL_DELAY_MS) {
  const minimumDelayMs = normalizeDelay(initialDelayMs);
  return {
    baseDelayMs: minimumDelayMs,
    minimumDelayMs,
    consecutiveSuccesses: 0,
    consecutive429s: 0,
    totalRequests: 0,
    total429s: 0,
    last429At: null,
  };
}

/**
 * Load state from disk, or return a fresh state.
 * @param {string} filePath
 * @param {number} [initialDelayMs]
 * @returns {Promise<RateLimiterState>}
 */
export async function loadRateLimiterState(filePath, initialDelayMs) {
  try {
    const fresh = createRateLimiterState(initialDelayMs);
    if (!filePath || !fsSync.existsSync(filePath)) {
      return fresh;
    }
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const minimumDelayMs = Math.max(
      fresh.minimumDelayMs,
      normalizeDelay(parsed.minimumDelayMs || fresh.minimumDelayMs),
    );
    return {
      ...fresh,
      ...parsed,
      minimumDelayMs,
      baseDelayMs: Math.min(
        MAX_DELAY_MS,
        Math.max(
          minimumDelayMs,
          Number(parsed.baseDelayMs) || initialDelayMs || DEFAULT_INITIAL_DELAY_MS,
        ),
      ),
    };
  } catch {
    return createRateLimiterState(initialDelayMs);
  }
}

/**
 * Persist state to disk.
 * @param {string} filePath
 * @param {RateLimiterState} state
 */
export async function saveRateLimiterState(filePath, state) {
  if (!filePath) return;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(state, null, 2));
}

/**
 * Call after a successful HTTP response (2xx, 3xx).
 * Gradually reduces base delay after consecutive successes.
 * @param {RateLimiterState} state
 * @returns {RateLimiterState}
 */
export function recordSuccess(state) {
  const next = { ...state };
  next.totalRequests += 1;
  next.consecutiveSuccesses += 1;

  if (next.consecutiveSuccesses >= RECOVERY_THRESHOLD) {
    next.baseDelayMs = Math.max(getMinimumDelay(next), Math.floor(next.baseDelayMs * RECOVERY_FACTOR));
    next.consecutiveSuccesses = 0; // reset counter after adjustment
  }

  return next;
}

/**
 * Call after a 429 response.
 * Doubles base delay and resets success counter.
 * @param {RateLimiterState} state
 * @returns {RateLimiterState}
 */
export function record429(state) {
  const next = { ...state };
  next.totalRequests += 1;
  next.total429s += 1;
  next.consecutive429s += 1;
  next.consecutiveSuccesses = 0;
  next.last429At = new Date().toISOString();
  next.baseDelayMs = Math.min(MAX_DELAY_MS, Math.floor(next.baseDelayMs * BOOST_ON_429));
  return next;
}

/**
 * Call after a 5xx or other retryable failure.
 * Slightly increases base delay.
 * @param {RateLimiterState} state
 * @returns {RateLimiterState}
 */
export function record5xx(state) {
  const next = { ...state };
  next.totalRequests += 1;
  next.consecutiveSuccesses = 0;
  next.baseDelayMs = Math.min(MAX_DELAY_MS, Math.floor(next.baseDelayMs * BOOST_ON_5XX));
  return next;
}

/**
 * Returns the delay in ms to wait before the next request.
 * @param {RateLimiterState} state
 * @returns {number}
 */
export function computeRequestDelay(state) {
  return state.baseDelayMs;
}

/**
 * Returns the delay in ms to wait between page requests.
 * Slightly higher than per-item delay since page transitions
 * are more likely to trigger rate limiting.
 * @param {RateLimiterState} state
 * @returns {number}
 */
export function computePageDelay(state) {
  return Math.min(MAX_PAGE_DELAY_MS, Math.floor(state.baseDelayMs * 2));
}

/**
 * Returns a human-readable summary of the rate limiter state.
 * @param {RateLimiterState} state
 * @returns {string}
 */
export function formatRateLimiterSummary(state) {
  return (
    `baseDelay=${state.baseDelayMs}ms ` +
    `floor=${getMinimumDelay(state)}ms ` +
    `successes=${state.consecutiveSuccesses} ` +
    `429s=${state.total429s}/${state.totalRequests}`
  );
}

function normalizeDelay(value) {
  return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, Number(value) || DEFAULT_INITIAL_DELAY_MS));
}

function getMinimumDelay(state) {
  return normalizeDelay(state.minimumDelayMs || MIN_DELAY_MS);
}
