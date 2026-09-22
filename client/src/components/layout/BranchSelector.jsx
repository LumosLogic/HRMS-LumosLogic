import React, { useState, useRef, useEffect } from 'react';
import { Building2, ChevronDown, Check } from 'lucide-react';
import { useBranch } from '@/context/BranchContext';
import { cn } from '@/lib/utils';

/**
 * Global branch selector shown in the sidebar for admins with multi-branch access.
 * Hidden automatically for single-branch orgs and employees.
 */
export function BranchSelector() {
  const {
    accessibleBranches,
    selectedBranchId,
    selectedBranch,
    setSelectedBranchId,
    showBranchSelector,
    isLoading,
  } = useBranch();

  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!showBranchSelector) return null;

  const displayName = selectedBranch ? selectedBranch.name : 'Select Branch';

  return (
    <div ref={ref} className="relative px-3 pb-2">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={isLoading}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold',
          'border border-[#3525cd]/30 bg-[#3525cd]/5 text-[#3525cd]',
          'hover:bg-[#3525cd]/10 hover:border-[#3525cd]/50 transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3525cd]/30',
          isLoading && 'opacity-50 cursor-not-allowed'
        )}
        title="Switch branch context"
      >
        <Building2 size={13} className="flex-shrink-0 opacity-70" />
        <span className="flex-1 text-left truncate">{isLoading ? 'Loading…' : displayName}</span>
        <ChevronDown
          size={12}
          className={cn('flex-shrink-0 transition-transform duration-150', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="absolute left-3 right-3 top-full mt-1 bg-white border border-[#c7c4d8] rounded-xl shadow-lg z-50 py-1 max-h-56 overflow-y-auto">
          {/* Branch options — no "All Branches"; one branch is always the active context */}
          {accessibleBranches.map(branch => (
            <button
              key={branch.id}
              onClick={() => { setSelectedBranchId(branch.id); setOpen(false); }}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-semibold text-left transition-colors',
                selectedBranchId === branch.id
                  ? 'text-[#3525cd] bg-[#3525cd]/5'
                  : 'text-[#464555] hover:bg-[#f0f3ff]'
              )}
            >
              <Building2 size={13} className="flex-shrink-0 opacity-60" />
              <div className="flex-1 min-w-0">
                <p className="truncate">{branch.name}</p>
                {branch.location && (
                  <p className="text-[0.65rem] text-[#777587] truncate">{branch.location}</p>
                )}
              </div>
              {selectedBranchId === branch.id && (
                <Check size={12} className="text-[#3525cd] flex-shrink-0" />
              )}
            </button>
          ))}

          {accessibleBranches.length === 0 && !hasAllBranches && (
            <p className="px-3 py-2 text-xs text-[#777587] italic">No branches assigned</p>
          )}
        </div>
      )}
    </div>
  );
}
