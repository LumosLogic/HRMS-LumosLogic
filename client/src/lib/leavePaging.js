// Pure pagination helpers for the Leaves page (no imports, so they can be unit-tested under plain Node).

export const PAGE_SIZES = [25, 50, 100];
export const DEFAULT_PAGE_SIZE = 25;

/**
 * Signature of everything that defines WHICH rows the pager is paging through. A page number is only valid for the
 * signature it was chosen under: change any filter / tab / branch / page size and the page is 1 again.
 */
export function leaveFilterSig({ branchId, tab, status, type, from, to, userId, allHistory, pageSize }) {
  return JSON.stringify([branchId ?? null, tab, status, type || '', from || '', to || '', userId || '', !!allHistory, pageSize]);
}

/** The page to request: the stored page while the signature is unchanged, otherwise page 1 (same render, no stale request). */
export function resolvePage(state, sig) {
  return state && state.sig === sig ? Math.max(1, state.page | 0 || 1) : 1;
}

export function pageCount(total, pageSize) {
  return total == null ? null : Math.max(1, Math.ceil(total / pageSize));
}

/** Last page that exists when the current one has run past the end (e.g. the last row of the last page was deleted). */
export function clampPage(page, totalPages) {
  return totalPages == null ? page : Math.min(Math.max(1, page), totalPages);
}

/** "Showing 26–50 of 137" bounds for the current page. */
export function pageRange(page, pageSize, rowCount) {
  return { from: rowCount === 0 ? 0 : (page - 1) * pageSize + 1, to: (page - 1) * pageSize + rowCount };
}
