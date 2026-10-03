import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { useBranch } from '@/context/BranchContext';
import { gateLoading } from '@/lib/queryGate';
import { BRANCH_KEYED } from '@/lib/queryScopes';

/**
 * The ONE way to load the employee list.
 *
 * Why: ~20 call sites hit GET /employees with ~6 different query keys (and two pages shared a key
 * while requesting different payloads). One hook = one cache entry per (variant, branch), so the
 * list is fetched once and reused across pages, and every `invalidateQueries({ queryKey: ['employees'] })`
 * after an employee mutation reaches all of them.
 *
 *   includeInactive  include inactive/resigned/terminated (Employees management page only)
 *   lite             lightweight payload for dropdowns / pickers (id, name, email, role, department,
 *                    position, avatar, employee_id, status, branch_id, PIN) — no salary/statutory data
 *   onlyEmployees    client-side filter to role === 'employee' (shares the same cache entry)
 *   enabled          extra gate (e.g. admin only); the branch context must also be ready
 *
 * The branch is part of the key (each branch is its own entry, so Branch A data can never be shown
 * as Branch B) and the previous branch's list stays visible, dimmed via `isPlaceholderData`, until
 * the new branch's list arrives — no blank flash.
 */
export function useEmployees({ includeInactive = false, lite = false, onlyEmployees = false, enabled = true, staleTime } = {}) {
  const { selectedBranchId, isBranchContextReady } = useBranch();
  const query = useQuery({
    queryKey: ['employees', 'list', { includeInactive, lite }, selectedBranchId],
    meta: BRANCH_KEYED,
    queryFn: () => apiGet('/employees', {
      ...(includeInactive ? { include_inactive: 'true' } : {}),
      ...(lite ? { lite: '1' } : {}),
    }),
    select: (all) => {
      const list = Array.isArray(all) ? all : (all?.employees || []);
      return onlyEmployees ? list.filter(e => e.role === 'employee') : list;
    },
    enabled: enabled && isBranchContextReady,
    placeholderData: keepPreviousData,
    ...(staleTime !== undefined ? { staleTime } : {}),
  });
  return gateLoading(query, enabled && !isBranchContextReady);
}
