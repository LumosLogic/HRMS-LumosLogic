import React, { useEffect, useRef, useState } from 'react';
import { useIsFetching } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useBranch } from '@/context/BranchContext';

/**
 * Wraps the page area (<Outlet />). When the selected branch changes, branch-keyed queries keep showing the PREVIOUS
 * branch's data (keepPreviousData) until the new branch's data arrives. While that is the case this guard
 *   • shows a small "Updating branch data…" chip,
 *   • makes the page non-interactive (pointer events + keyboard focus are blocked), so no action — approve, delete,
 *     edit, save — can be fired against rows that still belong to the previous branch.
 * It only reacts to a branch CHANGE (not to first load or ordinary refetches), never dims or hides content, and lifts
 * as soon as no branch-keyed query is still waiting for its first data.
 *
 * It also holds the page back until the branch context has settled (feature flags + accessible branches loaded), so a page
 * never fetches once with an unresolved branch and again with the real one. Measured before this gate: a branch-limited HR
 * user with no stored branch loaded the Dashboard with FIVE endpoints requested twice. If the context has not settled after
 * GATE_TIMEOUT_MS (e.g. /features failed) the page renders anyway.
 */
const GATE_TIMEOUT_MS = 5000;
const SETTLE_MS = 250;

export function BranchSwitchGuard({ children }) {
  const { selectedBranchId, isBranchContextReady } = useBranch();
  const [gaveUp, setGaveUp] = useState(false);
  const prev = useRef(selectedBranchId);
  const [switching, setSwitching] = useState(false);

  // a branch-keyed query that is fetching and has no data of its own yet = the screen is still showing the old branch
  const waiting = useIsFetching({ predicate: (q) => q.meta?.branchKeyed === true && q.state.data === undefined });

  useEffect(() => {
    if (prev.current === selectedBranchId) return;
    prev.current = selectedBranchId;
    setSwitching(true);
  }, [selectedBranchId]);

  useEffect(() => {
    if (!switching || waiting > 0) return undefined;
    const t = setTimeout(() => setSwitching(false), SETTLE_MS);   // wait a beat: new-key queries start fetching right after the switch
    return () => clearTimeout(t);
  }, [switching, waiting]);

  useEffect(() => {
    if (isBranchContextReady) return undefined;
    const t = setTimeout(() => setGaveUp(true), GATE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [isBranchContextReady]);

  if (!isBranchContextReady && !gaveUp) return <div className="loading" role="status"><div className="spinner" />Loading…</div>;

  return (
    <div aria-busy={switching || undefined} className={switching ? 'pointer-events-none select-none' : undefined}
         {...(switching ? { inert: '' } : {})}>
      {switching && (
        <div role="status" className="fixed top-3 right-4 z-[60] flex items-center gap-1.5 rounded-full border border-[#c7c4d8] bg-white/95 px-3 py-1 text-[0.7rem] font-semibold text-[#3525cd] shadow-md">
          <Loader2 size={12} className="animate-spin" /> Updating branch data…
        </div>
      )}
      {children}
    </div>
  );
}
