import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { STALE } from '@/lib/queryTiers';

/**
 * Whether the signed-in user may check in today (holiday / approved full-day leave block it — Bug-160/161).
 * The server enforces the same rule on POST /attendance/checkin; this only lets the button show it up front.
 * Fails open: if the status cannot be loaded the button stays enabled and the server decides.
 */
export function useCheckInStatus() {
  const { data } = useQuery({
    queryKey: ['my-check-in-status'],
    queryFn: () => apiGet('/attendance/check-in-status'),
    staleTime: STALE.frequent,
    retry: false,
  });
  return { blocked: data?.allowed === false, reason: data?.reason || '' };
}
