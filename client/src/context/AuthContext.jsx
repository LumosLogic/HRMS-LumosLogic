// @refresh reset
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

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
    return { token: null, user: null };
  }
  try {
    return { token, user: JSON.parse(localStorage.getItem('lt_user')) };
  } catch { return { token, user: null }; }
}

function loadStoredPermissions() {
  try {
    const p = localStorage.getItem('lt_permissions');
    return p ? JSON.parse(p) : [];
  } catch { return []; }
}

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const initial = loadStoredAuth();
  const [user,        setUser]        = useState(initial.user);
  const [token,       setToken]       = useState(initial.token);
  const [permissions, setPermissions] = useState(loadStoredPermissions);

  // Fetch the user's effective RBAC permissions whenever the token changes.
  // Results are stored in localStorage so they survive page refreshes.
  useEffect(() => {
    if (!token) {
      setPermissions([]);
      localStorage.removeItem('lt_permissions');
      return;
    }
    fetch('/api/permissions/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (Array.isArray(data?.permissions)) {
          setPermissions(data.permissions);
          localStorage.setItem('lt_permissions', JSON.stringify(data.permissions));
        }
      })
      .catch(() => {});
  }, [token]);

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
    localStorage.removeItem('lt_token');
    localStorage.removeItem('lt_user');
    localStorage.removeItem('lt_permissions');
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
  // isAdmin = true for both HR admin and root admin (both can manage HR operations)
  const isAdmin = isHR || isRootAdmin;

  // RBAC permission check — use this instead of raw role checks for fine-grained control.
  // Falls back gracefully: if permissions haven't loaded yet (empty array),
  // legacy isAdmin/isRootAdmin flags remain available as a UI fallback.
  //
  // Inference rules (mirrors backend permissionService):
  //   • Any non-view action on module X implies X.view
  //     (you cannot act on something you cannot see)
  //   • `manage` implies create, edit and delete for the same module
  const hasPermission = useCallback((module, action) => {
    if (!Array.isArray(permissions) || permissions.length === 0) return false;

    // 1. Direct match
    if (permissions.includes(`${module}.${action}`)) return true;

    // 2. Any permission on the module implies 'view'
    if (action === 'view') {
      return permissions.some(p => p.startsWith(`${module}.`));
    }

    // 3. 'manage' implies create / edit / delete
    if (['create', 'edit', 'delete'].includes(action)) {
      return permissions.includes(`${module}.manage`);
    }

    return false;
  }, [permissions]);

  // Organization context
  const organization = user ? {
    id:   user.organization_id   || 1,
    name: user.organization_name || 'LumosLogic',
    slug: user.organization_slug || 'lumoslogic',
    logo: user.organization_logo || '',
  } : null;

  return (
    <AuthContext.Provider value={{
      user, token, saveAuth, logout,
      isAdmin, isHR, isRootAdmin, isEmployee,
      organization,
      permissions,
      hasPermission,
      can: hasPermission,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
