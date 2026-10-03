// Query scoping helpers for branch switching.
//
// Rule of thumb for React Query keys in this app:
//   • branch-dependent data  → put `selectedBranchId` in the key (each branch is its own cache entry,
//                              switching back is instant and branch A data can never show as branch B)
//   • organisation-level data → NO branch in the key (it is the same for every branch)
//
// ORG_LEVEL_QUERY_KEYS lists the first key segment of queries that never depend on the selected
// branch. A branch switch must not refetch them.
export const ORG_LEVEL_QUERY_KEYS = new Set([
  'org-features',        // feature flags
  'org-settings',        // organisation identity
  'departments',         // departments are organisation-wide
  'designations',
  'branches',            // branch list itself
  'payroll-settings',    // legal-entity payroll configuration
  'statutory-config',    // legal-entity statutory configuration
  'compliance-returns',
  'biometric-auto-sync-config', // org-level ingestion schedule
  'email-automation-settings',
  'notify-recipients',
  'root-admins',
  'vapid-status',
  'leave-workflow-config-summary',
  'notif-count',
  'notif-count-root',
  'notifications',       // notifications are per-user
  'is-dept-head',
]);

/**
 * Called when the selected branch changes. Branch-keyed queries refetch by themselves (new key);
 * this only refreshes the remaining branch-dependent queries whose key does not carry the branch,
 * leaves organisation-level queries cached, and never restarts a request that is already in flight.
 */
export function invalidateBranchScoped(queryClient) {
  return queryClient.invalidateQueries(
    { predicate: (q) => !ORG_LEVEL_QUERY_KEYS.has(String(q.queryKey?.[0])) },
    { cancelRefetch: false },
  );
}
