export function computeWorkerCursor({ startPage, checkedIds = [], summary }) {
  const shouldStayOnPage = summary.stoppedByMaxMatches
    || summary.stoppedByScanLimit
    || summary.stoppedByStopFile;
  const lastScannedPage = Math.max(1, Number(summary.lastScannedPage || startPage || 1));
  const nextPage = shouldStayOnPage ? lastScannedPage : lastScannedPage + 1;
  const nextCheckedIds = shouldStayOnPage
    ? unique([...checkedIds, ...(summary.scannedIds || [])])
    : [];

  return {
    nextPage,
    checkedPage: nextCheckedIds.length > 0 ? lastScannedPage : null,
    checkedIds: nextCheckedIds,
  };
}

export function shouldStopScreenshotPagination(ids) {
  return !Array.isArray(ids) || ids.length === 0;
}

export function normalizeNewestFeedState(value = {}) {
  const isNewestPage = Number(value.nextPage || 1) === 1;
  const checkedPage = isNewestPage && Number(value.checkedPage) === 1 ? 1 : null;

  return {
    ...value,
    nextPage: 1,
    checkedPage,
    checkedIds: checkedPage === 1 ? unique(value.checkedIds || []) : [],
  };
}

export function computeNewestFeedCursor({ checkedIds = [], summary }) {
  const cursor = computeWorkerCursor({
    startPage: 1,
    checkedIds,
    summary,
  });

  return {
    ...cursor,
    nextPage: 1,
    checkedPage: cursor.checkedIds.length > 0 ? 1 : null,
  };
}

export function shouldStopFeedWorkerLoop(summary) {
  if (!summary || typeof summary !== 'object') return false;
  if (
    summary.stoppedByMaxMatches
    || summary.stoppedByScanLimit
    || summary.stoppedByStopFile
  ) {
    return false;
  }

  return true;
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}
