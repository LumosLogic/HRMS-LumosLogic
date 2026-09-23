// @refresh reset
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { apiGet } from '@/lib/api';
import { useAuth } from './AuthContext';
import { useFeature, FeatureFlagsLoadedContext } from './FeatureFlagContext';

export const BranchContext = createContext(null);

const STORAGE_KEY = 'lt_selected_branch'; // stores branch id as string, or absent = All Branches

export function BranchProvider({ children }) {
  const { user, token } = useAuth();
  const branchesEnabled = useFeature('branches');
  const flagsLoaded     = useContext(FeatureFlagsLoadedContext);

  const [accessibleBranches, setAccessibleBranches] = useState([]);
  const [hasAllBranches,     setHasAllBranches]     = useState(false);
  const [isRootAdmin,        setIsRootAdmin]         = useState(false);
  const [isLoading,          setIsLoading]           = useState(false);
  const [branchesLoaded,     setBranchesLoaded]     = useState(false);
  // Increment to force a re-fetch (e.g. after creating the first branch)
  const [reloadTick,         setReloadTick]         = useState(0);
  const reloadBranches = useCallback(() => setReloadTick(t => t + 1), []);

  // Restore selected branch from localStorage
  const [selectedBranchId, setSelectedBranchIdState] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? Number(stored) : null;
  });

  // ── Pre-fetch ref (Issue 5: startup parallelization) ────────────────────────
  // Holds the raw /branches/my-access response fetched early (before feature
  // flags resolve). The main effect below uses this cached result instead of
  // starting a second sequential request, reducing startup latency for
  // branches-enabled organisations by one serial round-trip.
  const _prefetchRef = useRef(null);

  // ── Early branch pre-fetch ───────────────────────────────────────────────────
  // Fires as soon as we know auth state (token + non-employee), without waiting
  // for feature flags. The result is stored in _prefetchRef for the main effect
  // to consume once flags are confirmed. Branch selection is NEVER applied here —
  // that only happens in the main effect after flagsLoaded is true, so branch
  // isolation is never weakened.
  useEffect(() => {
    _prefetchRef.current = null; // reset on every trigger before new fetch
    if (!token || !user || user.role === 'employee') return;
    apiGet('/branches/my-access')
      .then(data  => { _prefetchRef.current = data; })
      .catch(() => { /* main effect handles its own error path */ });
  }, [token, user?.id, user?.role, reloadTick]);

  // ── Main branch effect ───────────────────────────────────────────────────────
  // Applies branch data and validates the selected branch. Waits for feature
  // flags before applying (branch isolation depends on knowing whether the
  // feature is on or off). Uses pre-fetched data when available to save the
  // second round-trip.
  useEffect(() => {
    if (!token || !user) {
      setAccessibleBranches([]);
      setHasAllBranches(false);
      setIsRootAdmin(false);
      setSelectedBranchIdState(null);
      setBranchesLoaded(false);
      _prefetchRef.current = null;
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    // When branches feature is OFF (and we are certain flags are loaded): clear branch state.
    // IMPORTANT: useFeature returns false while flags are still loading, so we MUST wait
    // for flagsLoaded before acting — otherwise every refresh clears localStorage prematurely.
    if (flagsLoaded && !branchesEnabled) {
      setAccessibleBranches([]);
      setHasAllBranches(false);
      setIsRootAdmin(false);
      setSelectedBranchIdState(null);
      setBranchesLoaded(false);
      _prefetchRef.current = null;
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    // Flags not loaded yet — wait before applying any branch selection.
    // The pre-fetch effect has already started fetching in parallel.
    if (!flagsLoaded) return;

    // Employees don't need a branch selector — their branch is fixed via users.branch_id
    if (user.role === 'employee') {
      setAccessibleBranches([]);
      setHasAllBranches(false);
      setIsRootAdmin(false);
      setBranchesLoaded(false);
      _prefetchRef.current = null;
      return;
    }

    // ── Apply branch data (validates and persists the selected branch) ──────
    function applyBranchData(data) {
      const branches = data.branches || [];
      setAccessibleBranches(branches);
      setHasAllBranches(!!data.hasAllBranches);
      setIsRootAdmin(!!data.isRootAdmin);

      const stored = localStorage.getItem(STORAGE_KEY);
      const activeBranches = branches.filter(b => b.is_active !== false);
      if (stored) {
        const storedId     = Number(stored);
        const storedBranch = branches.find(b => Number(b.id) === storedId);
        if (!storedBranch) {
          // Branch no longer accessible — switch to first active
          const firstActive = activeBranches[0];
          if (firstActive) {
            const numId = Number(firstActive.id);
            setSelectedBranchIdState(numId);
            localStorage.setItem(STORAGE_KEY, String(numId));
          } else {
            localStorage.removeItem(STORAGE_KEY);
            setSelectedBranchIdState(null);
          }
        } else if (storedBranch.is_active === false) {
          // Branch was deactivated — switch to first active
          const firstActive = activeBranches[0];
          if (firstActive) {
            const numId = Number(firstActive.id);
            setSelectedBranchIdState(numId);
            localStorage.setItem(STORAGE_KEY, String(numId));
          } else {
            localStorage.removeItem(STORAGE_KEY);
            setSelectedBranchIdState(null);
          }
        }
      } else if (activeBranches.length > 0) {
        // No stored selection — auto-select first active branch
        const numId = Number(activeBranches[0].id);
        setSelectedBranchIdState(numId);
        localStorage.setItem(STORAGE_KEY, String(numId));
      }
    }

    setIsLoading(true);
    // Issue 4 fix: do NOT set branchesLoaded=false here.
    // During a background refresh, existing queries can continue running with
    // the current data — isBranchContextReady stays true. Only the initial state
    // (branchesLoaded = false from useState) blocks queries on first load.

    // Issue 5 optimization: consume pre-fetched data if available, avoiding a
    // second serial round-trip for branches-enabled orgs on startup.
    const prefetched = _prefetchRef.current;
    _prefetchRef.current = null; // always clear so stale data never leaks to future runs

    if (prefetched) {
      applyBranchData(prefetched);
      setIsLoading(false);
      setBranchesLoaded(true);
      return;
    }

    // No prefetch data — start a normal fetch (also covers reloadTick re-fetches
    // where the pre-fetch and main effect fire simultaneously and the main effect
    // finds an empty ref because the pre-fetch hasn't completed yet).
    apiGet('/branches/my-access')
      .then(data => {
        _prefetchRef.current = null; // discard any concurrent pre-fetch result
        applyBranchData(data);
      })
      .catch(() => {
        _prefetchRef.current = null;
        setAccessibleBranches([]);
        setHasAllBranches(false);
        setIsRootAdmin(false);
      })
      .finally(() => {
        setIsLoading(false);
        setBranchesLoaded(true); // always mark loaded (even on error) to unblock queries
      });
  }, [token, user?.id, user?.role, reloadTick, branchesEnabled, flagsLoaded]);

  const setSelectedBranchId = useCallback((branchId) => {
    // Always store as Number so === comparisons against b.id (also Number) are safe.
    const numId = branchId != null ? Number(branchId) : null;
    setSelectedBranchIdState(numId);
    if (numId == null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, String(numId));
    }
  }, []);

  // Sync branch selection when another tab switches branches (same user) or
  // when another tab's login clears lt_selected_branch (user change is handled
  // above via token/user deps — this catches same-user cross-tab branch switches).
  useEffect(() => {
    function onStorageChange(e) {
      if (e.key !== STORAGE_KEY) return;
      const newId = e.newValue ? Number(e.newValue) : null;
      setSelectedBranchIdState(newId);
    }
    window.addEventListener('storage', onStorageChange);
    return () => window.removeEventListener('storage', onStorageChange);
  }, []);

  // Resolved objects
  // Coerce b.id to Number: PostgreSQL BIGINT returns as string via node-postgres.
  const selectedBranch = accessibleBranches.find(b => Number(b.id) === selectedBranchId) || null;

  // Show the selector only when there are 2+ branches to switch between.
  const showBranchSelector = accessibleBranches.length >= 2;

  // isBranchContextReady: true when selectedBranchId is fully settled and safe to use
  // as an API filter. Use as `enabled` guard in branch-dependent useQuery calls.
  //
  //   branches OFF: ready once feature flags confirm it (flagsLoaded)
  //   branches ON:  ready once /branches/my-access has been fetched and selectedBranchId
  //                 has been validated against the accessible list (branchesLoaded)
  //
  // Because branchesLoaded is NOT reset on background re-fetches (Issue 4 fix),
  // this stays true during refresh cycles, preventing brief query-disabled windows.
  const isBranchContextReady = flagsLoaded && (!branchesEnabled || branchesLoaded);

  return (
    <BranchContext.Provider value={{
      accessibleBranches,
      selectedBranchId,
      selectedBranch,
      setSelectedBranchId,
      hasAllBranches,
      isRootAdmin,
      isLoading,
      branchesLoaded,
      isBranchContextReady,
      showBranchSelector,
      reloadBranches,
    }}>
      {children}
    </BranchContext.Provider>
  );
}

export function useBranch() {
  const ctx = useContext(BranchContext);
  if (!ctx) throw new Error('useBranch must be used inside BranchProvider');
  return ctx;
}
