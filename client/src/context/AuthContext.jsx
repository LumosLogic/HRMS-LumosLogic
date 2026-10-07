// @refresh reset
import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { firstAdminPath, permissionMatches } from '@/lib/adminAccess';

export const AuthContext = createContext(null);

// SESSION POLICY (2026-09-25):
// No client-side inactivity auto-logout. Users stay logged in across the
// working day regardless of idle time. The maximum normal session lifetime
// is the 7-day JWT expiry issued by the backend (auth.routes.js).
// Logout paths that remain:
//   • Explicit Logout button → logout()
//   • Expired JWT            → loadStoredAuth() wipes it on page load, and
//                              any API 401 fires 'auth:expired' → logout()
//   • Role change / account deactivation → backend 401 with code → logout()
// The 5-minute TOTP pending-session timeout lives server-side and is unaffected.

function isTokenExpired(token) {
  if (!token) return true;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 < Date.now();
  } catch { return true; }
}

function loadStoredAuth() {
  const token = localStorage.getItem('lt_token');
  if (!token || isTokenExpired(token)) {
    localStorage.removeItem('lt_token');
    localStorage.removeItem('lt_user');
    localStorage.removeItem('lt_permissions');
    localStorage.removeItem('lt_custom_permissions');
    return { token: null, user: null };
  }
  try {
    return { token, user: JSON.parse(localStorage.getItem('lt_user')) };
  } catch { return { token, user: null }; }
}

function loadStoredCustomPermissions() {
  try {
    const p = localStorage.getItem('lt_custom_permissions');
    return p ? JSON.parse(p) : [];
  } catch { return []; }
}

