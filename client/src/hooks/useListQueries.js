import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { useBranch } from '@/context/BranchContext';
import { toISODate } from '@/lib/utils';
import { STALE } from '@/lib/queryTiers';
import { gateLoading } from '@/lib/queryGate';
import { BRANCH_KEYED } from '@/lib/queryScopes';

/**
 * Shared list hooks for the endpoints that several screens used to fetch under different query keys:
 *   GET /leaves   GET /regularization   GET /expenses   GET /leave-policies
 *
 * Key convention (every parameter that changes the result is in the key):
 *   ['leaves', 'list', branch, params]   ['regularization', branch, params]   ['expenses', branch, params]
 *   ['leave-policies', branch]
 * `branch` is the selected branch (each branch is its own cache entry, so Branch A data can never be shown as
 * Branch B). Prefix invalidation (`invalidateQueries({ queryKey: ['leaves'] })`, ['regularization'], ['expenses'],
 * ['leave-policies']) reaches every variant.
 *
 * keepPreviousData: while a new branch / filter / window loads, the previous result stays on screen so the page
 * does not blank out. `isPlaceholderData` is true during that time — screens must dim the data and disable row
 * actions (see <RefreshingOverlay />) so old rows are never presented as the new result.
 *
 * Params are only sent when they have a value, so `{}` = the exact request the screens made before.
 */

// How far back admin list screens look by default. They show a "Show full history" control (HistoryWindowNote),
// so nothing is hidden silently. Employees' own lists are small and stay unwindowed.
export const HISTORY_DAYS = { leaves: 400, regularization: 180, expenses: 365 };

export function historyFrom(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return toISODate(d);
}

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)));

// { statuses: [..], from, to, limit, page, ...rest } → { status: 'a,b', from, to, ... } (only set values)
function toQuery({ statuses, ...rest } = {}) {
  return clean({ ...rest, ...(statuses ? { status: [...statuses].sort().join(',') } : {}) });
}

// leaves / regularization / expenses are edited by other people at any moment → 'frequent' tier unless the caller overrides
function useListQuery(root, extraKey, endpoint, params, { enabled = true, staleTime = STALE.frequent, refetchInterval, select } = {}) {
  const { selectedBranchId, isBranchContextReady } = useBranch();
  const query = toQuery(params);
  const result = useQuery({
    queryKey: [...root, ...extraKey, selectedBranchId, query],
    meta: BRANCH_KEYED,
    queryFn: () => apiGet(endpoint, query),
    enabled: enabled && isBranchContextReady,
    placeholderData: keepPreviousData,
    staleTime,
    ...(refetchInterval !== undefined ? { refetchInterval } : {}),
    ...(select ? { select } : {}),
  });
  return gateLoading(result, enabled && !isBranchContextReady);
}

/** GET /leaves — params: userId, year, month, statuses, from, to, limit, page */
export const useLeavesList = (params = {}, opts) => useListQuery(['leaves'], ['list'], '/leaves', params, opts);

/** GET /regularization — params: statuses, from, to, limit, page */
export const useRegularizations = (params = {}, opts) => useListQuery(['regularization'], [], '/regularization', params, opts);

/** GET /expenses — params: statuses, from, to, limit, page */
export const useExpenses = (params = {}, opts) => useListQuery(['expenses'], [], '/expenses', params, opts);

/** GET /leave-policies — organisation/branch policy set (branch-dependent, so the branch is in the key) */
// configuration: long cache, invalidated by every policy save (LeavePolicies, ConfigGroupsManager, MyLeaves apply)
export function useLeavePolicies({ enabled = true, staleTime = STALE.config } = {}) {
  const { selectedBranchId, isBranchContextReady } = useBranch();
  const query = useQuery({
    queryKey: ['leave-policies', selectedBranchId],
    meta: BRANCH_KEYED,
    queryFn: () => apiGet('/leave-policies'),
    enabled: enabled && isBranchContextReady,
    placeholderData: keepPreviousData,
    staleTime,
  });
  return gateLoading(query, enabled && !isBranchContextReady);
}
