import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { useBranch } from '@/context/BranchContext';
import { todayStr } from '@/lib/utils';
import { BRANCH_KEYED } from '@/lib/queryScopes';

/**
 * Per-day attendance reads used by the regularization / attendance-correction modals. They used to be
 * `useEffect` + `apiGet` on every modal open and every date change, uncached. Now they live in React Query
 * under the shared root ['att-day', ...] so reopening a modal for a day that was just looked at reuses the data.
 *
 * Correctness first:
 *  - TODAY is never served from cache (staleTime 0): punches / check-in are still changing.
 *  - A past day is reused for 60 s; anything that edits attendance should call invalidateAttendanceDay(qc).
 *  - The data is reference information only; nothing here is submitted back to the server.
 *  - Callers show a loading state only while there is NO data (isLoading), so cached data appears instantly and
 *    revalidates in the background.
 */
const PAST_DAY_STALE_MS = 60 * 1000;
const staleFor = (date) => (date === todayStr() ? 0 : PAST_DAY_STALE_MS);

export const invalidateAttendanceDay = (qc) => qc.invalidateQueries({ queryKey: ['att-day'] });

/** After the employee's OWN check-in / check-out / break: every cache that shows today's record must refetch (not just one). */
export const invalidateMyAttendance = (qc) => Promise.all(
  ['my-attendance', 'my-att-recent', 'my-stats', 'att-day', 'dashboard'].map(k => qc.invalidateQueries({ queryKey: [k] })));

/** Own processed attendance record for a date. */
export function useMyAttendanceRecord(date, enabled = true) {
  return useQuery({
    queryKey: ['att-day', 'my-record', date],
    queryFn: () => apiGet('/attendance/my-record', { date }),
    enabled: enabled && !!date, staleTime: staleFor(date), retry: false,
  });
}

/** Own raw biometric punches for a date. */
export function useMyPunches(date, enabled = true) {
  return useQuery({
    queryKey: ['att-day', 'my-punches', date],
    queryFn: () => apiGet('/biometric/my-punches', { date }),
    enabled: enabled && !!date, staleTime: staleFor(date), retry: false,
  });
}

/** An employee's raw punches for a date (admin view; the server applies branch isolation). */
export function usePunchesForDate(userId, date, enabled = true) {
  const { selectedBranchId } = useBranch();
  return useQuery({
    queryKey: ['att-day', 'punches', selectedBranchId, userId, date],
    meta: BRANCH_KEYED,
    queryFn: () => apiGet('/biometric/punches-for-date', { userId, date }),
    enabled: enabled && !!userId && !!date, staleTime: staleFor(date), retry: false,
  });
}

/** Day count the leave-override will restore. Drives a confirmation, so it is ALWAYS refetched on open. */
export function useOverridePreview(userId, date, enabled = true) {
  const { selectedBranchId } = useBranch();
  return useQuery({
    queryKey: ['att-day', 'override-preview', selectedBranchId, userId, date],
    meta: BRANCH_KEYED,
    queryFn: () => apiGet('/leaves/override-preview', { userId, date }),
    enabled: enabled && !!userId && !!date, staleTime: 0, gcTime: 0, refetchOnMount: 'always', retry: false,
  });
}