function loadStoredPermissions() {
  try {
    const p = localStorage.getItem('lt_permissions');
    return p ? JSON.parse(p) : [];
  } catch { return []; }
}

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const { pathname } = useLocation();
  const initial = loadStoredAuth();
  const [user,        setUser]        = useState(initial.user);
  const [token,       setToken]       = useState(initial.token);
  const [permissions, setPermissions] = useState(loadStoredPermissions);
  // Grants from CUSTOM roles only (employee accounts). Drives the permission-based admin shell.
  const [customPermissions, setCustomPermissions] = useState(loadStoredCustomPermissions);
  // false until /permissions/me has answered for the current token (decides where an employee lands)
  const [permissionsReady, setPermissionsReady] = useState(false);

  // Fetch the user's effective RBAC permissions whenever the token changes, and keep them live afterwards.
  // Results are stored in localStorage so they survive page refreshes.
  const loadPermissions = useCallback((tok, { silent = false } = {}) => {
    if (!silent) setPermissionsReady(false);
    return fetch('/api/permissions/me', { headers: { Authorization: `Bearer ${tok}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!Array.isArray(data?.permissions)) return;
        const custom = Array.isArray(data.custom_permissions) ? data.custom_permissions : [];
        // Only touch state when something actually changed, so a silent refresh never re-renders the app.
        setPermissions(prev => (JSON.stringify(prev) === JSON.stringify(data.permissions) ? prev : data.permissions));
        setCustomPermissions(prev => (JSON.stringify(prev) === JSON.stringify(custom) ? prev : custom));
        localStorage.setItem('lt_permissions', JSON.stringify(data.permissions));
        localStorage.setItem('lt_custom_permissions', JSON.stringify(custom));
      })
      .catch(() => {})
      .finally(() => setPermissionsReady(true));
  }, []);

  useEffect(() => {
    if (!token) {
      setPermissions([]);
      setCustomPermissions([]);
      setPermissionsReady(false);
      localStorage.removeItem('lt_permissions');
      localStorage.removeItem('lt_custom_permissions');
      return;
    }
    loadPermissions(token);
  }, [token, loadPermissions]);

  // Role / permission changes made by an admin reach the employee without a re-login: re-check when the tab regains
  // focus and every 60 s while it is visible (one tiny request; state only changes when the permission set differs).
  useEffect(() => {
    if (!token) return undefined;
    const refresh = () => { if (!document.hidden) { loadPermissions(token, { silent: true }); queryClient.invalidateQueries({ queryKey: ['my-team-me'] }); } };
    const timer = setInterval(refresh, 60 * 1000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [token, loadPermissions, queryClient]);

  const refreshPermissions = useCallback(() => (token ? loadPermissions(token, { silent: true }) : Promise.resolve()), [token, loadPermissions]);

  const saveAuth = useCallback((newToken, newUser) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('lt_token', newToken);
    localStorage.setItem('lt_user',  JSON.stringify(newUser));
    // permissions will be fetched automatically via the useEffect above
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setPermissions([]);
    setCustomPermissions([]);
    localStorage.removeItem('lt_token');
    localStorage.removeItem('lt_user');
    localStorage.removeItem('lt_permissions');
    localStorage.removeItem('lt_custom_permissions');
    queryClient.clear();
  }, [queryClient]);

  // Auto-logout when any API call returns 401 (token expired mid-session)
  useEffect(() => {
    const handler = () => logout();
    window.addEventListener('auth:expired', handler);
    return () => window.removeEventListener('auth:expired', handler);
  }, [logout]);

  // ── Cross-tab auth sync ────────────────────────────────────────────────────
  // The `storage` event fires in every tab EXCEPT the one that wrote the key.
  // When another tab logs out or logs in as a different user, we re-read auth
  // from localStorage and update this tab's React state immediately.
  // We watch only lt_token: lt_user and lt_permissions are always written
  // alongside it, so a single event is enough.
  useEffect(() => {
    function onStorageChange(e) {
      if (e.key !== 'lt_token') return;
      const next = loadStoredAuth();
      setToken(next.token);
      setUser(next.user);
      queryClient.clear(); // discard previous user's cached API responses
      // If next.token is null  → the permissions useEffect clears lt_permissions
      // If next.token changed  → the permissions useEffect re-fetches for new user
    }
    window.addEventListener('storage', onStorageChange);
    return () => window.removeEventListener('storage', onStorageChange);
  }, [queryClient]);

  // Fallback: re-check when the user switches back to this tab (e.g. after
  // Tab 2 logged in while Tab 1 was in the background and the storage event
  // was missed or deferred by the browser).
  useEffect(() => {
    function onVisible() {
      if (document.hidden) return;
      const stored = localStorage.getItem('lt_token');
      if (stored === token) return; // nothing changed
      const next = loadStoredAuth();
      setToken(next.token);
      setUser(next.user);
      queryClient.clear();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [token, queryClient]);

  const isRootAdmin = user?.role === 'root_admin';
  const isHR        = user?.role === 'admin';
  const isEmployee  = user?.role === 'employee';
  // Custom-role employee: an employee account whose custom role grants permissions for admin modules.
  // They get the permission-driven admin shell (sidebar / routes / actions) in addition to the employee portal.
  const adminLanding = isEmployee ? firstAdminPath(customPermissions) : null;
  const hasCustomAccess = !!adminLanding;
  // isAdmin = true for HR admin, root admin, and custom-role users inside the admin shell (their pages are limited
  // by permission, see adminCan). In the employee portal a custom-role user is a plain employee, so the shared
  // pages (payslips, documents, expenses …) keep rendering their self-service view.
  const inPortal = pathname.startsWith('/portal');
  const isAdmin = isHR || isRootAdmin || (hasCustomAccess && !inPortal);

  // RBAC permission check — use this instead of raw role checks for fine-grained control.
  // Falls back gracefully: if permissions haven't loaded yet (empty array),
  // legacy isAdmin/isRootAdmin flags remain available as a UI fallback.
  //
  // Inference rules (mirrors backend permissionService):
  //   • Any non-view, non-self-scoped action on module X implies X.view
  //     (you cannot act on something you cannot see)
  //   • `manage` implies create, edit and delete for the same module
  // Self-scoped grants (payroll.view_own, onboarding.complete_task) are portal-only:
  // they must not imply the module-wide view that opens an admin module.
  const hasPermission = useCallback((module, action) => {
    if (!Array.isArray(permissions) || permissions.length === 0) return false;

    // 1. Direct match
    if (permissions.includes(`${module}.${action}`)) return true;

    // 2. Any admin-grade permission on the module implies 'view' (self-scoped grants do not)
    if (action === 'view') {
      return permissions.some(p => p.startsWith(`${module}.`) && !['view_own', 'complete_task'].includes(p.slice(module.length + 1)));
    }

    // 3. 'manage' implies create / edit / delete
    if (['create', 'edit', 'delete'].includes(action)) {
      return permissions.includes(`${module}.manage`);
    }

    return false;
  }, [permissions]);

  // Admin-module permission check for UI actions (buttons/menus). Root and HR Admin are unchanged —
  // the API remains the authority for them; custom-role users are limited to their custom-role grants.
  const adminCan = useCallback((module, action) => {
    if (isRootAdmin || isHR) return true;
    if (!hasCustomAccess) return false;
    return permissionMatches(customPermissions, `${module}.${action}`);
  }, [isRootAdmin, isHR, hasCustomAccess, customPermissions]);

  // True only for a custom-role user holding the permission. Use `isRootAdmin || customCan(...)` where the
  // existing UI is Root-only but the API honours the permission (payroll approve/lock, …) — HR stays unchanged.
  const customCan = useCallback((module, action) => (
    hasCustomAccess && permissionMatches(customPermissions, `${module}.${action}`)
  ), [hasCustomAccess, customPermissions]);

  // Organization context
  const organization = user ? {
    id:   user.organization_id   || 1,
    name: user.organization_name || 'LumosLogic',
    slug: user.organization_slug || 'lumoslogic',
    logo: user.organization_logo || '',
  } : null;

  const value = useMemo(() => ({
      user, token, saveAuth, logout,
      isAdmin, isHR, isRootAdmin, isEmployee,
      hasCustomAccess, customPermissions, permissionsReady, adminLanding, adminCan, customCan, refreshPermissions,
      organization,
      permissions,
      hasPermission,
      can: hasPermission,
    }), [user, token, saveAuth, logout, isAdmin, isHR, isRootAdmin, isEmployee, hasCustomAccess, customPermissions,
    permissionsReady, adminLanding, adminCan, customCan, refreshPermissions, organization?.id, permissions, hasPermission]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
