// A branch-dependent hook is disabled until the branch context has settled (otherwise it would fetch once with the wrong
// branch and again with the right one). A disabled query reports isLoading === false, so a page that checks isLoading
// would flash its EMPTY state ("No leave records") before the request even starts. While the hook is only WAITING for the
// branch context, report it as loading — exactly what the page saw before the gate existed.
export const gateLoading = (query, waiting) => (waiting && query.isPending ? { ...query, isLoading: true } : query);
