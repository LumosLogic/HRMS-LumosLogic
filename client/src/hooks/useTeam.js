import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { STALE } from '@/lib/queryTiers';

/**
 * Manager / HOD team scope. Everything is derived on the server (users.reporting_to, departments.head_user_id) and
 * gated by the team.* permissions Root Admin edits in Role Management — the client only mirrors it to show/hide UI.
 * Keys start with `my-` so a branch switch never refetches them (a team is the caller's own scope).
 */
export function useTeamMe() {
  const { token, isEmployee } = useAuth();
  return useQuery({
    queryKey: ['my-team-me'],
    queryFn: () => apiGet('/team/me'),
    enabled: !!token && isEmployee,
    staleTime: STALE.frequent,
    select: d => ({
      isManager: !!d?.is_manager, isHod: !!d?.is_hod, memberCount: d?.member_count || 0, can: d?.can || {},
      hasTeam: (d?.member_count || 0) > 0 && Object.values(d?.can || {}).some(Boolean),
    }),
  });
}

/** One team dataset. `kind` is members | attendance | leaves | regularization | performance. */
export function useTeamData(kind, params = {}, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['my-team', kind, params],
    queryFn: () => apiGet(`/team/${kind}`, params),
    enabled,
    staleTime: STALE.frequent,
  });
}
