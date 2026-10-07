import React from 'react';
import { useNavigate, useParams, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import EmployeeProfileV2 from '@/components/EmployeeProfileV2';
import { useTeamMe } from '@/hooks/useTeam';

/**
 * A Manager / HOD opening a member of their team. This is NOT a new profile screen — it mounts the existing
 * EmployeeProfileV2 in its read-only `teamView` mode. The API (profileGuard + /api/team) re-checks that the person is in
 * the caller's team scope, so a hand-typed URL for anyone else simply fails.
 */
export default function TeamMemberProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: me, isLoading: meLoading } = useTeamMe();
  const empId = Number(id);

  const { data: emp, isLoading, isError } = useQuery({
    queryKey: ['my-team-profile', empId],
    queryFn: () => apiGet(`/profile/${empId}/overview`),
    enabled: Number.isInteger(empId) && empId > 0 && !!me?.can?.view,
    retry: false,
  });

  if (meLoading) return <div className="p-8 text-center text-sm text-[#777587]">Loading…</div>;
  if (!me?.can?.view) return <Navigate to="/portal/home" replace />;
  if (isLoading) return <div className="p-8 text-center text-sm text-[#777587]">Loading…</div>;
  if (isError || !emp) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm font-bold text-[#151c27]">This employee is not in your team.</p>
        <button className="mt-3 text-sm font-bold text-[#3525cd] hover:underline" onClick={() => navigate('/portal/team')}>Back to My Team</button>
      </div>
    );
  }
  return <EmployeeProfileV2 emp={emp} teamView onBack={() => navigate('/portal/team')} onEdit={() => {}} />;
}
