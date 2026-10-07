// Query scoping helpers for branch switching.
//
// Every React Query key in this app is one of three kinds, and a branch switch treats each differently:
//
//  1. BRANCH-KEYED   the key carries the selected branch (…, selectedBranchId) and the query declares
//                    `meta: BRANCH_KEYED`. Each branch is its own cache entry: the new branch fetches under its new
//                    key by itself, branch A's data can never be served as branch B's, and switching back reuses the
//                    cache while it is fresh. Nothing to invalidate.
//  2. ORGANISATION-LEVEL  the same for every branch (ORG_LEVEL_QUERY_KEYS): branches, departments, settings, schedules,
//                    payroll / statutory configuration, feature flags, notifications ...  Never refetched by a switch.
//  3. SINGLE-RECORD / OWN-DATA  one employee's profile, one payslip / payroll run, one role, my-* self-service data
//                    (BRANCH_INDEPENDENT_*): the record is the same whichever branch is selected. Not refetched.
//
// Anything else — a query nobody classified — is treated as possibly branch-dependent and IS invalidated on a switch
// (fail-safe: stale data from another branch must never look current). So: when you add a query, give it a branch in its
// key + `meta: BRANCH_KEYED`, or list its root here.

/** Put `meta: BRANCH_KEYED` on every query whose key carries the selected branch. */
export const BRANCH_KEYED = { branchKeyed: true };

/** First key segment of queries that never depend on the selected branch. */
export const ORG_LEVEL_QUERY_KEYS = new Set([
  'org-features',        // feature flags
  'org-settings',        // organisation identity
  'settings',            // org work schedule / attendance rules (GET /settings)
  'work-schedule',
  'departments',         // departments are organisation-wide
  'designations',
  'branches',            // branch list itself
  'payroll-settings',    // legal-entity payroll configuration
  'statutory-config',    // legal-entity statutory configuration
  'statutory-pt-slabs',  // seeded state PT slab tables (reference data)
  'compliance-returns',
  'biometric-config',
  'biometric-auto-sync-config', // org-level ingestion schedule
  'email-automation-settings',
  'notify-recipients',
  'root-admins',
  'vapid-status',
  'leave-workflow-config',
  'leave-workflow-config-summary',
  'branch-schedule-overrides',
  'branch-hr-access-users', 'hr-admins-for-branch-access', 'hr-users-for-branch-access',
  'config-groups', 'leave-policies-group', 'lp-history',
  'doc-delete-requests', 'hr-contact', 'all-permissions',
  'org-has-biometric',
  'notif-count', 'notif-count-root', 'notifications', 'is-dept-head',
]);

/** Roots of single-record / own-data queries (one employee, one payslip, one run, self-service). */
export const BRANCH_INDEPENDENT_QUERY_KEYS = new Set([
  'payroll-run', 'run-adjustments', 'payslip-details', 'payslip-relitrade', 'salary-history',
  'leave-comments', 'leaves-page-balances', 'punch-logs-row', 'offboarding-tasks',
  'me', 'auth-me', 'login-history', 'emergency-contacts', 'el-usage', 'onboarding-me',
  'culture', 'new-joiners', 'team-dashboard', 'team-leaves-today', 'dept-pending-leaves',
  'doc-activity', 'doc-requirements-my', 'user-roles',
]);
// emp-<id>… (one employee, admin view), epv2-<id>… (employee profile v2), profile-… / my-… (self-service),
// drawer-… (employee drawer), goal-… (one goal), att-day (one employee/day — keyed by user + date)
export const BRANCH_INDEPENDENT_PREFIXES = ['emp-', 'epv2-', 'profile-', 'my-', 'drawer-', 'goal-', 'att-day'];

export function isBranchIndependent(root) {
  return BRANCH_INDEPENDENT_QUERY_KEYS.has(root) || BRANCH_INDEPENDENT_PREFIXES.some(p => root.startsWith(p));
}

/** True when a branch switch must invalidate this query (exported for tests / tooling). */
export function needsBranchInvalidation(query) {
  const root = String(query.queryKey?.[0]);
  if (query.meta?.branchKeyed) return false;           // refetches under its own new key
  if (ORG_LEVEL_QUERY_KEYS.has(root)) return false;    // same for every branch
  if (isBranchIndependent(root)) return false;         // one record / own data
  return true;                                         // unclassified → assume branch-dependent
}

/**
 * Called when the selected branch changes. Only unclassified (possibly branch-dependent) queries are invalidated; and
 * with `cancelRefetch: false` a request that is already in flight is never restarted.
 */
export function invalidateBranchScoped(queryClient) {
  return queryClient.invalidateQueries({ predicate: needsBranchInvalidation }, { cancelRefetch: false });
}
