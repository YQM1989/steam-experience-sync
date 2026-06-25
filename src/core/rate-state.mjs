export function recordRateFailure(state = {}, now = new Date().toISOString()) {
  const count = Number(state.consecutiveRateFailures || 0) + 1;
  return {
    ...state,
    consecutiveRateFailures: count,
    lastRateFailureAt: now,
    pausedByRateLimit: count >= 3,
  };
}

export function resetRateFailures(state = {}) {
  return {
    ...state,
    consecutiveRateFailures: 0,
    pausedByRateLimit: false,
  };
}
