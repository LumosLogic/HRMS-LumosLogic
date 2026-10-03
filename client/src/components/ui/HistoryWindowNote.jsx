import React from 'react';
import { Loader2 } from 'lucide-react';
import { fmtDate } from '@/lib/utils';

/**
 * Tells the user a list is limited to recent history and lets them load everything.
 *   since        YYYY-MM-DD the list currently starts at (ignored while showing all)
 *   showingAll   true once the user asked for the full history
 *   onToggle     () => void
 *   noun         "leaves" | "requests" | "claims"
 */
export function HistoryWindowNote({ since, showingAll, onToggle, noun = 'records', loading = false }) {
  return (
    <div className="flex items-center gap-2 text-xs text-[#777587] mb-3" data-testid="history-window-note">
      <span>{showingAll ? `Showing the full history of ${noun}.` : `Showing ${noun} from ${fmtDate(since)} onward.`}</span>
      <button type="button" className="font-semibold text-[#3525cd] hover:underline" onClick={onToggle}>
        {showingAll ? 'Show recent only' : 'Show full history'}
      </button>
      {loading && <Loader2 size={12} className="animate-spin" aria-label="Loading" />}
    </div>
  );
}

/**
 * Wrap list content that may be showing the PREVIOUS filter/branch's data while the new request loads.
 * Dims it, blocks interaction (so a stale row can't be actioned) and shows a small "Updating…" chip.
 */
export function RefreshingOverlay({ active, children }) {
  return (
    <div className="relative" aria-busy={active || undefined}>
      {active && (
        <div className="absolute right-0 -top-5 z-10 flex items-center gap-1 text-[0.65rem] font-semibold text-[#3525cd]" role="status">
          <Loader2 size={11} className="animate-spin" /> Updating…
        </div>
      )}
      <div className={active ? 'opacity-60 pointer-events-none transition-opacity' : 'transition-opacity'}>{children}</div>
    </div>
  );
}
