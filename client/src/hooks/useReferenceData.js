import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { useBranch } from '@/context/BranchContext';
import { STALE } from '@/lib/queryTiers';
import { gateLoading } from '@/lib/queryGate';
import { BRANCH_KEYED } from '@/lib/queryScopes';

/**
 * The ONE way to read reference / configuration data. Before this, the same endpoint was fetched under several
 * keys (and two different endpoints even shared the keys 'org-settings' and 'work-schedule', so whichever mounted first
 * poisoned the other's cache). One hook per dataset = one cache entry, one freshness tier (lib/queryTiers.js).
 *
 * ORGANISATION-level data (the same for every branch) has NO branch in its key, so a branch switch never refetches it:
 *   branches, departments, designations, org settings, work schedule, payroll settings
 * BRANCH-dependent data carries the selected branch in its key and waits for the branch context to settle:
 *   holidays, shifts, announcements, documents
 *
 * Config data (settings, schedule, policies, shifts, holidays) is cached for STALE.config — the screens that save it
 * invalidate these keys on success (['org-settings'], ['settings'], ['work-schedule'], ['payroll-settings'], ['shifts'],
 * ['holidays']), so the longer cache never shows pre-save values.
 */

function useOrgQuery(key, endpoint, params, { enabled = true, staleTime = STALE.static, select, refetchOnFocus = false } = {}) {
  return useQuery({
    queryKey: key,
    refetchOnWindowFocus: refetchOnFocus,
    queryFn: () => apiGet(endpoint, params),
    enabled, staleTime,
    ...(select ? { select } : {}),
  });
}

function useBranchQuery(rootKey, extraKey, endpoint, params, { enabled = true, staleTime = STALE.config, placeholder = true, refetchOnFocus = false } = {}) {
  const { selectedBranchId, isBranchContextReady } = useBranch();
  const query = useQuery({
    queryKey: [...rootKey, ...extraKey, selectedBranchId],
    meta: BRANCH_KEYED,
    refetchOnWindowFocus: refetchOnFocus,
    queryFn: () => apiGet(endpoint, params),
    enabled: enabled && isBranchContextReady,
    staleTime,
    ...(placeholder ? { placeholderData: keepPreviousData } : {}),
  });
  return gateLoading(query, enabled && !isBranchContextReady);
}

// ── organisation-level ──────────────────────────────────────────────────────────
export const useBranchesList     = (opts) => useOrgQuery(['branches'], '/branches', undefined, { staleTime: STALE.static, refetchOnFocus: true, ...opts });
export const useDepartmentsList  = (opts) => useOrgQuery(['departments'], '/departments', undefined, { staleTime: STALE.static, ...opts });
export const useDesignationsList = (departmentId, opts) =>
  useOrgQuery(['designations', departmentId ?? null], '/designations', departmentId ? { department_id: departmentId } : {}, { staleTime: STALE.static, ...opts });
export const useOrgSettings      = (opts) => useOrgQuery(['org-settings'], '/org/settings', undefined, { staleTime: STALE.config, ...opts });
export const useSettings         = (opts) => useOrgQuery(['settings'], '/settings', undefined, { staleTime: STALE.config, ...opts });          // { schedule }
export const useWorkSchedule     = (opts) => useOrgQuery(['work-schedule'], '/settings/schedule', undefined, { staleTime: STALE.config, ...opts });
export const usePayrollSettings  = (opts) => useOrgQuery(['payroll-settings'], '/payroll/settings', undefined, { staleTime: STALE.config, ...opts });

// ── branch-dependent ────────────────────────────────────────────────────────────
/** year omitted = every year (what the endpoint returns without ?year) */
export const useHolidays = (year, opts) =>
  useBranchQuery(['holidays'], [year ?? 'all'], '/holidays', year ? { year } : undefined, opts);
export const useShiftsList = (opts) => useBranchQuery(['shifts'], [], '/shifts', undefined, opts);
export const useAnnouncements = (opts) => useBranchQuery(['announcements'], [], '/announcements', undefined, { staleTime: STALE.frequent, refetchOnFocus: true, ...opts });
export const useDocumentsList = (opts) => useBranchQuery(['documents', 'list'], [], '/documents', undefined, { staleTime: STALE.frequent, refetchOnFocus: true, ...opts });
