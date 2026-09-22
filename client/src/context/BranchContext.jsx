// @refresh reset
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
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

  // Fetch accessible branches whenever auth or feature flag changes.
  // Only fetch for admin / root_admin — employees don't need the branch selector.
  // Skip entirely when branches feature is OFF for this org.
  useEffect(() => {
    if (!token || !user) {
      setAccessibleBranches([]);
      setHasAllBranches(false);
      setIsRootAdmin(false);
      setSelectedBranchIdState(null);
      setBranchesLoaded(false);
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
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    // Flags not loaded yet — wait before fetching branches or clearing state
    if (!flagsLoaded) return;

    // Employees don't need a branch selector — their branch is fixed via users.branch_id
    if (user.role === 'employee') {
      setAccessibleBranches([]);
      setHasAllBranches(false);
      setIsRootAdmin(false);
      setBranchesLoaded(false);
      return;
    }

    setIsLoading(true);
    setBranchesLoaded(false);
    apiGet('/branches/my-access')
      .then(data => {
        const branches = data.branches || [];
        setAccessibleBranches(branches);
        setHasAllBranches(!!data.hasAllBranches);
        setIsRootAdmin(!!data.isRootAdmin);

        // Validate the stored selection is still accessible; clear it if not.
        // Use Number() coercion on both sides: PostgreSQL BIGINT/BIGSERIAL IDs
        // are returned as strings by node-postgres, so strict === would always
        // fail against the stored numeric ID and clear the branch on every refresh.
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const storedId = Number(stored);
          const stillAccessible = branches.some(b => Number(b.id) === storedId);
          if (!stillAccessible) {
            localStorage.removeItem(STORAGE_KEY);
            setSelectedBranchIdState(null);
          }
        }
      })
      .catch(() => {
        setAccessibleBranches([]);
        setHasAllBranches(false);
        setIsRootAdmin(false);
      })
      .finally(() => {
        setIsLoading(false);
        setBranchesLoaded(true);
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

  // Resolved objects
  // Coerce b.id to Number: PostgreSQL BIGINT returns as string via node-postgres.
  const selectedBranch = accessibleBranches.find(b => Number(b.id) === selectedBranchId) || null;

  // Show the selector only when there are 2+ branches to switch between.
  // "All Branches" is not a valid working context so we never include it as an option.
  const showBranchSelector = accessibleBranches.length >= 2;

  // isBranchContextReady: true when selectedBranchId is fully settled and safe to use
  // as an API filter. Use as `enabled` guard in branch-dependent useQuery calls.
  //
  //   branches OFF: ready once feature flags confirm it (flagsLoaded)
  //   branches ON:  ready once /branches/my-access has been fetched and selectedBranchId
  //                 has been validated against the accessible list (branchesLoaded)
  //
  // This prevents branch-dependent queries from firing during the brief window between
  // page load and branch context initialization, which would produce stale/wrong data.
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
