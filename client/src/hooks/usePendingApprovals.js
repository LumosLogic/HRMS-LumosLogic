import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { useBranch } from '@/context/BranchContext';
import { STALE } from '@/lib/queryTiers';
import { gateLoading } from '@/lib/queryGate';
import { BRANCH_KEYED } from '@/lib/queryScopes';

/**
 * Everything the Pending Approvals page shows, from ONE request (GET /api/pending-approvals), polled every 30 s.
 * It replaces five overlapping polls (/leaves, /leaves/pending-root, /leaves/my-approvals, /regularization, /expenses).
 * The server runs those same endpoints in-process, so RBAC and branch isolation are unchanged.
 *
 * keepPreviousData: the previous branch's rows stay visible (and are NOT actionable — see isPlaceholderData)
 * until the new branch's rows arrive.
 */
export function usePendingApprovals() {
  const { selectedBranchId, isBranchContextReady } = useBranch();
  const query = useQuery({
    queryKey: ['pending-approvals', selectedBranchId],
    meta: BRANCH_KEYED,
    queryFn: async () => {
      const d = await apiGet('/pending-approvals').catch(() => null);
      const arr = (v) => (Array.isArray(v) ? v : []);
      return { leaves: arr(d?.leaves), myApprovals: arr(d?.my_approvals), regs: arr(d?.regularizations), expenses: arr(d?.expenses) };
    },
    enabled: isBranchContextReady,
    placeholderData: keepPreviousData,
    staleTime: STALE.realtime,   // approvals: never trust more than 15 s old
    refetchInterval: 30000,
  });
  return gateLoading(query, !isBranchContextReady);
}
