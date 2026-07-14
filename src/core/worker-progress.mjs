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

function unique(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}
