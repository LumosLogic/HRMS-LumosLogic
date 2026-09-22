// @refresh reset
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiGet } from '@/lib/api';
import { useAuth } from './AuthContext';

export const BranchContext = createContext(null);

const STORAGE_KEY = 'lt_selected_branch'; // stores branch id as string, or absent = All Branches

export function BranchProvider({ children }) {
  const { user, token } = useAuth();

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

  // Fetch accessible branches whenever auth changes.
  // Only fetch for admin / root_admin — employees don't need the branch selector.
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

        // Validate the stored selection is still accessible
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const storedId = Number(stored);
          const stillAccessible = branches.some(b => b.id === storedId);
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
  }, [token, user?.id, user?.role, reloadTick]);

  const setSelectedBranchId = useCallback((branchId) => {
    setSelectedBranchIdState(branchId);
    if (branchId == null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, String(branchId));
    }
  }, []);

  // Resolved objects
  const selectedBranch = accessibleBranches.find(b => b.id === selectedBranchId) || null;

  // Show the selector only when there's more than one option to pick from:
  //   - hasAllBranches + at least 1 branch → can choose "All Branches" or a specific one
  //   - !hasAllBranches + at least 2 branches → can choose between specific ones
  const showBranchSelector =
    (hasAllBranches && accessibleBranches.length >= 1) ||
    (!hasAllBranches && accessibleBranches.length > 1);

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
