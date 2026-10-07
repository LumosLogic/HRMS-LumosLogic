import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

/**
 * ONE place that decides where "open this employee" goes. It reuses the existing profile screens — nothing new:
 *   self                      → the logged-in user's own profile page
 *   Root Admin / HR Admin     → /root/employees/:id · /employees/:id   (existing EmployeeProfileV2)
 *   custom role (employees.view, admin shell) → /employees/:id
 *   Manager / HOD (portal)    → /portal/team/:id   (same EmployeeProfileV2, read-only; the API re-checks team scope)
 * Anyone else gets `null` — render plain text, never a link that would 403. The id is always the ROW's employee id,
 * never the logged-in user's.
 */
export function useEmployeeLink() {
  const { user, isRootAdmin, isHR, adminCan, hasCustomAccess } = useAuth();
  const { pathname } = useLocation();
  const inPortal = pathname.startsWith('/portal');

  return React.useCallback((employeeId, { team = false } = {}) => {
    const id = Number(employeeId);
    if (!Number.isInteger(id) || id <= 0 || !user) return null;
    if (Number(user.id) === id) return isRootAdmin ? '/root/profile' : inPortal || user.role === 'employee' ? '/portal/profile' : '/profile';
    if (isRootAdmin) return `/root/employees/${id}`;
    if (isHR) return `/employees/${id}`;
    if (hasCustomAccess && !inPortal && adminCan('employees', 'view')) return `/employees/${id}`;
    if (team) return `/portal/team/${id}`;
    return null;
  }, [user, isRootAdmin, isHR, adminCan, hasCustomAccess, inPortal]);
}

/** Clickable employee name — falls back to plain text when the viewer may not open that profile. */
export function EmployeeLink({ id, team = false, children, className = '' }) {
  const toLink = useEmployeeLink();
  const to = toLink(id, { team });
  if (!to) return <>{children}</>;
  return (
    <Link to={to} onClick={e => e.stopPropagation()}
      className={`hover:text-[#3525cd] hover:underline underline-offset-2 ${className}`}>
      {children}
    </Link>
  );
}
